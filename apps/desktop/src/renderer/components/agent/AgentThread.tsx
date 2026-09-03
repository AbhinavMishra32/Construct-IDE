import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, PencilLine } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentActivityStep, AgentMessage } from "@construct/domain";
import type { TaskSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ChallengePublished, PROSE_GAP, Reasoning, ROW_GLYPH, RunFailure, SolveRead, STEP_GAP, ToolRow } from "./ActivityRow";
import { SystemEvent } from "./SystemEvent";
import { ConceptCard, conceptChangeFromToolOutput, conceptFromToolInput } from "./ConceptCard";
import { TaskChip } from "./TaskChip";
import { taskFromToolInput } from "./taskInput";
import { groupParts, type AgentRun, type RunPart } from "./agentRun";

/** Construct stores the same shape Spar streamed, so the thread needs no
 *  adapter — only the name of the type it reads. */
type Message = AgentMessage;

const PHASE_LABEL: Record<string, string> = {
  research: "Reading up on this project",
  opening: "Planning your path",
};

/** What that work actually is, for the wait before it has anything to show.
 *  Only shown while there is nothing else on screen: once tool rows are
 *  arriving they say it better than a sentence can. */
const PHASE_DETAIL: Record<string, string> = {
  research: "Construct is reading the docs and the code for this before it teaches anything. It takes a minute, and what it finds is saved to .construct/research.md.",
  opening: "Construct is laying out the steps between here and what you said you wanted to build. They will appear in the Path panel.",
};

/** The line that names a turn Construct started for itself.
 *
 *  A learner who has just made a project did not ask for this turn, so the
 *  first thing they see has to say what it is — otherwise a minute of tool rows
 *  is a minute of unexplained activity. It shimmers while the turn is live and
 *  settles to plain when it is not: a static label over a minute of tool calls
 *  is the thing that made a running turn look stalled. */
function PhaseLine({ live, phase }: { live: boolean; phase?: string | null }) {
  const label = phase ? PHASE_LABEL[phase] : undefined;
  if (!label) return null;
  return (
    /* In the rows' own gutter, not hard against the column edge. The dot takes
       the slot a tool's mark would take and the label starts where a tool's
       label starts, so the line that names the turn belongs to the list of work
       under it rather than floating to the left of everything. */
    <p className="mb-1.5 flex items-center gap-2.5 px-1.5 text-ui-sm font-medium tracking-wide uppercase">
      <span aria-hidden className={ROW_GLYPH}>
        <span className="size-1.5 rounded-full bg-[var(--brand)]" />
      </span>
      <span className={cn("min-w-0", live ? "thinking-shimmer" : "text-[var(--transcript-step-strong)]")}>{label}</span>
    </p>
  );
}

/**
 * A turn that is running and has not said anything yet.
 *
 * The gap this fills is the whole of "my new project did nothing": between
 * pressing Create and the first tool row there is a model call, and on a slow
 * provider that is most of a minute. Before this, that minute was an empty
 * thread, which is indistinguishable from a project where the kickoff never
 * ran. It is also what the window falls back to when it mounts into a turn
 * already in flight and has no stream to draw.
 */
function PhaseWait({ phase }: { phase?: string | null }) {
  if (!phase || !PHASE_LABEL[phase]) return null;
  return (
    <div className="min-w-0">
      <PhaseLine live phase={phase} />
      <p className="px-1.5 text-ui leading-[1.6] text-muted-foreground">{PHASE_DETAIL[phase]}</p>
    </div>
  );
}

function LiveRun({ run, phase, ...hooks }: { run: AgentRun; phase?: string | null } & TaskHooks) {
  return (
    <div className="min-w-0">
      <PhaseLine live={run.status === "streaming"} phase={phase} />
      <Rows parts={run.parts} {...hooks} />
      {run.status === "streaming" && <div style={{ marginTop: STEP_GAP }}><WaitingLine parts={run.parts} /></div>}
    </div>
  );
}

/**
 * Every row of a turn, live or read back from storage, in the order it happened.
 *
 * Spacing is per-row rather than one gap between all of them. A uniform
 * `space-y` set every step the same distance from its neighbour, which spread a
 * run of calls down the page as far apart as the sentences around them — and the
 * reference this is matched against does the opposite: consecutive calls sit
 * tight as one cluster, and the prose is what gets the room. That contrast is
 * what makes a turn scannable, because the shape of the page tells you where the
 * agent was working and where it was talking to you before you read a word.
 */
/** What the rows need beyond their own parts. Bundled because three components
 *  sit between the panel that owns these and the chip that uses them, and none
 *  of them do anything with them but forward. */
