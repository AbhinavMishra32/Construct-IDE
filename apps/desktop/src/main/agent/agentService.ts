import { randomUUID } from "node:crypto";
import type { AgentActivityStep, AgentMessage } from "@construct/domain";
import type { AgentStreamEvent } from "../../shared/api.js";
import type { AskUserQuestionRequest } from "@construct/domain";
import type { ProjectStore } from "../store/projectStore.js";
import type { ProviderService } from "../provider.js";
import type { WorkspaceService } from "../projects/workspaceService.js";
import type { MemoryService } from "../memory/memoryService.js";
import type { PathService } from "../learning/pathService.js";
import type { WebSearchService } from "../webSearch.js";
import { UtilityClient } from "../utilityClient.js";
import { executeAgentTool } from "./agentTools.js";
import { openingRequest, RESEARCH_AGENT_PROMPT, researchDocument, researchRequest, wroteResearch } from "./researchPrompt.js";

export type AgentEvent =
  | { projectId: string; kind: "step"; text: string }
  | { projectId: string; kind: "question"; request: AskUserQuestionRequest }
  | { projectId: string; kind: "message"; message: AgentMessage }
  | { projectId: string; kind: "error"; message: string }
  | { projectId: string; kind: "concepts" }
  | { projectId: string; kind: "memory" }
  | { projectId: string; kind: "path" }
  | { projectId: string; kind: "done" };

/**
 * One turn at a time, per project.
 *
 * The conversation is stored rather than held in the window: a teaching thread
 * that reset on every launch would leave the agent unable to refer to anything
 * it had already taught, which is most of what makes it a mentor rather than a
 * chatbot.
 */
export class AgentService {
  private readonly worker: UtilityClient;
  /** Which project each in-flight request belongs to, so a tool call arriving
   *  from the worker can be resolved against the right directory. */
  private readonly running = new Map<string, string>();
  /** Questions the agent is waiting on, by project. A turn genuinely blocks
   *  here — the agent asked, and the answer is what it continues from. */
  private readonly awaiting = new Map<string, { resolve(answer: string): void }>();
  /**
   * The steps of each turn in flight, accumulated so they can be stored on the
   * reply.
   *
   * Without this a finished turn has no account of itself: the live stream
   * draws tool rows while the turn runs and then the run is dropped, so
   * reopening a project showed prose with no sign that the agent had read a
   * file, run a command, or recorded a concept. The transcript renders a stored
   * message from `activity`, and it was being written empty.
   */
  private readonly activity = new Map<string, AgentActivityStep[]>();

  constructor(
    private readonly store: ProjectStore,
    private readonly providers: ProviderService,
    private readonly workspace: WorkspaceService,
    private readonly memory: MemoryService,
    private readonly path: PathService,
    private readonly web: WebSearchService,
    private readonly emit: (event: AgentEvent) => void,
    private readonly stream: (event: AgentStreamEvent) => void,
  ) {
    this.worker = new UtilityClient(
      "agent",
      (event) => {
        const requestId = String(event.requestId ?? "");
        const projectId = this.running.get(requestId);
        if (!projectId) return;

        /* Passed through as the transcript's own shape, stamped with the run and
           the project. The worker knows only its request id, so the projectId a
           card needs to claim the work has to be added here. */
        this.stream({ ...(event as Record<string, unknown>), runId: requestId, projectId } as unknown as AgentStreamEvent);

        const steps = this.activity.get(requestId);
        if (steps) steps.push(...stepsFor(event));

        /* The status line beside the composer wants one short phrase, which is
           the agent's prose rather than its tool rows. */
        if (event.type === "text" && typeof event.text === "string" && event.text.trim()) {
          this.emit({ projectId, kind: "step", text: event.text });
        }
      },
      (name, input, context) => this.executeTool(name, input, context.requestId),
    );
  }

  messages(projectId: string): AgentMessage[] {
    return this.store.listMessages(projectId);
  }

  /** Answers the question the agent is waiting on. Ignored when nothing is
   *  waiting, so a stale answer from a reopened window cannot unblock a turn
   *  that already moved on. */
  answer(projectId: string, value: string): void {
    const waiting = this.awaiting.get(projectId);
    this.awaiting.delete(projectId);
    waiting?.resolve(value);
  }

