import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Check, ChevronDown, CircleAlert, FilePenLine, FolderOpen, Globe, GraduationCap, History, Link2, ListChecks, MessageCircleQuestionMark, NotebookPen, NotebookText, Route, Search, SquareTerminal, Wrench } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ToolDetail } from "./ToolDetail";
import { toolSubject } from "./toolSubject";
import { thoughts } from "./thoughts";
import { useMarkdownLinks } from "./MarkdownLinks";
import { FadedScroll, RawPayload } from "./ToolPayload";
import { SourceGlyph } from "../common/SourceGlyph";
import { diffTotals, isSourceTool, toolRowTitle, type RunPart } from "./agentRun";

type ToolPart = Extract<RunPart, { kind: "tool" }>;

/**
 * Which orb a running step spins.
 *
 * Nine states ship, and a transcript that used three of them was throwing away
 * the only thing the orb is for: telling the reader, before any text is read,
 * what kind of work is under way. Going out to the network does not look like
 * reading a file, and recording what someone understands does not look like
 * either. Names are matched both hyphenated and underscored because the
 * transcript carries tools from v0.7 as well as Construct's own.
 */
function orbFor(tool: string): OrbState {
  const name = tool.replace(/-/g, "_");
  /* Out to the internet: the wires, not the globe. */
  if (name.startsWith("web_") || name.startsWith("fetch_") || name.startsWith("sync_")) return "connecting";
  if (name.startsWith("search_") || name.startsWith("read_") || name.startsWith("inspect_") || name.startsWith("list_") || name.startsWith("grep") || name === "replay_attempt") return "searching";
  if (name.startsWith("write_") || name.startsWith("edit_") || name.startsWith("apply_") || name.startsWith("create_file")) return "shaping";
  if (name === "create_question" || name === "replace_current_question" || name.startsWith("plan_") || name.startsWith("path")) return "weaving";
  if (name === "evaluate_attempt" || name.startsWith("run_") || name.startsWith("terminal") || name.startsWith("shell")) return "solving";
  if (name === "ask_user_question") return "listening";
  if (name.startsWith("record_") || name.startsWith("upsert_") || name.startsWith("flow_memory") || name.startsWith("remember")) return "breathing";
  if (name.startsWith("set_") || name.startsWith("propose_") || name.startsWith("commit_") || name.startsWith("update_")) return "composing";
  return "working";
}

/**
 * What a step did, as a mark.
 *
 * Every row used to end here with a tick, and the reason is worth recording:
 * the cases below tested v0.7's underscored tool names — `read_`, `search_` —
 * and Construct's tools are hyphenated, so not one of them ever matched. A
 * transcript of identical green ticks says only "something happened", which is
 * the one thing the reader already knows.
 *
 * Drawn at 1.6 rather than Lucide's 2 for the same reason the title bar's
 * glyphs are: at 14px a 2-unit stroke reads as a blob beside text this size.
 */
const MARK = "size-3.5 [&_*]:[stroke-width:1.6]";

function ToolIcon({ part }: { part: ToolPart }) {
  if (part.phase === "running") return <ThinkingOrb aria-label="Working" size={20} state={orbFor(part.tool)} style={{ width: 15, height: 15 }} />;
  if (part.phase === "error") return <CircleAlert className={cn(MARK, "text-[var(--warning)]")} />;
  /* Anything that reached the practice source is marked with the source's own logo.
     A magnifying glass over "Searching LeetCode for a problem" says the agent
     searched something; the mark says what. */
  if (isSourceTool(part.tool)) return <SourceGlyph className="size-3.5" source={sourceFor(part)} />;

  switch (part.tool) {
    /* Going out to the web gets its own mark. Every other row in the transcript
       is the agent reading the learner's own project, and a globe is the
       one-glance difference between "it read your files" and "it read the internet". */
    case "web-search":
    case "web_search":
      return <Globe className={MARK} />;
    case "web-fetch":
    case "web_fetch":
      return <Link2 className={MARK} />;
    case "read-file":
      return <BookOpen className={MARK} />;
    case "write-file":
      return <FilePenLine className={MARK} />;
    /* Memory is marked as notes, not as files. A page-and-pen next to "Updated
       memory" reads as another write into the learner's source tree; what
       actually changed is Construct's own notebook about them. */
    case "flow-memory-fetch":
      return <NotebookText className={MARK} />;
    case "flow-memory-patch":
      return <NotebookPen className={MARK} />;
    case "list-files":
      return <FolderOpen className={MARK} />;
    case "run-terminal-command":
      return <SquareTerminal className={MARK} />;
    case "record-concept":
      return <GraduationCap className={MARK} />;
    case "plan-learning-path":
      return <Route className={MARK} />;
    case "set-practice-task":
    case "judge-practice-task":
      return <ListChecks className={MARK} />;
    /* A wrench over "Asked a question" said a tool ran. This row is a turn of
       conversation, and it is marked as one. */
    case "ask_user_question":
    case "ask-user-question":
      return <MessageCircleQuestionMark className={MARK} />;
    default:
      break;
  }

  if (part.tool.startsWith("search_") || part.tool.startsWith("search-")) return <Search className={MARK} />;
  if (part.tool.startsWith("read_") || part.tool.startsWith("inspect_")) return <BookOpen className={MARK} />;
  if (part.tool.startsWith("set_") || part.tool.startsWith("propose_") || part.tool.startsWith("commit_")) return <FilePenLine className={MARK} />;
  /* Neutral, and deliberately not a tick: a tool that ran is not a tool that
     succeeded at anything the reader cares about. */
  return <Wrench className={MARK} />;
}