type TaskHooks = {
  onOpenConcept?: ((conceptId: string) => void) | undefined;
  /** Opens the task in the workspace bar's panel. The conversation only ever
   *  references a task — see `TaskChip`. */
  onShowTask?: ((taskId: string) => void) | undefined;
  /** Every task in the project, so a chip drawn from a tool call shows the
   *  status the store holds rather than the one it was set with. */
  tasks?: TaskSummary[] | undefined;
};

/**
 * Whether this row is drawn with the icon gutter the thread runs down.
 *
 * A tool call is not automatically a tool row: `record-concept` becomes a
 * mastery card and `set-practice-task` becomes a task chip, both of them
 * full-width blocks with no mark in the gutter. Joining one to the row above it
 * would draw a line into the side of a card.
 */
function hasGutter(row: ReturnType<typeof groupParts>[number] | undefined, tasks: TaskSummary[] | undefined): boolean {
  if (row?.kind !== "tool-row") return false;
  if (row.part.tool === "record-concept") return !conceptFromToolInput(row.part.input);
  if (row.part.tool === "set-practice-task") {
    const written = taskFromToolInput(row.part.input);
    return !(written && (tasks?.find((entry) => entry.taskId === written.taskId) ?? written));
  }
  return true;
}

function Rows({ parts, onOpenConcept, onShowTask, tasks }: { parts: RunPart[] } & TaskHooks) {
  const rows = groupParts(parts);
  return (
    <>
      {rows.map((part, index) => {
        const previous = rows[index - 1];
        /* Steps in the same run of work. Kept tight, and joined by a rule through
           the icon gutter so the cluster reads as one sequence.

           Both rows have to be drawn as rows for that to be true. A concept
           reading and a task are tool calls in the data and cards on screen,
           with no icon column for a rule to run down, so a cluster containing
           one is not a thread — see `hasGutter`. */
        const linked = hasGutter(part, tasks) && hasGutter(previous, tasks);
        /* And whether the run continues past this row. A step needs to know both:
           the line above its mark is only drawn when something came before, and
           the line below it only when something follows. */
        const continues = hasGutter(part, tasks) && hasGutter(rows[index + 1], tasks);
        /* No margin between two steps of the same run: that gap is padding
           inside the upper row, so the thread can run through it. Everything
           else is spaced from the outside as before. */
        const gap = index === 0 || linked ? undefined : part.kind === "text" ? PROSE_GAP : STEP_GAP;
        const wrap = (node: React.ReactNode) => (
          <div key={part.id} className="min-w-0" {...(gap ? { style: { marginTop: gap } } : {})}>
            {node}
          </div>
        );

        if (part.kind === "text") return wrap(<div className="px-1.5 text-foreground"><Markdown source={part.body} /></div>);
        if (part.kind === "reasoning") return wrap(<Reasoning part={part} />);
        if (part.kind === "tool-row") {
          /* A mastery reading is the outcome of the turn rather than a step
             toward it, so it gets a card rather than a tool row — the same
             treatment a published challenge gets, and for the same reason. */
          if (part.part.tool === "record-concept") {
            const concept = conceptFromToolInput(part.part.input);
            /* What the call *did*, which only the store knew: the level it came
               from, and the parts of the note it rewrote. Absent for a turn
               recorded before the tool answered with it, and the card then
               shows the level alone as it always did. */
            const change = conceptChangeFromToolOutput(part.part.output);
            if (concept)
              return wrap(
                <ConceptCard
                  changed={change?.changed}
                  level={concept.level}
                  note={concept.note}
                  onOpen={onOpenConcept ? () => onOpenConcept(concept.conceptId) : undefined}
                  previousLevel={change?.previousLevel}
                  reason={change?.reason}
                  title={concept.title}
                />,
              );
          }
          /* A task set is the outcome of the turn in the same way a mastery
             reading is: the row would say "Set a practice task" and hide the
             task itself, which is the only part anybody needs. Drawn from the
             stored task when there is one so the card shows its real status,
             and from the call's own input until that arrives. */
          if (part.part.tool === "set-practice-task") {
            const written = taskFromToolInput(part.part.input);
            const task = written ? (tasks?.find((entry) => entry.taskId === written.taskId) ?? written) : null;
            if (task) return wrap(<TaskChip onOpen={onShowTask} task={task} />);
          }
          return wrap(<ToolRow continues={continues} linked={linked} part={part.part} />);
        }
        if (part.kind === "challenge") return wrap(<ChallengePublished part={part.part} />);
        if (part.kind === "solve-read") return wrap(<SolveRead part={part.part} />);
        if (part.kind === "error") return wrap(<RunFailure body={part.body} />);
        return wrap(<div className="truncate px-1.5 text-ui-sm text-[var(--transcript-step)]">{part.body}</div>);
      })}
    </>
  );
}

