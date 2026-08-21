import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import type { AgentActivityStep, AgentMessage } from "@construct/domain";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ChallengePublished, LINKED_GAP, PROSE_GAP, Reasoning, RunFailure, SolveRead, STEP_GAP, ToolRow } from "./ActivityRow";
import { SystemEvent } from "./SystemEvent";
import { ConceptCard, conceptFromToolInput } from "./ConceptCard";
import { groupParts, type AgentRun, type RunPart } from "./agentRun";

/** Construct stores the same shape Spar streamed, so the thread needs no
 *  adapter — only the name of the type it reads. */
type Message = AgentMessage;

const PHASE_LABEL: Record<string, string> = {
  research: "Reading up on this project",
  opening: "Getting started",
};

function LiveRun({ run, phase }: { run: AgentRun; phase?: string | null }) {
  const label = phase ? PHASE_LABEL[phase] : undefined;
  return (
    <div className="min-w-0">
      {/* Named when Construct started the turn itself. A learner who has just
          made a project did not ask for this, so the first thing they see has to
          say what it is — otherwise a minute of tool rows is a minute of
          unexplained activity. */}
      {label && (
        <p className="mb-1.5 flex items-center gap-1.5 text-ui-sm font-medium tracking-wide text-muted-foreground uppercase">
          <span className="size-1.5 rounded-full bg-[var(--brand)]" />
          {label}
        </p>
      )}
      <Rows parts={run.parts} />
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
function Rows({ parts, onOpenConcept }: { parts: RunPart[]; onOpenConcept?: (conceptId: string) => void }) {
  const rows = groupParts(parts);
  return (
    <>
      {rows.map((part, index) => {
        const previous = rows[index - 1];
        /* Steps in the same run of work. Kept tight, and joined by a rule through
           the icon gutter so the cluster reads as one sequence. */
        const linked = part.kind === "tool-row" && previous?.kind === "tool-row";
        const gap = index === 0 ? undefined : linked ? LINKED_GAP : part.kind === "text" ? PROSE_GAP : STEP_GAP;
        const wrap = (node: React.ReactNode) => (
          <div key={part.id} className="min-w-0" {...(gap ? { style: { marginTop: gap } } : {})}>{node}</div>
        );

        if (part.kind === "text") return wrap(<div className="px-1.5 text-foreground"><Markdown source={part.body} /></div>);
        if (part.kind === "reasoning") return wrap(<Reasoning part={part} />);
        if (part.kind === "tool-row") {
          /* A mastery reading is the outcome of the turn rather than a step
             toward it, so it gets a card rather than a tool row — the same
             treatment a published challenge gets, and for the same reason. */
          if (part.part.tool === "record-concept") {
            const concept = conceptFromToolInput(part.part.input);
            if (concept) return wrap(<ConceptCard level={concept.level} note={concept.note} onOpen={onOpenConcept ? () => onOpenConcept(concept.conceptId) : undefined} title={concept.title} />);
          }
          return wrap(<ToolRow linked={linked} part={part.part} />);
        }
        if (part.kind === "challenge") return wrap(<ChallengePublished part={part.part} />);
        if (part.kind === "solve-read") return wrap(<SolveRead part={part.part} />);
        if (part.kind === "error") return wrap(<RunFailure body={part.body} />);
        return wrap(<div className="truncate px-1.5 text-ui-sm text-muted-foreground/70">{part.body}</div>);
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
    <div className="flex items-center gap-2 px-1.5 py-0.5">
      <span className="relative grid size-5 place-items-center">
        <span className="absolute inset-0 rounded-full bg-[var(--accent)]/10 blur-sm" />
        <ThinkingOrb aria-label="Working" size={20} state="working" style={{ width: 18, height: 18 }} />
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
function AgentMessage({ body, activity, onOpenConcept }: { body: string; activity: AgentActivityStep[]; onOpenConcept?: (conceptId: string) => void }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Rows onOpenConcept={onOpenConcept} parts={activity.map(storedPart)} />
      {body.trim() && (
        <div className="min-w-0 px-1.5">
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

function LearnerMessage({ body }: { body: string }) {
  return (
    <div className="flex min-w-0 justify-end">
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
  className?: string;
}) {
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

  const isEmpty = messages.length === 0 && !visibleRun;

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
                    <LearnerMessage key={item.id} body={item.body} />
                  ) : item.role === "system" ? (
                    <SystemEvent key={item.id} body={item.body} />
                  ) : (
                    <AgentMessage key={item.id} activity={item.activity} body={item.body} onOpenConcept={onOpenConcept} />
                  ),
                )}
                {visibleRun && <LiveRun phase={phase} run={visibleRun} />}
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
