import { randomUUID } from "node:crypto";
import { LANGUAGES } from "@construct/domain";
import type { AgentActivityStep, AgentMessage } from "@construct/domain";
import type { AgentStreamEvent, LearnerOpening, LearnerProfile, learnerDraftInput } from "../../shared/api.js";
import type { z } from "zod";
import { cleanOpenings, composeOpenings, composePortrait, profilePromptBlock } from "../learner/learnerProfile.js";
import type { AskUserQuestionRequest } from "@construct/domain";
import type { ProjectStore } from "../store/projectStore.js";
import type { ProviderService } from "../provider.js";
import type { WorkspaceService } from "../projects/workspaceService.js";
import type { MemoryService } from "../memory/memoryService.js";
import type { PathService } from "../learning/pathService.js";
import type { WebSearchService } from "../webSearch.js";
import type { SnapshotService } from "../projects/snapshotService.js";
import type { LearnerProfileService } from "../learner/learnerProfile.js";
import { UtilityClient } from "../utilityClient.js";
import { executeAgentTool } from "./agentTools.js";
import { openingRequest, RESEARCH_AGENT_PROMPT, researchDocument, researchRequest, wroteResearch } from "./researchPrompt.js";
import { replayTurn, settleTurnActivity } from "./turnRecord.js";
import { claimProject, projectBusy } from "./turnRouting.js";

/** The intake's answers so far, as the two completions below receive them. */
type LearnerDraft = z.infer<typeof learnerDraftInput>;

export type AgentEvent =
  /* A turn has begun, and why.
     
     Emitted for every turn rather than only for the learner's, because the
     window cannot otherwise tell that Construct is working: research and the
     opening turn are started by the main process, and the panel used to draw
     live rows only for turns the composer itself had sent. A project therefore
     opened to a blank thread while the agent read up on it — the work was
     happening and none of it was visible. */
  | { projectId: string; kind: "started"; phase: "research" | "opening" | "reply" }
  | { projectId: string; kind: "step"; text: string }
  | { projectId: string; kind: "question"; request: AskUserQuestionRequest }
  | { projectId: string; kind: "message"; message: AgentMessage }
  | { projectId: string; kind: "error"; message: string }
  | { projectId: string; kind: "concepts" }
  /* A practice task was set, corrected, or judged. */
  | { projectId: string; kind: "tasks" }
  /* The project named itself. Creating one takes a literal name off the front
     of the goal so the folder exists immediately; the model writes the real one
     behind the window, and this is how the window hears about it. */
  | { projectId: string; kind: "renamed"; name: string }
  /* History was rewound to an earlier message; the transcript re-reads. */
  | { projectId: string; kind: "rewound" }
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
/** One `ask_user_question` call still waiting on the learner. */
type PendingQuestion = {
  request: AskUserQuestionRequest;
  resolve(answer: string): void;
  reject(error: Error): void;
};

/**
 * The two lines the kickoff leaves in the transcript.
 *
 * Constants because they are read back as well as written: resuming a
 * part-started project asks which of these is already there to decide whether
 * the reading pass has to run again, and a note that is matched by its text has
 * to be matched against the text that was actually stored.
 */
const RESEARCH_DONE = "Read up on this project before starting. Saved to .construct/research.md";
const RESEARCH_FAILED = "Could not read up on this project before starting. Teaching anyway, and you can ask for background any time.";

export class AgentService {
  private readonly worker: UtilityClient;
  /** Which project each in-flight request belongs to, so a tool call arriving
   *  from the worker can be resolved against the right directory. */
  private readonly running = new Map<string, string>();
  /** A project kickoff is active before research creates its first `running`
   * turn. Without this guard, create + immediate open launched the kickoff
   * twice and left two tools waiting for one learner answer. */
  private readonly starting = new Set<string>();
  /**
   * What each busy project is doing, so a window that was not watching can ask.
   *
   * Every other signal about a running turn is an event, and an event is only
   * any use to whoever was listening when it fired. A panel that mounts after a
   * turn starts — the workspace opening onto a project that was created
   * seconds ago, the chat pane being toggled, a reload in development — missed
   * `started` and has no way to find out. What it drew instead was an empty
   * thread, which is indistinguishable from a project where nothing ran at all.
   */
  private readonly phases = new Map<string, "research" | "opening" | "reply">();
  /**
   * Questions the agent is waiting on, by project, oldest first.
   *
   * A turn genuinely blocks here — the agent asked, and the answer is what it
   * continues from. It is a queue rather than a single slot because a model may
   * emit two `ask_user_question` calls in one step, and the second one has to
   * block too. Rejecting it instead, as this did, was worse than useless: a
   * rejected tool is still a *result*, so the loop carried straight on
   * thinking, reading files and talking while the first question sat unanswered
   * on screen. Only the head is shown; the next is put up when it is answered.
   */
  private readonly awaiting = new Map<string, PendingQuestion[]>();
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
  /* Narration in progress, per run. The status line wants a phrase; the stream
     delivers tokens. Buffered here and released a sentence at a time. */
  private readonly narration = new Map<string, string>();
  /**
   * Everything the agent has streamed this run, kept whole.
   *
   * `narration` cannot serve here: it is drained a sentence at a time as the
   * status line consumes it, so what is left is only the unfinished tail.
   *
   * This exists because a reply used to be stored only when the turn resolved.
   * The learner watched a full answer stream in, the turn then failed on its
   * way out — a tool erroring, the worker dropping, the model's final promise
   * rejecting — and the catch threw away every token of it. Their own question
   * was on record with no answer under it, which reads exactly like an agent
   * that forgets. What was shown is now what is kept.
   */
  private readonly transcript = new Map<string, string>();
  /**
   * How to write down a turn that has not finished yet, by run id.
   *
   * A reply used to reach the database once, at the end of the turn. Turns here
   * run for minutes — reading files, searching the web, thinking out loud — and
   * quitting the app during one threw away every word of it: the learner came
   * back to their own message sitting alone with nothing under it. The turn now
   * writes itself down as it goes, under one id, so what was said survives the
   * app being closed on it. */
  private readonly pending = new Map<string, () => void>();
  /* When the thought currently being streamed began. Reasoning arrives as bare
     text with no timing of its own, so the only place its duration can be
     measured is here, as it lands. Without it every stored thought carried
     `seconds: 0` and the transcript rendered a uniform "Thought for 1s". */
  private readonly thinkingSince = new Map<string, number>();