/**
 * The gap before the provider has sent anything at all.
 *
 * This used to be a permanent "Thinking" row that covered every quiet moment of a
 * turn, which is what made the transcript look like one opaque label with a tool
 * list above it — the reasoning and the replies were arriving and the row simply
 * sat on top of them. Now anything the model is actually doing has its own part
 * in the transcript, and this only fills the wait before the first token.
 */
function WaitingLine({ parts }: { parts: RunPart[] }) {
  const live = parts.some((part) =>
    (part.kind === "tool" && part.phase === "running") || (part.kind === "reasoning" && part.open),
  );
  if (live || parts.length > 0) return null;
  return (
    <div className="flex items-center gap-2.5 px-1.5 py-0.5">
      <span className={cn(ROW_GLYPH, "relative")}>
        <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
        <ThinkingOrb aria-label="Working" size={20} state="working" style={{ width: 16, height: 16 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate text-ui font-medium">Connecting to the model</span>
    </div>
  );
}

/**
 * A finished turn: what it did, then what it said.
 *
 * The steps are drawn from the same components the live stream uses, so a turn
 * looks the same after it lands as it did while it ran — which is the whole point
 * of storing them. A turn with no reply is still a turn worth seeing; that is
 * what an attempt-complete turn is, and it used to leave nothing behind at all.
 */
function AgentMessage({ body, activity, ...hooks }: { body: string; activity: AgentActivityStep[] } & TaskHooks) {
  return (
    /* No `space-y` here. It reaches every row `Rows` emits — they are direct
       children of this element, not of the fragment — and put a margin between
       two steps that `Rows` had deliberately left touching, which is space the
       thread down the icon column cannot be drawn in. That is what turned the
       line into a column of dashes on every settled turn while a live one
       looked right. Spacing between steps belongs to `Rows`; the only gap this
       element owns is the one before the reply. */
    <div className="min-w-0">
      <Rows parts={activity.map(storedPart)} {...hooks} />
      {body.trim() && (
        <div className="min-w-0 px-1.5" style={{ marginTop: PROSE_GAP }}>
          <Markdown source={body} />
        </div>
      )}
    </div>
  );
}

/** A stored step as the transcript's own part shape, so the rows a finished turn
 *  draws are the same rows it drew while it was running. */
function storedPart(step: AgentActivityStep, index: number): RunPart {
  // A note is what the agent said between its calls, so it reads as what it was.
  if (step.kind === "note") return { kind: "text", id: `stored-${index}-note`, body: step.text };
  if (step.kind === "reasoning") {
    return {
      kind: "reasoning",
      id: `stored-${index}-thinking`,
      body: step.text,
      open: false,
      startedAt: 0,
      endedAt: step.seconds * 1_000,
    };
  }
  return {
    kind: "tool",
    id: `stored-${index}-${step.tool}`,
    tool: step.tool,
    label: step.label,
    actionTitle: step.actionTitle,
    detail: step.detail,
    phase: step.ok ? "done" : "error",
    files: [],
    input: step.input,
    output: step.output,
    startedAt: 0,
  };
}

/**
 * Something the learner said, and the chance to say it differently.
 *
 * Editing is a rewind, not a correction of the text: everything after this
 * message is undone — the files the agent wrote, the concepts and tasks it
 * recorded, the replies — and the conversation runs again from here. That is
 * why the control is offered only where an undo point was actually recorded,
 * and why the confirmation says what will happen rather than "are you sure".
 */
function LearnerMessage({ body, editable, onEdit }: { body: string; editable: boolean; onEdit?: ((body: string) => void) | undefined }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);

  if (editing) {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="w-[85%] min-w-0 rounded-[var(--radius-xl)] bg-[var(--app-user-message-background)] p-2">
          <textarea
            autoFocus
            className="app-scroll block max-h-40 w-full resize-none bg-transparent px-1 py-0.5 text-content leading-[1.55] outline-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter" && !event.shiftKey && draft.trim()) {
                event.preventDefault();
                setEditing(false);
                onEdit?.(draft.trim());
              }
            }}
            rows={Math.min(6, draft.split("\n").length)}
            value={draft}
          />
          <div className="mt-1 flex items-center justify-end gap-1.5 px-1">
            <span className="mr-auto min-w-0 truncate text-ui-sm text-muted-foreground/85">Everything after this is undone</span>
            <button
              className="rounded-md px-2 py-0.5 text-ui text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setDraft(body);
                setEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="click-depth-effect-slightly rounded-md bg-[var(--foreground)] px-2 py-0.5 text-ui font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false);
                onEdit?.(draft.trim());
              }}
              type="button"
            >
              Send again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/said flex min-w-0 items-center justify-end gap-1">
      {/* On hover only, and outside the bubble: a permanent pencil beside every
          thing the learner ever said is a column of controls down a
          conversation. */}
      {editable && onEdit && (
        <button
          aria-label="Edit and run again from here"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/0 transition-colors group-hover/said:text-muted-foreground hover:!text-foreground"
          onClick={() => {
            setDraft(body);
            setEditing(true);
          }}
          title="Edit and run again from here"
          type="button"
        >
          <PencilLine className="size-3.5" />
        </button>
      )}
      <div className="max-w-[85%] min-w-0 break-words rounded-[var(--radius-xl)] bg-[var(--app-user-message-background)] px-3 py-2 text-content leading-[1.55] whitespace-pre-wrap">
        {body}
      </div>
    </div>
  );
}

