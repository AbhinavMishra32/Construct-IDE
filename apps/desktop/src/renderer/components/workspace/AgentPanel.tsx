import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AskUserQuestionRequest } from "@construct/domain";
import type { ConstructApi, ProviderInventory, TaskSummary } from "../../../shared/api";
import { AgentThread } from "../agent/AgentThread";
import { MarkdownLinkProvider, type MarkdownLinks } from "../agent/MarkdownLinks";
import { ConstructDots } from "../common/ConstructDots";
import { AskUserQuestion } from "../agent/AskUserQuestion";
import { Composer } from "../agent/Composer";
import { ModelPicker, ReasoningPicker } from "../agent/ModelPicker";
import { reduceRun, type AgentRun } from "../agent/agentRun";
import { mergeMessages } from "./agentMessages";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  onError(message: string): void;
  onOpenSettings(): void;
  onOpenConcept(conceptId: string): void;
  /** Opens a task in the workspace bar's panel. The conversation only ever
   *  references one. */
  onShowTask(taskId: string): void;
  tasks: TaskSummary[];
  /** The project's language, so inline code in the transcript is coloured the
   *  way the editor colours the same snippet. */
  language: string;
  /** Opens a file the agent referred to. Optional: the transcript is rendered
   *  in places with no editor behind it. */
  onOpenFile?: ((path: string) => void) | undefined;
};

/**
 * The conversation, using Spar's transcript rather than a second one.
 *
 * `AgentThread` and the rows beneath it were written against the stream shape
 * the worker now emits, so this component only keeps the run reduced and hands
 * it over: tool rows, reasoning blocks, per-row spacing, follow behaviour and
 * jump-to-latest all belong to the thread.
 */