  async send(projectId: string, body: string): Promise<void> {
    const project = this.store.readProject(projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    if (!project.present) throw new Error(`Construct cannot find ${project.directory}.`);

    const question: AgentMessage = { id: randomUUID(), role: "learner", body, createdAt: new Date().toISOString(), activity: [] };
    this.store.appendMessage(projectId, question);
    this.emit({ projectId, kind: "message", message: question });

    await this.runTurn(projectId, { history: true });
  }

  /**
   * What happens when a project is created: read up, then start teaching.
   *
   * Two runs, and the order is the point. The research pass writes research.md
   * from the goal the learner just typed, with the web and the workspace but no
   * ability to teach or to touch their files; the mentor then opens the project
   * having already read it. v0.7 did exactly this, and the difference it makes is
   * whether the learner's first screen is "hello, what would you like to build?"
   * — which they just answered — or the first real step of their project.
   *
   * Never awaited by the caller. Creating a project returns as soon as the
   * directory exists; this runs behind it and reports itself through the same
   * events as any other turn, so the window shows it happening.
   */
  async begin(projectId: string): Promise<void> {
    const project = this.store.readProject(projectId);
    if (!project) return;

    /* Memory first, and before research, because research writes into it. */
    await this.memory.ensure(project);

    const research = await this.runTurn(projectId, {
      history: false,
      systemPrompt: RESEARCH_AGENT_PROMPT,
      message: researchRequest(project),
      /* No writing, no commands, no teaching: this pass exists to read. Handing
         it the mentor's tools would let a research run start setting tasks
         before anything is known about the learner. */
      tools: ["read-file", "list-files", "flow-memory-fetch", "flow-memory-patch", "web-search", "web-fetch"],
      /* Kept out of the transcript. The learner asked for a project, not for a
         literature review, and the research is durable in research.md where it
         belongs — but its tool rows still stream, so the window shows the work
         rather than an unexplained wait. */
      record: false,
    });

    /* If the research run replied without saving anything, the host saves it.
       
       v0.7 did exactly this and it is not belt-and-braces: the pass is worth
       nothing unless research.md ends up written, and a model that answers with
       a good summary but forgets the tool call is a common enough failure that
       leaving the file at its starter — which is what happened the first time
       this ran — throws away the whole run and the tokens it cost. */
    if (research.ok && research.lastText.trim() && !research.steps.some(wroteResearch)) {
      /* The last step's prose, not the aggregate: the aggregate carries the
         narration from every earlier step, and research.md is a document rather
         than a log of how it was written. */
      await this.memory.update(project.directory, [{ file: "research.md", content: researchDocument(research.lastText) }]);
      this.emit({ projectId, kind: "memory" });
    }

    await this.runTurn(projectId, { history: true, message: openingRequest(research.ok) });
  }

  /**
   * One run of the agent, whatever the run is for.
   *
   * The single place a turn is assembled and settled: the mentor's reply, the
   * research pass and the opening handoff differ only in which prompt they use,
   * which tools they are given, and whether what they say is kept.
   */
  private async runTurn(
    projectId: string,
    options: {
      /** Whether the stored conversation is sent. False for research, which is
       *  about the project rather than about anything the learner said. */
      history: boolean;
      /** An instruction to run now, appended after any history. */
      message?: string;
      /** Overrides the mentor prompt. */
      systemPrompt?: string;
      /** Restricts the tool set. All of them when omitted. */
      tools?: string[];
      /** Whether the reply is stored as a message in the transcript. */
      record?: boolean;
    },
  ): Promise<{ ok: boolean; text: string; lastText: string; steps: AgentActivityStep[] }> {
    const project = this.store.readProject(projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    if (!project.present) throw new Error(`Construct cannot find ${project.directory}.`);

    /* Resolved per turn rather than cached: the learner can connect a provider
       or switch models between turns, and a cached credential would keep using
       the one they moved away from. */
    const resolved = (await this.providers.resolve("local", null))[0];
    if (!resolved) throw new Error("Connect a model in Settings before starting a conversation.");

    const history = options.history
      ? this.store.listMessages(projectId).map((message) =>
          message.role === "learner"
            ? ({ role: "user", content: message.body } as const)
            : ({ role: "assistant", content: message.body } as const),
        )
      : [];
    const messages = options.message ? [...history, { role: "user", content: options.message } as const] : history;

    /* One id for the turn, generated here and used as both the worker's
       request id and this map's key.
       
       These were two different UUIDs: the map was keyed by the IPC envelope's
       id while the worker reported tool calls under the payload's requestId.
       Every lookup therefore missed, and every tool call the agent made came
       back "That project is no longer open" — an agent that could talk but
       could not read a single file. */
    const turnId = randomUUID();
    this.running.set(turnId, projectId);
    this.activity.set(turnId, []);

    const { promise } = this.worker.request("turn", {
      requestId: turnId,
      provider: {
        provider: resolved.provider,
        model: resolved.model,
        api: resolved.api,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        reasoningEffort: resolved.reasoningEffort,
      },
      stateSuffix: this.stateSuffix(project),
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      messages,
    });

    try {
      const result = (await promise) as { text: string; lastText?: string };
      const steps = this.activity.get(turnId) ?? [];
      if (options.record !== false) {
        const reply: AgentMessage = {
          id: randomUUID(),
          role: "agent",
          body: result.text,
          createdAt: new Date().toISOString(),
          /* Stored with the reply, so the turn still accounts for itself after
             the live run is gone. */
          activity: steps,
        };
        this.store.appendMessage(projectId, reply);
        this.emit({ projectId, kind: "message", message: reply });
      }
      return { ok: true, text: result.text ?? "", lastText: result.lastText ?? result.text ?? "", steps };
    } catch (cause) {
      this.emit({ projectId, kind: "error", message: cause instanceof Error ? cause.message : "The agent could not finish that turn." });
      return { ok: false, text: "", lastText: "", steps: this.activity.get(turnId) ?? [] };
    } finally {
      this.running.delete(turnId);
      this.activity.delete(turnId);
      /* A turn that ended while the agent was waiting on an answer must not
         leave the window blocked on a question nobody will read. */
      this.awaiting.delete(projectId);
      this.emit({ projectId, kind: "done" });
    }
  }

  /**
   * The project state appended to the prompt, as v0.7 appended it.
   *
   * The path belongs here rather than only in `path.md`: it is the state the
   * agent has to honour on every turn — what it decided to teach next — and a
   * fact that important should not depend on the model choosing to fetch a
   * memory file first.
   */
  private stateSuffix(project: { id: string; name: string; goal: string; language: string }): string {
    const nodes = this.store.listPathNodes(project.id);
    const currentId = this.store.currentPathNode(project.id);
    const lines = [
      `Current project: ${project.name}`,
      `Project goal: ${project.goal}`,
      `Project language: ${project.language}`,
      `Flow Memory lives in .construct/ — research.md, project.md, path.md, learner.md. Fetch it with flow-memory-fetch; record durable changes with flow-memory-patch.`,
    ];

    if (nodes.length === 0) {
      lines.push("Path: not planned yet. Use plan-learning-path once you know enough about the learner and the project.");
    } else {
      const current = nodes.find((node) => node.id === currentId);
      lines.push(`Path: ${nodes.length} step${nodes.length === 1 ? "" : "s"}; now on ${current ? `"${current.title}"` : "no step"}.`);
      lines.push(...nodes.map((node) => `  ${node.order + 1}. [${node.status}] ${node.title}`));
    }

    return lines.join("\n");
  }

  stop(): void {
    this.worker.stop();
  }

  private async executeTool(name: string, input: unknown, requestId: string): Promise<unknown> {
    const projectId = this.running.get(requestId);
    const project = projectId ? this.store.readProject(projectId) : null;
    if (!projectId || !project) throw new Error("That project is no longer open.");

    return executeAgentTool(name, input, {
      projectDirectory: project.directory,
      workspace: this.workspace,
      readMemory: (files) => this.memory.read(project.directory, files),
      patchMemory: async (patches) => {
        const results = await this.memory.patch(project.directory, patches);
        /* The window re-reads memory after a turn touches it, the same way it
           re-reads concepts: memory is shown, so a silent write would leave the
           panel describing a project state that has moved on. */
        this.emit({ projectId, kind: "memory" });
        return results;
      },
      planPath: async (input) => {
        const planned = await this.path.plan(project, input);
        this.emit({ projectId, kind: "path" });
        return planned;
      },
      webSearch: (query, limit) => this.web.search(query, limit),
      webFetch: (urls) => this.web.fetch(urls),
      recordConcept: (record) => {
        if (!record.conceptId || !record.title) return;
        this.store.recordConcept({ projectId, ...record });
        this.emit({ projectId, kind: "concepts" });
      },
      askLearner: (request) =>
        new Promise<string>((resolve) => {
          this.awaiting.set(projectId, { resolve });
          this.emit({
            projectId,
            kind: "question",
            request: {
              id: randomUUID(),
              questions: [
                {
                  header: request.header ?? "Question",
                  question: request.question,
                  /* An open question keeps no options: Spar's card falls through
                     to its free-text branch, which is the right shape for a
                     question the agent did not enumerate answers for. Inventing
                     choices to satisfy a schema would put words in its mouth. */
                  options: (request.choices ?? []).map((label) => ({ label })).slice(0, 6),
                  multiple: false,
                  custom: request.allowOther,
                },
              ],
            } as AskUserQuestionRequest,
          });
        }),
    });
  }
}

/**
 * Turns one worker event into the steps the transcript stores.
 *
 * Only the end of a tool call becomes a step: the start already drew a row in
 * the live stream, and storing both would leave every call listed twice in the
 * saved turn.
 */
function stepsFor(event: Record<string, unknown>): AgentActivityStep[] {
  const type = String(event.type ?? "");

  if (type === "tool" && event.phase === "end") {
    const tool = String(event.tool ?? "");
    return [
      {
        kind: "tool",
        tool,
        label: TOOL_LABEL[tool] ?? tool,
        actionTitle: "",
        detail: String(event.detail ?? ""),
        ok: event.ok !== false,
        text: "",
        seconds: 0,
        input: String(event.input ?? ""),
        output: String(event.output ?? ""),
      },
    ];
  }

  if (type === "reasoning" && typeof event.text === "string" && event.text.trim()) {
    return [{ kind: "reasoning", tool: "", label: "", actionTitle: "", detail: "", ok: true, text: event.text, seconds: 0, input: "", output: "" }];
  }

  return [];
}

/** What each tool is called in the transcript. The learner's words for the
 *  action, not the tool's identifier. */
const TOOL_LABEL: Record<string, string> = {
  "read-file": "Read a file",
  "write-file": "Wrote a file",
  "list-files": "Looked through the project",
  "run-terminal-command": "Ran a command",
  "record-concept": "Recorded what you understand",
  ask_user_question: "Asked you a question",
};