/** What the call did, as one word, in the corner of its panel. */
function StatusPill({ part }: { part: ToolPart }) {
  const rejected = part.phase === "error" && (part.tool === "create_question" || part.tool === "replace_current_question" || part.tool === "create_fallback_question");
  const [text, tone] = part.phase === "running"
    ? ["Running", "text-muted-foreground"]
    : rejected
      ? ["Rejected", "text-[var(--warning)]"]
      : part.phase === "error"
        ? ["Failed", "text-destructive"]
        : ["Success", "text-[var(--success)]"];
  return (
    <span className={cn("shrink-0 rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-ui-sm font-medium", tone)}>{text}</span>
  );
}

/**
 * What the call was, and what it was about.
 *
 * `Read main.py` rather than `Read a file`. A column of bare verbs says the
 * agent did five things and nothing about which, so the only way to find the
 * one that matters was to open all five.
 *
 * A path is underlined and opens the file: the row names something real, and
 * the thing you do after seeing it is look at it. The short name is shown and
 * the full path is the title, because two `index.ts` in one project are only
 * told apart by the directories a row has no width for.
 */
function ToolTitle({ part }: { part: ToolPart }) {
  const { onOpenFile } = useMarkdownLinks();
  const running = part.phase === "running";
  const subject = toolSubject(part.tool, part.input, running);
  if (!subject) return <>{toolRowTitle(part)}</>;

  return (
    <>
      {subject.verb}{" "}
      {subject.path ? (
        <span
          className={cn(
            "cursor-default underline decoration-dotted underline-offset-2",
            /* Darker only under the pointer that is about to open it, and never
               while the row is shimmering: the sweep is a background clipped to
               the text, and a child that sets `color` renders opaque and sits
               dead in the middle of it. */
            !running && "hover:text-foreground",
          )}
          onClick={(event) => {
            /* The row itself is a disclosure; opening the file must not also
               toggle the panel under it. */
            event.stopPropagation();
            onOpenFile?.(subject.path!);
          }}
          title={subject.path}
        >
          {subject.subject}
        </span>
      ) : (
        /* No colour of its own. The subject used to be printed darker than the
           verb in front of it, which made every settled row a two-tone line and
           a column of them a stripe of dark words with grey ones between. The
           whole row is grey, and the whole row goes dark together on hover. */
        <span>{subject.subject}</span>
      )}
    </>
  );
}

/**
 * One step of a turn: its mark, what it did, and what it did it to.
 *
 * The mark sits in a column of its own rather than inside the label, and that
 * column is the thread. The line under a mark is a flex child that fills
 * whatever height is left in the row's block, so a row that opens does not
 * *add* a line beside its panel: the line it already had grows, because the
 * block it is measured against got taller. Two rows in the same run of work
 * meet with no seam because the space between them is padding inside the upper
 * block, which the line runs through, and the lower block opens with the short
 * lead-in above its own mark.
 *
 * This replaced three absolutely positioned segments that were each nudged into
 * place separately. Every one of those joins was arithmetic that had to be kept
 * true by hand, and none of them survived a change to the row's padding.
 */