export function AgentPanel({ api, projectId, onError, onOpenFile, onOpenSettings, onOpenConcept, onShowTask, tasks, language }: Props) {
  /* Resolved once per path per visit. The agent names the same file repeatedly
     inside one turn — "create hello.cpp … then compile hello.cpp" — and a
     listing per mention would be a directory read per word. Cleared when the
     project changes, since the answers belong to that project's disk. */
  const fileChecks = useRef(new Map<string, Promise<boolean>>());
  useEffect(() => { fileChecks.current.clear(); }, [projectId]);

  const links = useMemo<MarkdownLinks>(
    () => ({
      language,
      onOpenConcept,
      onOpenFile,
      onCreateFile: (path) => {
        if (!api) return;
        void api
          .createFile({ projectId, path })
          .then(() => {
            /* Forget the "missing" answer, or the link would keep offering to
               create a file that now exists. */
            fileChecks.current.delete(path);
            onOpenFile?.(path);
          })
          .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Construct could not create that file."));
      },
      checkFile: (path) => {
        if (!api) return Promise.resolve(false);
        const cached = fileChecks.current.get(path);
        if (cached) return cached;
        const slash = path.lastIndexOf("/");
        const directory = slash > 0 ? path.slice(0, slash) : "";
        const name = slash > 0 ? path.slice(slash + 1) : path;
        /* A listing of the parent rather than a read of the file: existence is
           the question, and reading is the expensive way to ask it. */
        const answer = api
          .listFiles({ projectId, ...(directory ? { directory } : {}) })
          .then((entries) => entries.some((entry) => entry.name === name))
          .catch(() => false);
        fileChecks.current.set(path, answer);
        return answer;
      },
    }),
    [api, onError, onOpenConcept, onOpenFile, projectId],
  );
  const [providers, setProviders] = useState<ProviderInventory | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  /* What Construct is doing, when it started the turn itself. Research and the
     opening turn arrive unprompted — a project that has just been created is
     already working — and the thread has to be able to say so. */
  const [phase, setPhase] = useState<"research" | "opening" | "reply" | null>(null);
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null);
  const [answering, setAnswering] = useState(false);
  /* The last turn's failure, kept in the thread rather than only in a toast.
     A message with no reply and a notification that has already faded is
     indistinguishable from the agent ignoring you. */
  const [failure, setFailure] = useState<string | null>(null);
  /* Every task in this project. Held here rather than in the thread because the
     pinned strip above the composer and the cards inside the transcript are two
     views of the same list, and two fetches would let them disagree. */

  useEffect(() => {
    let current = true;
    setMessages([]);
    setRun(null);
    setRunning(false);
    setPhase(null);
    setQuestion(null);
    setAnswering(false);
    setFailure(null);
    if (!api) return () => { current = false; };

    /* Loading the durable transcript races the live subscription below. A
       message can land while SQLite is being read; replacing state with that
       older snapshot made the just-arrived row disappear. Merge by identity so
       the snapshot fills history without ever rolling live state backwards. */
    void api
      .agentMessages({ projectId })
      .then((stored) => {
        if (current) setMessages((live) => mergeMessages(stored, live));
      })
      .catch(() => undefined);

    /* And whether one is running right now.
       
       `started` is an event, and an event only reaches whoever was listening.
       This panel mounts after a project is created, when the kickoff is already
       under way; it mounts again whenever the chat pane is toggled or the
       window reloads. Every one of those cases used to draw an empty thread
       over a turn that was minutes into its work, which is exactly what a
       project that never started looks like. */
    void api
      .agentStatus({ projectId })
      .then((status) => {
        if (!current) return;
        /* The question first, and regardless of `running`: a turn blocked on the
           learner is exactly the state the panel most needs to come back to. */
        if (status.question) setQuestion(status.question);
        if (!status.running) return;
        setRunning(true);
        setPhase(status.phase);
      })
      .catch(() => undefined);
    return () => { current = false; };
  }, [api, projectId]);

  /* Which model is answering, read once and after a turn. The composer shows it
     because it is the single most useful thing to know before sending — and the
     picker is how it changes, so it belongs beside the box rather than buried in
     Settings. */

  /* Which messages can be rewound to. Re-read whenever the thread changes,
     because a snapshot is written per turn and the newest message only becomes
     editable once its turn has started. */
  const [undoable, setUndoable] = useState<ReadonlySet<string>>(new Set());
  const loadUndoable = useCallback(() => {
    void api
      ?.undoableMessages({ projectId })
      .then((ids) => setUndoable(new Set(ids)))
      .catch(() => setUndoable(new Set()));
  }, [api, projectId]);

  useEffect(loadUndoable, [loadUndoable, messages.length]);

    const loadProviders = useCallback(() => {
    void api?.listProviders().then(setProviders).catch(() => setProviders(null));
  }, [api]);

  useEffect(loadProviders, [loadProviders]);

  /* The live transcript, reduced here rather than inside the thread so the run
     survives the thread remounting — resizing the panel should not clear the
     turn in flight. */
  useEffect(() => {
    return api?.onAgentStream((event) => {
      if (event.projectId && event.projectId !== projectId) return;
      setRun((current) => reduceRun(current, event));
    });
  }, [api, projectId]);

  useEffect(() => {
    return api?.onAgentEvent((event) => {
      if (event.projectId !== projectId) return;
      switch (event.kind) {
        case "started":
          /* Whoever started it. This is the fix for a project opening to a blank
             thread while the agent read up on it: the panel used to set
             `running` only in its own send handler, so a turn the main process
             began streamed rows that nothing rendered. */
          setRunning(true);
          setPhase(event.phase);
          setFailure(null);
          /* The previous run is deliberately not cleared here.
             
             Starting a project is two turns back to back — read up on it, then
             teach — and blanking the panel between them wiped everything the
             learner was watching, seconds before the next turn produced its
             first token. `reduceRun` already replaces the parts when the run id
             changes, so the finished turn stays on screen until the new one has
             something to put in its place. */
          break;
        case "message":
          setMessages((current) => mergeMessages(current, [event.message]));
          /* A settled agent message is the durable form of the live run. Drop
             the precursor at the same boundary instead of rendering both until
             the later `done` event happens to arrive. */
          if (event.message.role === "agent") setRun(null);
          break;
        case "rewound":
          /* History was rewound to an earlier message. Re-read rather than
             reconcile: the window's copy of the thread is exactly what is no
             longer true. The question goes with it — the tool waiting on it was
             dropped, so the card would offer an answer nobody is listening for,
             and it replaces the composer, so the learner could not type either. */
          setQuestion(null);
          setAnswering(false);
          setFailure(null);
          void api?.agentMessages({ projectId }).then(setMessages).catch(() => undefined);
          loadUndoable();
          break;
        case "question":
          setQuestion(event.request);
          setAnswering(false);
          break;
        case "error":
          setFailure(event.message);
          onError(event.message);
          break;
        case "done":
          setRunning(false);
          setPhase(null);
          setQuestion(null);
          setAnswering(false);
          break;
      }
    });
  }, [api, loadUndoable, projectId, onError]);

  /**
   * Stops the turn in flight.
   *
   * `running` is cleared here rather than waiting for the `done` event, because
   * the abort has to travel to the worker and back through Mastra's loop — up
   * to a second on a slow step — and a stop button that stays lit after being
   * pressed reads as one that did not work.
   */
  /* Whether the model in use reasons at all. The effort control is shown only
     then — see below. */
  const activeProvider = providers?.providers.find((provider) => provider.id === providers.defaultModel.provider);
  const reasons = Boolean(activeProvider?.models.find((model) => model.id === providers?.defaultModel.model)?.reasoning);


  /**
   * Rewrites an earlier message and runs from there.
   *
   * The thread is cleared to what came before it straight away rather than
   * waiting for the round trip: the main process is about to delete those
   * messages, and leaving them on screen while it does reads as the edit having
   * done nothing.
   */
  const edit = useCallback(
    (messageId: string, body: string) => {
      if (!api) return;
      const at = messages.findIndex((message) => message.id === messageId);
      if (at >= 0) setMessages(messages.slice(0, at));
      setRun(null);
      setRunning(true);
      void api.editMessage({ projectId, messageId, body }).catch((cause: unknown) => {
        setRunning(false);
        onError(cause instanceof Error ? cause.message : "Construct could not go back to that message.");
        void api.agentMessages({ projectId }).then(setMessages).catch(() => undefined);
      });
    },
    [api, messages, onError, projectId],
  );

  const stop = useCallback(() => {
    if (!api) return;
    setRunning(false);
    setPhase(null);
    void api.stopAgent({ projectId }).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : "Construct could not stop that turn.");
    });
  }, [api, onError, projectId]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !api) return;

    /* Typing while the agent is working is a correction, not a queue.
       
       The composer used to refuse it outright, so the only way to redirect a
       turn going the wrong way was to watch it finish. Mastra's loop takes its
       messages once and cannot be added to mid-run, so this stops the turn,
       keeps what it already said, and sends the correction as the next thing it
       answers — which is what makes the reply read as a response to it. */
    if (running) {
      setDraft("");
      void api.steerAgent({ projectId, body }).catch((cause: unknown) => {
        setRunning(false);
        onError(cause instanceof Error ? cause.message : "Construct could not redirect that turn.");
      });
      return;
    }

    setDraft("");
    setRunning(true);
    setRun(null);
    setFailure(null);
    void api.sendToAgent({ projectId, body }).catch((cause: unknown) => {
      setRunning(false);
      onError(cause instanceof Error ? cause.message : "The agent could not be reached.");
    });
  }, [api, draft, projectId, running, onError]);

  return (
    <MarkdownLinkProvider value={links}>
    <div className="flex h-full min-h-0 flex-col">
      <AgentThread
        messages={messages}
        onOpenConcept={onOpenConcept}
        onEditMessage={edit}
        onShowTask={onShowTask}
        phase={phase}
        undoable={undoable}
        run={running ? run : null}
        tasks={tasks}
        footer={
          failure ? (
            <div className="mx-1.5 mt-3 rounded-[var(--radius-lg)] border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-ui-sm font-medium text-destructive">That turn did not finish</p>
              <p className="mt-0.5 text-ui-sm leading-[1.5] text-foreground/80">{failure}</p>
            </div>
          ) : undefined
        }
        empty={
          /* The mark, then the sentence — and the mark carries most of it.
             
             An empty thread was a paragraph floating in the middle of a tall
             dark column, which reads as a page that failed to load rather than
             as one waiting for you. The logo at rest gives the space something
             to be about, and it is the same field the icon draws, so the panel
             looks like part of the app rather than like a blank. */
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <ConstructDots className="text-foreground/70" pattern="still" size={44} />
            <p className="max-w-[15rem] text-ui leading-[1.55] text-muted-foreground">
              Ask about this project, or say what you want to build next.
            </p>
          </div>
        }
      />


      <div className="px-2 pb-2">
        {question ? (
          /* The composer is replaced rather than sitting disabled beside the
             card: the turn is blocked on this answer, and a second place to type
             only invites answering in the wrong one. */
          <AskUserQuestion
            request={question}
            busy={answering}
            onSubmit={(answer) => {
              if (!api || answering) return;
              setAnswering(true);
              void api
                .answerAgent({ projectId, answer })
                .then(() => setQuestion(null))
                .catch((cause: unknown) => {
                  const message = cause instanceof Error ? cause.message : "Construct could not submit that answer.";
                  setFailure(message);
                  onError(message);
                })
                .finally(() => setAnswering(false));
            }}
          />
        ) : (
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            onStop={stop}
            busy={running}
            placeholder={running ? "Construct is working…" : "Ask Construct…"}
            leading={
              <>
                <ModelPicker
                  inventory={providers}
                  onSelect={(provider, model) => {
                    void api
                      ?.setDefaultProvider(provider.id, model)
                      .then(loadProviders)
                      .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Could not switch model."));
                  }}
                  onOpenSettings={onOpenSettings}
                />
                {/* Only for models that actually reason. The setting is real and
                    already reaches the worker on every turn; offering it beside
                    a model that ignores it would be a control that does
                    nothing. */}
                {reasons && providers && (
                  <ReasoningPicker
                    effort={providers.defaultModel.reasoningEffort}
                    onSelect={(effort) => {
                      void api
                        ?.setReasoningEffort(effort)
                        .then(loadProviders)
                        .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Could not change reasoning effort."));
                    }}
                  />
                )}
              </>
            }
          />
        )}
      </div>
    </div>
    </MarkdownLinkProvider>
  );
}
