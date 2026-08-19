import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@construct/domain";
import type { AskUserQuestionRequest } from "@construct/domain";
import type { ProjectStore } from "../store/projectStore.js";
import type { ProviderService } from "../provider.js";
import type { WorkspaceService } from "../projects/workspaceService.js";
import { UtilityClient } from "../utilityClient.js";
import { executeAgentTool } from "./agentTools.js";

export type AgentEvent =
  | { projectId: string; kind: "step"; text: string }
  | { projectId: string; kind: "question"; request: AskUserQuestionRequest }
  | { projectId: string; kind: "message"; message: AgentMessage }
  | { projectId: string; kind: "error"; message: string }
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

  constructor(
    private readonly store: ProjectStore,
    private readonly providers: ProviderService,
    private readonly workspace: WorkspaceService,
    private readonly emit: (event: AgentEvent) => void,
  ) {
    this.worker = new UtilityClient(
      "agent",
      (event) => {
        const projectId = this.running.get(String(event.requestId ?? ""));
        if (!projectId) return;
        if (event.type === "step" && typeof event.text === "string" && event.text.trim()) {
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

    /* Resolved per turn rather than cached: the learner can connect a provider
       or switch models between turns, and a cached credential would keep using
       the one they moved away from. */
    const resolved = (await this.providers.resolve("local", null))[0];
    if (!resolved) throw new Error("Connect a model in Settings before starting a conversation.");

    const question: AgentMessage = { id: randomUUID(), role: "learner", body, createdAt: new Date().toISOString(), activity: [] };
    this.store.appendMessage(projectId, question);
    this.emit({ projectId, kind: "message", message: question });

    const history = this.store.listMessages(projectId).map((message) =>
      message.role === "learner"
        ? ({ role: "user", content: message.body } as const)
        : ({ role: "assistant", content: message.body } as const),
    );

    const { id, promise } = this.worker.request("turn", {
      requestId: randomUUID(),
      provider: {
        provider: resolved.provider,
        model: resolved.model,
        api: resolved.api,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        reasoningEffort: resolved.reasoningEffort,
      },
      stateSuffix: `Current project: ${project.name}\nProject goal: ${project.goal}\nProject language: ${project.language}`,
      messages: history,
    });
    this.running.set(id, projectId);

    try {
      const result = (await promise) as { text: string };
      const reply: AgentMessage = {
        id: randomUUID(),
        role: "agent",
        body: result.text,
        createdAt: new Date().toISOString(),
        activity: [],
      };
      this.store.appendMessage(projectId, reply);
      this.emit({ projectId, kind: "message", message: reply });
    } catch (cause) {
      this.emit({ projectId, kind: "error", message: cause instanceof Error ? cause.message : "The agent could not finish that turn." });
    } finally {
      this.running.delete(id);
      /* A turn that ended while the agent was waiting on an answer must not
         leave the window blocked on a question nobody will read. */
      this.awaiting.delete(projectId);
      this.emit({ projectId, kind: "done" });
    }
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
                  /* The schema wants at least two options. A question the agent
                     asked without any is an open one, so it is presented as
                     free text rather than invented choices. */
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