export function ToolRow({ part, continues = false, linked = false }: { part: ToolPart; continues?: boolean; linked?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasPayload = Boolean(part.input.trim() || part.output.trim());
  const totals = diffTotals(part.files);
  const running = part.phase === "running";
  /* Down the column past this mark: because the panel below is open, or because
     another step in the same run of work follows. */
  const rail = open || continues;

  const label = (
    <>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer")}>
        <ToolTitle part={part} />
        {took(part) && <span className="ml-1.5 tabular-nums text-[var(--transcript-step-mark)]">{took(part)}</span>}
      </span>
      <DiffStat added={totals.added} removed={totals.removed} />
      {/* Only when it did not simply work. A row of green "Success" badges down a
          transcript is noise; the one that says Error is the one worth seeing. */}
      {part.phase === "error" && <StatusPill part={part} />}
      {hasPayload && <Caret open={open} />}
    </>
  );

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      {/* The block. The gap to the next step is held inside it on purpose: a
          margin is space the thread cannot cross. It goes on the words' column
          rather than out here, because padding on this element sits outside the
          content box its children stretch to — which is exactly how the line
          ended up stopping short of the block's own foot, leaving the dash and
          the gap it was supposed to fill. */}
      <div className="flex min-w-0" style={{ paddingLeft: ROW_INSET }}>
        <div className="flex w-4 shrink-0 flex-col items-center">
          {/* Above the mark: the tail of the line coming down from the step
              before, and then the clearance it keeps off this one. */}
          <span aria-hidden className={cn("w-px", linked && RAIL_INK)} style={{ height: RAIL.clear }} />
          <span aria-hidden className="w-px" style={{ height: RAIL.clear }} />
          <span className={cn(ROW_GLYPH, "text-[var(--transcript-step-mark)]")}><ToolIcon part={part} /></span>
          <span aria-hidden className="w-px" style={{ height: RAIL.clear }} />
          {rail && <span aria-hidden className={cn("w-px flex-1", RAIL_INK)} />}
        </div>

        <div className="min-w-0 flex-1" style={{ paddingLeft: RAIL.label, ...(continues ? { paddingBottom: LINKED_GAP } : {}) }}>
          {hasPayload ? (
            <CollapsibleTrigger className={cn(LABEL_ROW, TRIGGER)}>{label}</CollapsibleTrigger>
          ) : (
            /* Same hover as a row that opens. Whether a step happens to have a
               payload is not a reason for it to read as a different kind of
               line. */
            <div className={cn(LABEL_ROW, "text-[var(--transcript-step)] transition-colors hover:text-[var(--transcript-step-strong)]")}>{label}</div>
          )}
          {hasPayload && (
            <CollapsibleContent>
              <div className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-[var(--color-background-elevated-secondary,var(--card))]">
                {/* Built for the tool when there is a view for it, raw when there is
                    not — `ToolDetail` decides, and falls back itself.

                    It cannot be decided here. `<ToolDetail/>` is an element, never
                    null, so testing it for nullishness always took the drawn branch
                    and a tool with no view of its own rendered an empty panel.

                    A failed call keeps the raw payload: the error text is the whole
                    point, and a drawn view of arguments that did not work hides it. */}
                {part.phase === "error" ? (
                  <RawPayload input={part.input} output={part.output} />
                ) : (
                  <ToolDetail input={part.input} output={part.output} tool={part.tool} />
                )}
              </div>
            </CollapsibleContent>
          )}
        </div>
      </div>
    </Collapsible>
  );
}

/**
 * A disclosure row, and the mark that opens it.
 *
 * Both exist because these rows are not buttons. They were built as full-width
 * targets with a hover fill and the chevron pinned to the far right, which turns
 * every step of the agent's work into a control the eye has to dismiss — and put
 * the chevron so far from the words it belonged to that it read as page furniture.
 * A line of text with a caret tucked against its end is the whole affordance:
 * `inline-flex` and no `flex-1` are what keep the row as wide as its content
 * instead of as wide as the thread.
 */
/* One row of the transcript, at the reference's rhythm: a ~26px row box, so two
   clustered steps land on a 32px pitch once the joining gap is added. The padding
   is small on purpose — the space between steps is what separates them, and paying
   for it twice is what spread a run of five calls over half a screen. */