export function AgentThread({
  messages,
  run,
  phase,
  header,
  empty,
  footer,
  onOpenConcept,
  onShowTask,
  tasks,
  onEditMessage,
  undoable,
  className,
}: {
  messages: Message[];
  run: AgentRun | null;
  /** What the live turn is, when Construct started it rather than the learner. */
  phase?: "research" | "opening" | "reply" | null;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  /** Rendered after the last message, inside the scroller. Used for a failed
   *  turn, which belongs in the transcript beside the message it failed to
   *  answer rather than in a notification that fades. */
  footer?: React.ReactNode;
  /** Opens a concept the transcript mentions. Passed down rather than handled
   *  here because the panel owns which concept is being read. */
  onOpenConcept?: (conceptId: string) => void;
  onShowTask?: ((taskId: string) => void) | undefined;
  tasks?: TaskSummary[] | undefined;
  /** Rewrites one of the learner's messages and runs again from there. */
  onEditMessage?: ((messageId: string, body: string) => void) | undefined;
  /** Message ids with an undo point behind them. Editing is offered only for
   *  these — anything else would promise a rewind that cannot happen. */
  undoable?: ReadonlySet<string> | undefined;
  className?: string;
}) {
  const hooks: TaskHooks = { onOpenConcept, onShowTask, tasks };
  const viewport = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  /* Completion persists the final streamed text before the refreshed session
     reaches the renderer. Reconcile by content during that narrow hand-off so the
     durable message and its live precursor can never render twice. Dropping the
     live run no longer loses the turn's work: the steps are stored on the message
     and drawn from there, which is what a finished turn is made of. */
  const streamedText=run?.parts.filter((part)=>part.kind==="text").map((part)=>part.body).join("").trim()??"";
  const lastAgentMessage=[...messages].reverse().find((item)=>item.role==="agent");
  const visibleRun=run&&streamedText&&lastAgentMessage?.body.trim()===streamedText?null:run;

  // Auto-follow only while the learner is already at the live edge, so scrolling
  // back to re-read an earlier explanation is not yanked away mid-stream.
  useLayoutEffect(() => {
    if (!pinned) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, run, pinned]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setPinned(distance < 48);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  /* A turn with nothing to show yet is not an empty thread. `PhaseWait` is what
     stands in its place, and showing the project's empty state over a running
     kickoff is how a project that was working came to look like one that had
     never started. */
  const isEmpty = messages.length === 0 && !visibleRun && !phase;

  return (
    <div className={cn("agent-transcript relative min-h-0 min-w-0 flex-1", className)}>
      {/* overflow-x-hidden: the column never scrolls sideways. Anything genuinely
          wide (a code block) scrolls inside its own box instead. */}
      <div ref={viewport} className="app-scroll h-full overflow-y-auto overflow-x-hidden px-4 pt-3 pb-6">
        <div
          className={cn(
            "transcript-column flex min-h-full min-w-0 flex-col gap-2.5",
            isEmpty ? "justify-center" : "justify-end",
          )}
        >
          {header}
          {isEmpty
            ? empty
            : (
              <>
                {messages.map((item) =>
                  item.role === "learner" ? (
                    <LearnerMessage
                      key={item.id}
                      body={item.body}
                      editable={undoable?.has(item.id) ?? false}
                      {...(onEditMessage ? { onEdit: (body: string) => onEditMessage(item.id, body) } : {})}
                    />
                  ) : item.role === "system" ? (
                    <SystemEvent key={item.id} body={item.body} />
                  ) : (
                    <AgentMessage key={item.id} activity={item.activity} body={item.body} {...hooks} />
                  ),
                )}
                {visibleRun ? <LiveRun phase={phase} run={visibleRun} {...hooks} /> : <PhaseWait phase={phase} />}
                {footer}
              </>
            )}
        </div>
      </div>

      {!pinned && (
        <button
          className="app-no-drag absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--app-shadow-overlay)] transition hover:text-foreground"
          onClick={() => {
            setPinned(true);
            const node = viewport.current;
            if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
          }}
          title="Jump to latest"
          type="button"
        >
          <ArrowDown className="size-3.5" />
        </button>
      )}
    </div>
  );
}