  constructor(
    private readonly store: ProjectStore,
    private readonly providers: ProviderService,
    private readonly workspace: WorkspaceService,
    private readonly memory: MemoryService,
    private readonly path: PathService,
    private readonly web: WebSearchService,
    private readonly snapshots: SnapshotService,
    /* Who the agent is teaching. Read on every turn rather than fetched by a
       tool: a mentor who has to decide to look you up is a mentor who
       sometimes does not. */
    private readonly learner: LearnerProfileService,
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
        if (steps) {
          for (const step of stepsFor(event)) {
            /* Reasoning arrives a token at a time and has to be reassembled into
               the thought it came from. It used to arrive once per model step,
               so one event was one thought and appending was right; streaming
               made every token its own event, and appending turned a single
               thought into hundreds of stored steps — the transcript rendered
               each as its own "Thought for 1s" and the tool calls were lost in
               the drift. Consecutive reasoning joins the step it is continuing;
               a tool call in between still starts a new thought, because that
               is a genuinely separate one. */
            const tail = steps[steps.length - 1];
            if (step.kind === "reasoning" && tail?.kind === "reasoning") {
              tail.text += step.text;
              /* Restated on every token rather than closed at the end: the
                 thought has no end event, so the last token to arrive is the
                 only thing that knows how long it took. */
              tail.seconds = (Date.now() - (this.thinkingSince.get(requestId) ?? Date.now())) / 1_000;
            } else if (step.kind === "note" && tail?.kind === "note") {
              /* Prose is streamed as deltas too. Keep the block as one stored
                 note until a reasoning/tool boundary starts another row. */
              tail.text += step.text;
            } else if (step.kind === "reasoning" && !step.text.trim()) continue;
            else {
              if (step.kind === "reasoning") this.thinkingSince.set(requestId, Date.now());
              steps.push(step);
            }
          }
        }

        /* The status line beside the composer wants one short phrase, which is
           the agent's prose rather than its tool rows.
           
           Text arrives as tokens now, so this cannot forward every event or the
           line would flicker a word at a time. Deltas accumulate until the model
           finishes a sentence, and the line takes that sentence — which is the
           unit it was always showing, just assembled here instead of upstream. */
        if (event.type === "text" && typeof event.text === "string") {
          this.transcript.set(requestId, (this.transcript.get(requestId) ?? "") + event.text);
          const buffered = (this.narration.get(requestId) ?? "") + event.text;
          const boundary = Math.max(buffered.lastIndexOf("\n"), ...[".", "!", "?"].map((mark) => buffered.lastIndexOf(`${mark} `)));
          if (boundary <= 0) {
            this.narration.set(requestId, buffered);
          } else {
            const phrase = buffered.slice(0, boundary + 1).trim();
            this.narration.set(requestId, buffered.slice(boundary + 1));
            if (phrase) this.emit({ projectId, kind: "step", text: phrase });
          }
        }
      },
      (name, input, context) => this.executeTool(name, input, context.requestId),
    );
  }

  /**
   * A short project name for a stated goal.
   *
   * Asked of the model rather than cut from the front of the goal. The old
   * derivation took the first six words and tidied them, so "How a triangle
   * gets from three points to lit pixels on screen" became "Triangle gets from
   * three points" — visibly a slice of a sentence rather than a name for
   * anything. A model reads the whole goal and names the subject.
   *
   * Returns null rather than throwing on any failure — no model connected, a
   * timeout, a refusal, an answer that is not a name. Naming must never be the
   * reason a project cannot be created, and the caller has a literal fallback.
   */
  async nameFor(goal: string): Promise<string | null> {
    const resolved = (await this.providers.resolve("local", null).catch(() => []))[0];
    if (!resolved) return null;

    const { promise } = this.worker.request("complete", {
      provider: {
        provider: resolved.provider,
        model: resolved.model,
        api: resolved.api,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        reasoningEffort: resolved.reasoningEffort,
      },
      instructions: NAME_PROMPT,
      input: goal,
    });

    /* Bounded, because this runs while a dialog waits on it. A slow model must
       degrade to the literal name rather than hold the button. */
    const answer = await Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]).catch(() => null);

    return cleanName(typeof answer === "string" ? answer : "");
  }

  /**
   * One short completion against the learner's own model.
   *
   * Shared by everything that wants a sentence rather than a turn: naming a
   * project, and the two pieces of the intake below. Returns null on anything
   * at all going wrong — no provider, a timeout, a refusal — because every
   * caller has something sensible to do without it, and none of them may become
   * the reason a learner is stuck on a screen.
   */
  private async complete(instructions: string, input: string, timeoutMs: number): Promise<string | null> {
    const resolved = (await this.providers.resolve("local", null).catch(() => []))[0];
    if (!resolved) return null;

    const { promise } = this.worker.request("complete", {
      provider: {
        provider: resolved.provider,
        model: resolved.model,
        api: resolved.api,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        reasoningEffort: resolved.reasoningEffort,
      },
      instructions,
      input,
    });

    const answer = await Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]).catch(() => null);

    const text = typeof answer === "string" ? answer.trim() : "";
    return text.length > 0 ? text : null;
  }

  /**
   * The one question Construct asks this person and nobody else.
   *
   * This is the whole point of the intake being more than a form. Four fixed
   * questions get you a category; a fifth, written from the answers to the
   * first four, gets you the thing that was actually worth knowing — and it is
   * the moment the learner can tell that something read what they wrote.
   *
   * Null when no model answers. The intake skips the step rather than showing a
   * spinner that never resolves; a missing question costs a little colour, and
   * a stalled sign-up costs the learner.
   */
  async learnerQuestion(draft: LearnerDraft): Promise<string | null> {
    const question = await this.complete(QUESTION_PROMPT, describeDraft(draft), 12_000);
    return question ? cleanQuestion(question) : null;
  }

  /**
   * The portrait: what Construct understood, in the second person.
   *
   * Never empty. A model writes it when one can be reached, and
   * `composePortrait` writes it here when one cannot — because the last screen
   * of an intake is not the place to tell someone their provider is down.
   */
  async learnerPortrait(draft: LearnerDraft): Promise<string> {
    const written = await this.complete(PORTRAIT_PROMPT, describeDraft(draft), 15_000);
    const cleaned = written ? cleanPortrait(written) : null;
    return cleaned ?? composePortrait({ ...draft, followUp: draft.followUp });
  }

  /**
   * One project worth starting, for this person, knowing what has already been
   * offered.
   *
   * The intake's last screen used to be a button that said "Start building" and
   * led to an empty project list — which asks someone who has just explained
   * what they want to build to describe it again, in a dialog, as a goal. The
   * answers are right there. This spends them.
   *
   * One at a time, rather than three in one answer, and that is a change of
   * design and not only of plumbing. Three in one answer is a screen that is
   * blank for twenty-five seconds and then full, which the learner has no
   * reason to read as thinking; a card at a time is a screen where the first
   * suggestion can be read — and started — while the third is still being
   * written. It also makes each one better: `taken` carries the cards already
   * on screen, so "different in kind from these" is a fact the model has rather
   * than an instruction it has to remember.
   *
   * JSON rather than prose, because a card is four fields and parsing that out
   * of a paragraph is guesswork. Null is never returned: `composeOpenings`
   * holds a written-here suggestion for every footing, and the screen this
   * feeds cannot be a shrug.
   */
  async learnerOpening(draft: LearnerDraft, taken: LearnerOpening[]): Promise<LearnerOpening> {
    const written = await this.complete(OPENING_PROMPT, describeOffered(draft, taken), 20_000);
    const offered = written ? cleanOpenings(written, draft.language) : [];
    const named = new Set(taken.map((entry) => entry.name.toLowerCase()));
    const fresh = offered.find((entry) => !named.has(entry.name.toLowerCase()));
    if (fresh) return fresh;
    /* Written here, and the first one that is not already on the screen — the
       fallbacks are a ladder of three per footing, so asking for the second
       card after a model failure gets the second rung rather than the first
       again. */
    const ladder = composeOpenings(draft);
    const composed = ladder.find((entry) => !named.has(entry.name.toLowerCase())) ?? ladder[0];
    /* Three per footing, and at most two are ever taken, so the ladder always
       answers. This branch is the type system's, not a real one. */
    if (!composed) throw new Error("Construct could not think of a project to suggest.");
    return composed;
  }

  /**
   * Stops the turn running for this project, if there is one.
   *
   * Real cancellation, not a hidden one: the worker aborts Mastra's loop, which
   * stops it between steps as well as mid-stream. That distinction matters
   * because a turn nobody is watching still calls tools, and a tool call writes
   * to the learner's own files.
   *
   * What the model had already said is kept — `runTurn` records the streamed
   * text on the way out — so stopping ends the turn rather than erasing it.
   */
  async stopTurn(projectId: string): Promise<void> {
    const turnId = [...this.running.entries()].find(([, id]) => id === projectId)?.[0];
    if (!turnId) return;
    /* Any question this turn was blocking on dies with it, or the next turn
       would start with a tool still waiting for an answer nobody will give. */
    this.dropQuestions(projectId);
    await this.worker.request("abort", { requestId: turnId }).promise.catch(() => undefined);
  }

  /** Whether a turn is already running for this project. Opening a project
   *  twice in quick succession must not start two of them. */
  busy(projectId: string): boolean {
    return projectBusy(this.starting, this.running, projectId);
  }

  /** Whether a turn is in flight for this project, and what kind. Asked by the
   *  window on arrival, so a turn already under way is drawn as one.
   *
   *  The question comes back with it because the card that asks it lives in the
   *  window, while the turn waiting on the answer lives here. Collapsing the
   *  chat pane unmounts that card, and the window had no way to ask what it had
   *  been showing: the pane reopened on a composer, over a turn still blocked on
   *  a question the learner could no longer see or answer. */
  status(projectId: string): { running: boolean; phase: "research" | "opening" | "reply" | null; question: AskUserQuestionRequest | null } {
    const running = this.busy(projectId);
    return {
      running,
      phase: running ? (this.phases.get(projectId) ?? null) : null,
      /* Only the head, matching what `askLearner` puts on screen. */
      question: this.awaiting.get(projectId)?.[0]?.request ?? null,
    };
  }

  messages(projectId: string): AgentMessage[] {
    return this.store.listMessages(projectId);
  }

  /** Answers the question the agent is waiting on. Ignored when nothing is
   *  waiting, so a stale answer from a reopened window cannot unblock a turn
   *  that already moved on. */
  answer(projectId: string, value: string): void {
    const queue = this.awaiting.get(projectId);
    const head = queue?.shift();
    if (!queue || !head) throw new Error("That question is no longer waiting for an answer.");
    /* The next question goes up before this answer is handed back, so the card
       never blinks out between two questions of the same turn. */
    if (queue.length) this.emit({ projectId, kind: "question", request: queue[0]!.request });
    else this.awaiting.delete(projectId);
    head.resolve(value);
  }

  /**
   * Ends every question this project is waiting on.
   *
   * Rejected, not merely forgotten. Dropping the entry left the tool's promise
   * unsettled forever: the worker kept a pending call for a turn that was over,
   * and the learner's answer to the visible card threw "no longer waiting"
   * because the map it looked in had already been cleared.
   */
  private dropQuestions(projectId: string): void {
    const queue = this.awaiting.get(projectId);
    if (!queue) return;
    this.awaiting.delete(projectId);
    for (const pending of queue) pending.reject(new Error("The turn ended before that question was answered."));
  }

  async send(projectId: string, body: string): Promise<void> {
    const project = this.store.readProject(projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    if (!project.present) throw new Error(`Construct cannot find ${project.directory}.`);

    const question: AgentMessage = { id: randomUUID(), role: "learner", body, createdAt: new Date().toISOString(), activity: [] };
    /* Before the message is stored, not after: the snapshot is the project as
       it was when the learner asked, and the turn that follows is what it
       undoes. */
    await this.snapshot(projectId, project.directory, question.id);
    this.store.appendMessage(projectId, question);
    this.emit({ projectId, kind: "message", message: question });

    await this.runTurn(projectId, { history: true, phase: "reply" });
  }

  /**
   * Records an undo point for a turn about to start.
   *
   * Never throws. A project too large to snapshot, or a disk that will not read,
   * costs the learner the ability to edit that one message — it must not cost
   * them the turn itself.
   */
  private async snapshot(projectId: string, directory: string, messageId: string): Promise<void> {
    try {
      const captured = await this.snapshots.capture(directory);
      if (!captured) return;
      this.store.saveSnapshot({
        projectId,
        messageId,
        files: captured.files,
        blobs: captured.blobs,
        concepts: this.store.listConcepts(projectId),
        tasks: this.store.listTasks(projectId),
        pathNodes: this.store.listPathNodes(projectId),
        currentPathNode: this.store.currentPathNode(projectId),
      });
    } catch (cause) {
      console.error("[construct] could not record an undo point", cause);
    }
  }

  /**
   * Rewrites an earlier message and runs the conversation again from there.
   *
   * Everything after that point is undone first — the files the agent wrote,
   * the concepts it recorded, the tasks it set, the path it planned, and the
   * messages themselves. Rewinding the conversation without the disk would
   * leave the learner holding code the transcript no longer explains, which is
   * the reason this is snapshot-based rather than a delete of some rows.
   *
   * The turn in flight is stopped first. Editing history under a running turn
   * would have it finish into a conversation that no longer contains the
   * message it was answering.
   */
  async editMessage(projectId: string, messageId: string, body: string): Promise<void> {
    const project = this.store.readProject(projectId);
    if (!project) throw new Error("That project is no longer in Construct.");
    if (!project.present) throw new Error(`Construct cannot find ${project.directory}.`);

    const snapshot = this.store.snapshot(projectId, messageId);
    if (!snapshot) throw new Error("Construct did not record an undo point for that message, so it cannot go back to it.");

    await this.stopTurn(projectId);
    /* The files first. If restoring fails the database is untouched, so the
       project still matches its transcript — the reverse would leave a
       conversation describing files that were never put back. */
    await this.snapshots.restore(project.directory, snapshot.files, (hash) => this.store.readBlob(hash));
    this.store.rewindTo(projectId, snapshot);

    this.emit({ projectId, kind: "concepts" });
    this.emit({ projectId, kind: "tasks" });
    this.emit({ projectId, kind: "path" });
    this.emit({ projectId, kind: "memory" });
    this.emit({ projectId, kind: "rewound" });

    await this.send(projectId, body);
  }

  /**
   * Redirects a turn already in flight.
   *
   * Mastra's loop takes messages once, at the start, and has no way to add one
   * while it runs — so steering is a stop and a restart rather than an
   * injection. What the agent had already said is kept and goes into the
   * history, so the next turn sees its own half-finished answer above the
   * correction, which is what makes the correction read as one.
   */
  async steer(projectId: string, body: string): Promise<void> {
    await this.stopTurn(projectId);
    /* The stopped turn records its reply on the way out, and that write has to
       land before the next turn reads the history — otherwise the model is
       asked to continue from a conversation missing its own last answer. */
    await this.settled(projectId);
    await this.send(projectId, body);
  }

  /** Resolves once no turn is running for this project. Bounded, because a
   *  worker that never answers must not leave the composer wedged. */
  private async settled(projectId: string, timeoutMs = 5_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (projectBusy(this.starting, this.running, projectId) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
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
    if (!claimProject(this.starting, this.running, projectId)) return;
    /* Set before the first turn exists. `begin` holds the project from the
       moment it is called, and the seconds it spends writing memory files
       before research starts are seconds a window would otherwise describe as
       nothing happening. */
    this.phases.set(projectId, "research");
    try {
      await this.beginOnce(projectId);
    } finally {
      this.starting.delete(projectId);
      this.phases.delete(projectId);
    }
  }

  private async beginOnce(projectId: string): Promise<void> {
    const project = this.store.readProject(projectId);
    if (!project) return;

    /* What of this has already happened.
       
       A kickoff is two turns with a stored note between them, and anything that
       ends the process in the middle — a quit, a crash, a reload in
       development — leaves a project part-started. Resuming used to mean an
       empty thread, so a project interrupted after the research note was never
       resumed at all: it had a message, so it counted as started, and the turn
       that actually teaches never ran. A window opened on it showed one line
       about reading up and then silence, for good.
       
       These two facts are what "started" really means. A learner or agent
       message is teaching under way and there is nothing to resume; a system
       message is the research pass already paid for, and it is not paid for
       twice. */
    const sofar = this.store.listMessages(projectId);
    if (sofar.some((message) => message.role === "agent" || message.role === "learner")) return;
    const researched = sofar.some((message) => message.role === "system");

    /* The name first, and not awaited by anything after it.
       
       Creating a project cannot wait on a model — the folder has to exist the
       moment the button is pressed — so it is created under a literal name cut
       from the goal, and the real one lands here, seconds later, while the
       learner is already reading the first turn. Asking in the dialog instead
       meant a request per pause in typing for a name that is used once.
       
       Only the name in the database changes. The folder keeps the name it was
       created with: it is a path the learner may already have open in a
       terminal, and moving it to match a title is not worth surprising them. */
    if (!researched) void this.nameFor(project.goal)
      .then((name) => {
        if (!name || name === project.name) return;
        this.store.renameProject(projectId, name);
        this.emit({ projectId, kind: "renamed", name });
      })
      .catch(() => undefined);

    /* Memory first, and before research, because research writes into it. */
    await this.memory.ensure(project);

    const read = researched ? sofar.some((message) => message.body === RESEARCH_DONE) : await this.research(projectId, project);

    await this.runTurn(projectId, { history: true, message: openingRequest(read), phase: "opening" });
  }

  /**
   * The reading pass, and the line it leaves behind.
   *
   * Split out so that resuming a half-started project can skip it: the research
   * is durable in research.md and in the note, and a second pass would spend a
   * minute and the tokens to arrive back where it already is.
   *
   * Returns whether it worked, which is all the opening turn needs to know.
   */
  private async research(projectId: string, project: { id: string; goal: string; directory: string; name: string; language: string }): Promise<boolean> {
    const research = await this.runTurn(projectId, {
      history: false,
      systemPrompt: RESEARCH_AGENT_PROMPT,
      message: researchRequest(project),
      /* No writing, no commands, no teaching: this pass exists to read. Handing
         it the mentor's tools would let a research run start setting tasks
         before anything is known about the learner. */
      tools: ["read-file", "list-files", "flow-memory-fetch", "flow-memory-patch", "web-search", "web-fetch"],
      phase: "research",
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

    /* A line in the transcript saying the reading happened, and where it went.
       
       The research itself is not a chat message — it is a document, and it lives
       in the file — but a project that silently spent a minute on the web and
       then started teaching gives the learner no way to know that, or to go and
       read it. Stored rather than streamed, so it is still there next time the
       project is opened. */
    if (!research.ok) {
      /* Said out loud rather than swallowed.
         
         A failed research pass used to leave nothing behind — no message, no
         note, no research.md — so a project that failed to start looked exactly
         like one that had not been opened yet, and nothing ever said why. The
         opening turn still runs after this: research is worth having and not
         worth blocking a project on. */
      const failed: AgentMessage = {
        id: randomUUID(),
        role: "system",
        body: RESEARCH_FAILED,
        createdAt: new Date().toISOString(),
        activity: research.steps,
      };
      this.store.appendMessage(projectId, failed);
      this.emit({ projectId, kind: "message", message: failed });
    }

    if (research.ok) {
      const note: AgentMessage = {
        id: randomUUID(),
        role: "system",
        body: RESEARCH_DONE,
        createdAt: new Date().toISOString(),
        activity: research.steps,
      };
      this.store.appendMessage(projectId, note);
      this.emit({ projectId, kind: "message", message: note });
    }

    return research.ok;
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
      /** What this run is, for the window's benefit. */
      phase: "research" | "opening" | "reply";
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

    /* Turns replay as what they did, not only as what they said — see
       `replayTurn`. An empty entry is dropped rather than sent: a stopped turn
       that called tools without speaking used to arrive as an assistant message
       with no content at all, which reads to the model as a turn where it had
       nothing to contribute. */
    const history = options.history
      ? this.store.listMessages(projectId).flatMap((message): { role: "user" | "assistant"; content: string }[] => {
          if (message.role === "learner") {
            return message.body.trim() ? [{ role: "user", content: message.body }] : [];
          }
          const content = replayTurn(message);
          return content.trim() ? [{ role: "assistant", content }] : [];
        })
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
    this.phases.set(projectId, options.phase);
    this.emit({ projectId, kind: "started", phase: options.phase });

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

    /* One id and one timestamp for the whole turn, fixed before a word of it
       arrives, because the row is written repeatedly as the turn runs and it
       has to be the same row each time — and it has to stay where it belongs in
       the transcript rather than jumping to the end when it finally settles. */
    const replyId = randomUUID();
    const createdAt = new Date().toISOString();

    /* Writes the reply the learner actually saw. Called from both the resolved
       and the failed path, because a turn that broke after saying something
       still said it, and the transcript is the record of what was said. */
    const record = (preferredBody: string): AgentActivityStep[] => {
      const settled = settleTurnActivity(this.activity.get(turnId), preferredBody);
      if (options.record === false || (!settled.body.trim() && settled.activity.length === 0)) return settled.activity;
      const reply: AgentMessage = {
        id: replyId,
        role: "agent",
        body: settled.body,
        createdAt,
        /* Stored with the reply, so the turn still accounts for itself after
           the live run is gone. */
        activity: settled.activity,
      };
      this.store.appendMessage(projectId, reply);
      this.emit({ projectId, kind: "message", message: reply });
      return settled.activity;
    };

    /* The same write, without the announcement.
       
       The window is already watching this turn stream; telling it about a
       half-written row would put the reply on screen twice. This is for the
       next launch, not for this one. */
    const checkpoint = () => {
      if (options.record === false) return;
      const settled = settleTurnActivity(this.activity.get(turnId), this.transcript.get(turnId) ?? "");
      if (!settled.body.trim() && settled.activity.length === 0) return;
      this.store.appendMessage(projectId, {
        id: replyId,
        role: "agent",
        body: settled.body,
        createdAt,
        activity: settled.activity,
      });
    };
    this.pending.set(turnId, checkpoint);
    /* Every few seconds rather than on every token: a turn produces thousands
       of events and a write per event would put the database on the path of the
       stream. Losing the last couple of seconds of a killed process is a
       different order of problem from losing the last ten minutes. */
    const saving = setInterval(() => {
      try {
        checkpoint();
      } catch (cause) {
        console.error("[construct] could not save an unfinished turn", cause);
      }
    }, 3_000);

    try {
      const result = (await promise) as { text: string; lastText?: string };
      /* `text` is every prose block concatenated by the provider. It is useful
         to research callers, but it is not one chat message: storing it moved
         narration from before each tool to the end of the turn. The final block
         is the reply body; earlier blocks are stored as ordered note steps. */
      const streamed = this.transcript.get(turnId) ?? "";
      const text = result.text?.trim() ? result.text : streamed;
      const lastText = result.lastText?.trim() ? result.lastText : text;
      const steps = record(lastText);
      return { ok: true, text: text ?? "", lastText: lastText ?? "", steps };
    } catch (cause) {
      const streamed = this.transcript.get(turnId) ?? "";
      const lastText = streamed;
      const steps = record(lastText);
      this.emit({ projectId, kind: "error", message: cause instanceof Error ? cause.message : "The agent could not finish that turn." });
      return { ok: false, text: streamed, lastText, steps };
    } finally {
      clearInterval(saving);
      this.pending.delete(turnId);
      this.running.delete(turnId);
      /* Only if nothing else is holding the project. A kickoff is two turns
         back to back, and clearing the phase between them would blink the
         window's "what is happening" line off and on again. */
      if (!projectBusy(this.starting, this.running, projectId)) this.phases.delete(projectId);
      this.activity.delete(turnId);
      this.narration.delete(turnId);
      this.transcript.delete(turnId);
      this.thinkingSince.delete(turnId);
      /* A turn that ended while the agent was waiting on an answer must not
         leave the window blocked on a question nobody will read. */
      this.dropQuestions(projectId);
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

    /* The global profile, before anything about this project.
       
       It is the frame the rest is read through — someone who has written Go for
       a decade and someone on their first week both get "Project language:
       python" here, and only this block tells the two apart. Empty until the
       learner has been through the intake, and empty is fine: the agent then
       does what it always did and asks. */
    lines.push(...profilePromptBlock(this.learner.read()));

    if (nodes.length === 0) {
      lines.push("Path: not planned yet. Use plan-learning-path once you know enough about the learner and the project.");
    } else {
      const current = nodes.find((node) => node.id === currentId);
      lines.push(`Path: ${nodes.length} step${nodes.length === 1 ? "" : "s"}; now on ${current ? `"${current.title}"` : "no step"}.`);
      lines.push(...nodes.map((node) => `  ${node.order + 1}. [${node.status}] ${node.title}`));
    }

    /* The concept tree, indented by depth.
       
       Here rather than behind a tool because placing a new concept correctly
       requires knowing what is already there, and a model that has to fetch the
       tree before every record-concept will sometimes skip the fetch and file
       everything at the top. The ids are included because the id is what
       `parentId` takes. */
    /* Open tasks, so the agent knows what it has already asked for.
       
       Without this it sets a second task for work that is still outstanding —
       it has no memory of the first beyond whatever is left in the transcript,
       and the transcript is exactly what gets truncated. */
    const tasks = this.store.listTasks(project.id).filter((task) => task.status !== "passed");
    if (tasks.length > 0) {
      lines.push(`Practice tasks outstanding (${tasks.length}):`);
      lines.push(
        ...tasks.map(
          (task) =>
            `  - [${task.status}] ${task.title} (${task.taskId}) — ${task.criteria.length} criteri${task.criteria.length === 1 ? "on" : "a"}`,
        ),
      );
      lines.push("Judge a submitted task with judge-practice-task before setting another.");
    }

    const concepts = this.store.listConcepts(project.id);
    if (concepts.length === 0) {
      lines.push("Concepts taught in this project: none yet.");
    } else {
      lines.push(`Concepts taught in this project (${concepts.length}), as a tree — use an id as parentId to nest under it:`);
      lines.push(...conceptOutline(concepts));
    }

    return lines.join("\n");
  }

  stop(): void {
    /* Written down before the worker dies. A clean quit is the common way a
       long turn ends early, and it is the one case where there is still time to
       save the whole of what the agent had said. */
    for (const checkpoint of this.pending.values()) {
      try {
        checkpoint();
      } catch (cause) {
        console.error("[construct] could not save an unfinished turn", cause);
      }
    }
    this.pending.clear();
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
      saveTask: (task) => {
        if (!task.taskId || !task.title) throw new Error("A practice task needs an id and a title.");
        const existing = this.store.listTasks(projectId).find((entry) => entry.taskId === task.taskId);
        this.store.saveTask(projectId, {
          ...task,
          /* Re-setting a task the learner already passed does not un-pass it;
             anything else goes back to open, because a corrected task is work
             to do again. */
          status: existing?.status === "passed" ? "passed" : "open",
          outcome: existing?.outcome ?? "",
        });
        this.emit({ projectId, kind: "tasks" });
      },
      judgeTask: (taskId, passed, outcome) => {
        this.store.setTaskStatus(projectId, taskId, passed ? "passed" : "open", outcome);
        this.emit({ projectId, kind: "tasks" });
      },
      recordConcept: (record) => {
        if (!record.conceptId || !record.title) return;
        const change = this.store.recordConcept({ projectId, ...record });
        this.emit({ projectId, kind: "concepts" });
        return change;
      },
      askLearner: (request) =>
        new Promise<string>((resolve, reject) => {
          const pending: PendingQuestion = {
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
            resolve,
            reject,
          };
          const queue = this.awaiting.get(projectId) ?? [];
          queue.push(pending);
          this.awaiting.set(projectId, queue);
          /* Only the head is on screen. A second question asked in the same
             step waits its turn — and, crucially, keeps its tool call
             outstanding, which is what actually stops the loop. */
          if (queue.length === 1) this.emit({ projectId, kind: "question", request: pending.request });
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

  /* Not trimmed: the caller joins consecutive reasoning deltas, and a delta that
     is only the space between two words still carries meaning there. Dropping
     it ran the words together. A whitespace-only delta with no thought to
     continue is discarded by the caller instead. */
  if (type === "reasoning" && typeof event.text === "string" && event.text) {
    return [{ kind: "reasoning", tool: "", label: "", actionTitle: "", detail: "", ok: true, text: event.text, seconds: 0, input: "", output: "" }];
  }

  if (type === "text" && typeof event.text === "string" && event.text) {
    return [{ kind: "note", tool: "", label: "", actionTitle: "", detail: "", ok: true, text: event.text, seconds: 0, input: "", output: "" }];
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
  /* The names a learner reads, not the tool ids. "flow-memory-patch" tells them
     nothing; "Updated memory" tells them what just happened to their project.
     Which part of the memory it was is `toolSubject`'s job, from the call's own
     arguments. */
  "flow-memory-fetch": "Recalled what it knows",
  "flow-memory-patch": "Updated memory",
  "plan-learning-path": "Planned what to teach next",
  "web-search": "Searched the web",
  "web-fetch": "Read a page",
  ask_user_question: "Asked you a question",
};

/**
 * The concept tree as indented lines, deepest-first traversal from the roots.
 *
 * A concept whose parent is missing — recorded before the parent it names, or
 * left behind when one was deleted — is shown at the top rather than dropped,
 * and a cycle is broken by refusing to visit a concept twice. Both matter
 * because this text is the only picture the agent has of where things sit: a
 * concept it cannot see is one it will record a second time.
 */
function conceptOutline(concepts: Array<{ conceptId: string; parentId: string | null; title: string; masteryLevel: number }>): string[] {
  const byParent = new Map<string | null, Array<{ conceptId: string; parentId: string | null; title: string; masteryLevel: number }>>();
  const ids = new Set(concepts.map((concept) => concept.conceptId));
  for (const concept of concepts) {
    /* An unresolvable parent is treated as no parent. */
    const key = concept.parentId && ids.has(concept.parentId) ? concept.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), concept]);
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const concept of (byParent.get(parent) ?? []).sort((a, b) => a.title.localeCompare(b.title))) {
      if (seen.has(concept.conceptId)) continue;
      seen.add(concept.conceptId);
      lines.push(`${"  ".repeat(depth + 1)}- ${concept.title} (${concept.conceptId}, L${concept.masteryLevel})`);
      walk(concept.conceptId, depth + 1);
    }
  };
  walk(null, 0);
  /* Anything a cycle kept from being reached still has to be listed. */
  for (const concept of concepts) {
    if (!seen.has(concept.conceptId)) lines.push(`  - ${concept.title} (${concept.conceptId}, L${concept.masteryLevel})`);
  }
  return lines;
}

/** What the namer is asked. Kept short and absolute: a model given room to
 *  explain will return "Sure! Here's a name:" and the answer has to be a name. */
/* ---- The intake ---------------------------------------------------------
   Two completions, both short, both written to fail gracefully. See
   `learnerQuestion` and `learnerPortrait` above for why each exists.
*/

/** What the model is told about the learner. One block of plain lines rather
 *  than JSON: these are answers a person gave, and a model reads them better as
 *  prose than as a payload. */
function describeDraft(draft: LearnerDraft): string {
  const lines = [
    draft.name.trim() ? `Name: ${draft.name.trim()}` : "Name: not given",
    `Footing: ${FOOTING_SHORT[draft.footing]}`,
    `Home language: ${draft.language}`,
    `Wants to be able to: ${draft.ambition.trim() || "not said"}`,
    `Explanations land when you: ${draft.leanings.length > 0 ? draft.leanings.join(", ") : "not said"}`,
    `Pace: ${draft.pace === "deep" ? "slow and thorough" : "keep moving"}`,
  ];
  if (draft.followUp) lines.push(`You asked: ${draft.followUp.question}`, `They answered: ${draft.followUp.answer.trim() || "nothing"}`);
  return lines.join("\n");
}

const FOOTING_SHORT: Record<LearnerDraft["footing"], string> = {
  new: "new to programming",
  some: "has written some code, not professionally",
  working: "writes code professionally",
  returning: "coming back to code after a gap",
};

const QUESTION_PROMPT = [
  "You are Construct, a coding mentor, meeting someone for the first time.",
  "You have their intake answers. Ask them ONE more question — the single thing you would most want to know before teaching this particular person, that their answers did not already tell you.",
  "It must be specific to them. A question you could have asked anyone is a wasted question.",
  "Good: it names something concrete from what they said and asks what is underneath it.",
  "Bad: \"what are your goals?\", \"how much time do you have?\", anything already answered above.",
  "One sentence. Second person. Warm, not clinical. No preamble, no explanation, no quotes — reply with the question alone.",
].join("\n");

const PORTRAIT_PROMPT = [
  "You are Construct, a coding mentor. Someone has just finished telling you about themselves.",
  "Write back what you understood, in the second person, as a short paragraph they will read on the last screen of setting up.",
  "Three or four sentences. Say what you will do differently because of what they told you — that is what makes this worth reading.",
  "Use their own words where they said something specific. Do not flatter them, do not congratulate them on their goals, and do not promise outcomes.",
  "Do not open with \"You are\" twice, do not use bullet points, do not use headings, do not add a sign-off.",
  "Reply with the paragraph alone.",
].join("\n");

/** A question, or nothing. Same defence as `cleanName`: an answer that is not
 *  one question gets thrown away rather than shown. */
function cleanQuestion(raw: string): string | null {
  const first = raw.trim().split(/\n\s*\n/)[0] ?? "";
  const trimmed = first.replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/^(?:question)\s*[:\-]\s*/i, "").trim();
  if (trimmed.length < 12 || trimmed.length > 240) return null;
  /* A model that answered with its reasoning as well. One question, not an
     interview. */
  if (trimmed.split("?").length > 3) return null;
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

const OPENING_PROMPT = [
  "You are Construct, a coding mentor. Someone has just told you about themselves, and you are suggesting a project you would build with them.",
  "Propose exactly ONE project.",
  "It must be a real project with a real subject — the thing itself, named. Not a category, not an exercise, not \"a small app\": say what is being built and what it is built with.",
  "Name the actual stack: the language, and the framework, library, runtime or platform it is built on. Choose one this person can plausibly reach from where they are and from what they said they know, not the most impressive one.",
  "Where they named tools, ecosystems or domains they already work in, build on those rather than around them.",
  "It has to be finishable by them, from where they actually are, in a few sittings. A project they cannot finish teaches them nothing.",
  "Aim it at what they said they want to be able to build. If they were vague, take one honest reading of it rather than a safe default.",
  "If projects are already on their screen, yours must be different in kind from every one of them — a different thing to build, exercising a different part of the craft. Not another size of the same idea.",
  "Reply with JSON and nothing else: one object with these keys.",
  '  "name": the project title, two to four words, Title Case. Name the subject, not the activity.',
  '  "goal": what they will be able to do once it is done, in the second person, one or two sentences. Name the stack here, and make it specific enough to be finishable.',
  '  "why": why this one for this person, one sentence, second person. Point at something they actually said.',
  '  "artifact": the thing that exists at the end, two to four words, lower case, starting with an article. A noun, not an activity.',
  '  "language": one of: ' + LANGUAGES.join(", ") + ". Use their home language unless the project genuinely demands another.",
  "No markdown fence, no commentary, no trailing text. The object alone.",
].join("\n");

/** The draft, plus the cards already on the screen.
 *
 *  Names and goals both, because a name alone does not tell a model that the
 *  card it is about to write is the same project under a different title. */
function describeOffered(draft: LearnerDraft, taken: LearnerOpening[]): string {
  const drafted = describeDraft(draft);
  if (taken.length === 0) return drafted;
  const already = taken.map((entry, position) => `${position + 1}. ${entry.name} — ${entry.goal}`);
  return [drafted, "", "Already on their screen, so yours must be different in kind:", ...already].join("\n");
}

/** A paragraph, or nothing. Headings and bullets mean the model wrote a
 *  document instead of a paragraph, and the screen has room for a paragraph. */
function cleanPortrait(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (trimmed.length < 40 || trimmed.length > 1200) return null;
  if (/^\s*[#\-*]/m.test(trimmed)) return null;
  return trimmed;
}

const NAME_PROMPT = [
  "You name learning projects.",
  "Given what someone wants to build or understand, reply with a short title for it — two to four words, in Title Case.",
  "Name the subject, not the activity: prefer \"Triangle Rasterisation\" over \"Learning How Triangles Work\".",
  "Reply with the name alone. No quotes, no punctuation at the end, no explanation.",
].join("\n");

/**
 * The model's answer, made safe to use as a name.
 *
 * Everything here is defence against an answer that is not a name: a wrapped
 * quote, a trailing full stop, a preamble, a paragraph. Anything left that is
 * too long or too short is rejected outright, which sends the caller to its
 * fallback rather than putting a sentence on a project card.
 */
function cleanName(raw: string): string | null {
  const first = raw.trim().split("\n")[0] ?? "";
  const trimmed = first
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    /* A model that ignores "no explanation" usually answers "Name: X". */
    .replace(/^(?:name|title)\s*[:\-]\s*/i, "")
    .trim();
  if (trimmed.length < 2 || trimmed.length > 48) return null;
  /* A sentence, not a name. */
  if (trimmed.split(/\s+/).length > 6) return null;
  return trimmed;
}