const ROW = "relative inline-flex w-fit min-w-0 max-w-full items-center gap-2.5 px-1.5 py-[3px] text-left text-ui";
/** The icon column every row of a turn hangs its mark in.
 *
 *  Named, and reserved even when there is no mark to put in it. A settled
 *  thought used to draw no slot at all, so "Thought for 43s" started where the
 *  tool rows' *icons* start and the two lines under it started 26px further in
 *  — and the same row jumped left by that much the moment the turn finished,
 *  because the live version does draw one. A transcript with four left edges is
 *  what "the padding feels off" turns out to be. */
export const ROW_GLYPH = "grid size-4 shrink-0 place-items-center";
/* `cursor-default` for the same reason the sidebar sets it: AppKit shows the arrow
   over a list of rows, never the hand, and the pointer cursor is the clearest tell
   that a desktop app was built in a browser. These rows are a list, not controls. */
const TRIGGER = "group/row cursor-default rounded-md text-[var(--transcript-step)] transition-colors outline-none hover:text-[var(--transcript-step-strong)]";
/** The row's own horizontal inset, which anything hanging beneath a row aligns to.
 *  This is also the transcript's prose edge: a paragraph starts where a row's
 *  mark starts, not where its label does. */
export const ROW_INSET = "0.375rem";
/** Down the middle of the icon column: the row's inset plus half an icon. Where the
 *  rule joining one step to the next is drawn. */
export const ICON_CENTER = "0.875rem";
/** The gap between two steps of the same run of work, and therefore exactly the
 *  height of the rule that joins them. Exported so the row that sets the margin
 *  and the rule that fills it cannot drift apart.
 *
 *  Tight, and tighter than it reads: a step also carries the clearance its mark
 *  keeps off the line above and below it, so the space between two rows is this
 *  plus that. Widening it to give the line more room was the wrong knob — it
 *  pushed the steps apart and cost the cluster the tightness that makes a run of
 *  work read as one thing. */
export const LINKED_GAP = "0.25rem";
/** A step that opens a new run of work, and a paragraph of prose. Prose gets the
 *  most room of anything in a turn: the contrast between a tight cluster of steps
 *  and a sentence with air around it is what makes a long turn scannable. */
export const STEP_GAP = "0.5rem";
export const PROSE_GAP = "0.875rem";
/** Exactly where a row's label starts: the inset, plus the icon, plus the gap
 *  after it. A note under a row uses this so it lines up with the words it belongs
 *  to rather than nearly lining up with them. */
export const UNDER_LABEL = "1.9375rem";

/**
 * The thread, as one geometry rather than as several.
 *
 * A run of steps is drawn as a line down the icon column with the marks strung
 * on it, and that line is made of two pieces: a segment inside a row that has
 * been opened, running from its mark down past its panel, and a segment in the
 * margin between one row and the next. They are separate elements because they
 * live in separate components, and every time one of them was nudged on its own
 * the join stopped being a join — a stub here, a doubled rule there, two greys
 * eight pixels apart.
 *
 * So the numbers live here and both pieces read them. Opening a row extends the
 * same line rather than introducing another one, which is what makes expanding
 * and collapsing feel like the thread stretching instead of like furniture
 * appearing.
 */
export const RAIL = {
  /** How far the line stays off a mark, above and below. Enough to read as marks
   *  strung on a line rather than as one welded strip; not so much that what is
   *  left between two marks is a dash. */
  clear: "2px",
  /** From the mark's column to the words beside it. Chosen so a label lands on
   *  `UNDER_LABEL`, where a note hanging under a row lines up. */
  label: "0.1875rem",
} as const;

/** The line's own ink. One value, so no piece of the thread can be a different
 *  grey from the piece it joins. */
const RAIL_INK = "bg-[var(--border-strong)]";

/** A row's words: everything except the mark, which is now a column of its own.
 *  Keeps the row's height at exactly the mark's, so the two line up without
 *  either of them being nudged. */
const LABEL_ROW = "inline-flex w-fit min-w-0 max-w-full items-center gap-2.5 rounded-md px-1.5 py-[3px] text-left text-ui";

/**
 * The mark that opens a row, kept out of the way until it is wanted.
 *
 * Hidden at rest: a transcript is a dozen of these down the page, and a caret on
 * every line is a dozen pieces of furniture around the words that matter. It fades
 * in under the cursor, and stays up while the row is open or focused — an open row
 * with no caret has nothing to say how it closes, and a keyboard user never
 * generates the hover that would reveal it.
 *
 * Faded rather than removed from the layout, because the row is only as wide as its
 * content: taking the caret out of the flow would resize the row on hover.
 *
 * The negative margin pulls it back in from the row's own gap. That gap is set for
 * the distance between an icon and a sentence, which is far too much between a
 * sentence and the small mark that belongs to it.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={cn(
        "-ml-1.5 size-3.5 shrink-0 text-[var(--transcript-step-mark)] opacity-0 transition-[transform,opacity] duration-200",
        "group-hover/row:opacity-100",
        open && "opacity-100",
        !open && "-rotate-90",
      )}
    />
  );
}

/** How long a settled call took. Absent for a stored row, which does not keep
 *  timings, and for anything under a second, where the number is noise. */
function took(part: ToolPart): string {
  /* A question is not work the agent did — it is a wait on the learner. "Asked a
     question in 25s" times how long somebody took to read and think, which is a
     stopwatch held on them and tells them nothing about their project. */
  if (part.tool === "ask_user_question" || part.tool === "ask-user-question") return "";
  if (part.phase === "running" || !part.startedAt || !part.endedAt) return "";
  const seconds = (part.endedAt - part.startedAt) / 1_000;
  return seconds < 1 ? "" : `in ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="shrink-0 font-mono text-ui-sm tabular-nums">
      {added > 0 && <span className="text-[var(--success)]">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-destructive">-{removed}</span>}
    </span>
  );
}

/**
 * A rejected candidate is ordinary progress, not a fault: the compiler refuses
 * a design, the agent revises it, and the next one lands. Showing it in alarm
 * colours made the normal path read as breakage, so the reason is offered as
 * quiet detail the learner can look at rather than an interruption they must.
 */
function StepDetail({ detail }: { detail: string }) {
  const trimmed = detail.replace(/^status invalid · /, "").trim();
  if (!trimmed) return null;
  return (
    <p className="min-w-0 break-words text-ui-sm leading-[1.55] text-[var(--transcript-step)]" style={{ paddingLeft: UNDER_LABEL }}>
      {trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed}
    </p>
  );
}

/**
 * The model's own reasoning, live.
 *
 * While it is arriving the text is shown as it comes, following its own tail so
 * the newest line is the one in view — the point is that the learner can watch it
 * think, not read a finished essay. Once it settles it folds to one line saying
 * how long it took, because a transcript of a long session should be readable and
 * the thinking is still there to open.
 *
 * This replaced a fixed "Thinking" label with a spinner. That label was not
 * standing in for anything: the reasoning deltas were arriving all along and
 * being dropped as protocol noise before they reached the transcript.
 */
export function Reasoning({ part }: { part: Extract<RunPart, { kind: "reasoning" }> }) {
  const sections = thoughts(part.body);
  const seconds = Math.max(1, Math.round(((part.endedAt ?? Date.now()) - part.startedAt) / 1_000));

  /* Live, and folded like everything else.
     
     This used to print the whole stream inline while the model wrote it: a
     paragraph of half-finished reasoning that pushed the conversation off the
     screen and then vanished when the turn settled. Thinking is the agent's
     working, not its answer — the row says it is thinking and what about, and
     the stream is there for anybody who wants it.
     
     Open state survives the deltas because the part keeps its identity for the
     length of the run, so a thought opened mid-stream stays open and keeps
     following the tail. */
  if (part.open) {
    const current = sections.at(-1);
    return (
      <LiveThought
        body={part.body}
        id={part.id}
        sections={sections}
        title={current?.title ?? "Thinking"}
      />
    );
  }

  if (!sections.length) return null;
  /* Settled: one row per heading the model gave its own thinking, which is what
     makes a long turn readable — "Resolving the language conflict" says something,
     and seven rows of "Thought for 9s" say nothing. */
  return (
    <div className="min-w-0">
      {sections.map((section, index) => (
        <div key={`${part.id}-${index}`} className="min-w-0" {...(index > 0 ? { style: { marginTop: LINKED_GAP } } : {})}>
          {/* Several headings from one block of thinking are one cluster, spaced
              like consecutive steps rather than like separate paragraphs. */}
          <Thought
            body={section.body}
            /* A stored step has no clock on it — see `storedPart`. Reading a
               transcript back is not watching one settle, and every thought in
               it sliding into place on mount would be motion for nothing. */
            settling={part.startedAt > 0}
            title={section.title ?? `Thought for ${seconds}s`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Thinking as it arrives, behind a disclosure.
 *
 * The trigger is the same row every other step uses, so a turn in flight reads
 * as one column of steps rather than as a wall with rows either side of it. The
 * orb and the shimmer are what say this one is still happening.
 *
 * The stream inside follows its own tail and is capped, so opening it during a
 * long thought shows the end — where the model is now — rather than the
 * beginning, and never grows past a screenful.
 */
function LiveThought({
  body,
  id,
  sections,
  title,
}: {
  body: string;
  id: string;
  sections: Array<{ title?: string; body: string }>;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <>
      <span className={ROW_GLYPH}>
        <ThinkingOrb aria-label="Thinking" size={20} state="solving" style={{ width: 15, height: 15 }} />
      </span>
      <span className="thinking-shimmer min-w-0 truncate">{title}</span>
      {sections.length > 0 && <Caret open={open} />}
    </>
  );

  if (sections.length === 0) return <div className={cn(ROW, "text-[var(--transcript-step)]")}>{trigger}</div>;

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER)}>{trigger}</CollapsibleTrigger>
      <CollapsibleContent>
        <FadedScroll className="mx-1.5 mb-1" follow watch={body}>
          <div className="space-y-2 border-l border-border/70 pl-2.5 text-ui-sm leading-[1.6] text-[var(--transcript-step)]">
            {sections.map((section, index) => (
              <div key={`${id}-live-${index}`}>
                {/* The heading of a section that has finished. The one still
                    being written is already the row's own title. */}
                {section.title && index < sections.length - 1 && (
                  <p className="font-medium text-[var(--transcript-step-strong)]">{section.title}</p>
                )}
                {section.body && <p>{section.body}</p>}
              </div>
            ))}
          </div>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A settled thought: its own heading, and the thinking behind it.
 *
 * No icon, and no space held where one used to be. A brain glyph on every one of
 * these was decoration — the row already says "Thought for 9s" — but removing it
 * and keeping its gutter was worse than either: the text sat indented under a
 * blank column, which reads as a nested child of the row above rather than as a
 * step beside it. The thought starts at the margin.
 *
 * `settling` is how it gets there. While the model is thinking the row carries
 * an orb in the gutter, so its words sit a label's width in; the moment the orb
 * goes the words have to travel that width to the margin, and doing it in one
 * frame is a jump in the middle of a paragraph the reader is already looking at.
 * It is only ever true for a thought that has just finished in front of them —
 * a transcript read back from storage was never indented and has nothing to
 * travel.
 */
function Thought({ title, body, settling }: { title: string; body: string; settling: boolean }) {
  const [open, setOpen] = useState(false);
  /* Starts where the live row left it, then moves on the next frame. Setting
     both the start and the end in one commit would give the browser a single
     computed value and nothing to interpolate between. */
  const [home, setHome] = useState(!settling);
  useEffect(() => {
    if (home) return;
    const frame = requestAnimationFrame(() => setHome(true));
    return () => cancelAnimationFrame(frame);
  }, [home]);

  const travel = {
    paddingLeft: home ? ROW_INSET : UNDER_LABEL,
    transition: "padding-left 260ms cubic-bezier(0.32, 0.72, 0, 1)",
  };

  if (!body) {
    return (
      <div className={cn(ROW, "motion-reduce:transition-none text-[var(--transcript-step)]")} style={travel}>
        <span className="min-w-0 truncate">{title}</span>
      </div>
    );
  }
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className={cn(ROW, TRIGGER, "motion-reduce:transition-none")} style={travel}>
        <span className="min-w-0 truncate">{title}</span>
        <Caret open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Same height it had while it streamed. A thought that filled 1.5in and
            then expanded to a screenful on settling would reflow the thread under
            the reader at the exact moment they started reading it. */}
        <FadedScroll className="mx-1.5 mb-1">
          <p className="border-l border-border/70 pl-2.5 text-ui-sm leading-[1.6] text-[var(--transcript-step)]">{body}</p>
        </FadedScroll>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Construct reading how the challenge was actually solved.
 *
 * This is the step the rest of the turn is built on, and the learner should be
 * able to see it happen: what it looked at, and what it found in their own
 * attempt. It is deliberately not a retrieval row — "read your solve" is a
 * statement about them, and it is the difference between a tutor that saw the
 * verdict and one that watched the work.
 */
export function SolveRead({ part }: { part: ToolPart }) {
  const running = part.phase === "running";
  return (
    <div className={cn(ROW, "text-[var(--transcript-step)]")}>
      <span className="grid size-4 shrink-0 place-items-center text-[var(--transcript-step-mark)]">
        {running
          ? <ThinkingOrb aria-label="Reading your solve" size={20} state="searching" style={{ width: 15, height: 15 }} />
          : <History className="size-3.5" />}
      </span>
      <span className={cn("min-w-0 truncate", running && "thinking-shimmer")}>
        {running ? "Reading your solve" : "Read your solve"}
      </span>
      {/* What the replay found, on the same line. It used to be a stack of chips
          built by splitting the label on an em dash — a shape that broke the day
          that field started carrying the agent's own title for the step. */}
      {!running && part.detail && (
        <span className="min-w-0 truncate text-[var(--transcript-step-mark)]">{part.detail}</span>
      )}
    </div>
  );
}

/**
 * The moment the session exists to reach.
 *
 * Still the one row that is allowed to draw the eye, because it is the turn's
 * output rather than a step toward it — but a row, not a panel. It was a bordered
 * green card with an uppercase kicker, a chip, a spring-scaled badge and a light
 * sweep across it, which was defensible when the rows around it were dense grey
 * lines and is not now that they are a clean list: it read as a component from a
 * different application that had been pasted into the transcript. The colour on
 * the check and the weight on the title carry it.
 */
export function ChallengePublished({ part }: { part: ToolPart }) {
  const replaced = part.tool === "replace_current_question";
  /* A problem from the source is not "validated" — nothing was compiled, because
     nobody wrote it. What it carries instead is the source's own judge, and the mark
     is how that reads at a glance. */
  const sourced = part.tool === "assign_practice_problem";
  const source = sourceFor(part);
  const sourceName = source === "codeforces" ? "Codeforces" : "LeetCode";
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(ROW, "text-muted-foreground")}
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center", sourced ? "text-foreground/80" : "text-[var(--success)]")}>
        {sourced ? <SourceGlyph className="size-3.5" source={source} /> : <Check className="size-3.5" />}
      </span>
      <span className="min-w-0 truncate">
        <span className="text-ui font-medium text-foreground">{part.label || (sourced ? "Problem set" : replaced ? "Challenge replaced" : "Challenge ready")}</span>
        <span className="ml-1.5 text-muted-foreground/60">
          {sourced ? `· from ${sourceName} · judged there` : replaced ? "· replaced · validated" : "· validated"}
        </span>
      </span>
    </motion.div>
  );
}

function sourceFor(part: ToolPart): "leetcode" | "codeforces" {
  const text = `${part.input} ${part.output} ${part.detail} ${part.label} ${part.actionTitle}`.toLowerCase();
  return text.includes("codeforces") || text.includes('"source":"codeforces"') ? "codeforces" : "leetcode";
}

/**
 * A turn that could not finish. The learner needs to know what to do next, so
 * the sentence they can act on leads and the machine detail waits behind a
 * disclosure rather than filling the transcript with a stack of internals.
 */
export function RunFailure({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const [headline, ...rest] = body.split(/(?:\.\s+|\n)/).filter((line) => line.trim().length > 0);
  const detail = rest.join(" ").trim();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="my-0.5 min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-[var(--color-background-elevated-secondary,var(--card))] px-3 py-2.5"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.24 }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <CircleAlert className="mt-px size-4 shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-foreground">That turn did not finish</p>
          <p className="mt-0.5 min-w-0 break-words text-ui leading-[1.55] text-muted-foreground">
            {headline?.trim().replace(/\.$/, "") ?? "Construct could not complete that turn"}.
          </p>
          {detail && (
            <>
              <button
                className="mt-1.5 inline-flex items-center gap-1 text-ui-sm text-muted-foreground/70 transition-colors hover:text-foreground"
                onClick={() => setOpen((value) => !value)}
                type="button"
              >
                <ChevronDown className={cn("size-3 transition-transform duration-200", !open && "-rotate-90")} />
                {open ? "Hide details" : "Show details"}
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.pre
                    animate={{ height: "auto", opacity: 1 }}
                    className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--accent)] px-2.5 py-2 font-mono text-ui-sm leading-[1.5] text-muted-foreground/90"
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {detail}
                  </motion.pre>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
