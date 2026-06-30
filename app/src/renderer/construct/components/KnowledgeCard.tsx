import {
  BookmarkCheckIcon,
  BookmarkIcon,
  BrainCircuitIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CirclePlusIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  HistoryIcon,
  InfoIcon,
  User,
  XIcon
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { conceptMasteryRubricForLevel, type ConstructConceptMasteryLevel } from "../../../shared/constructLearning";
import { MarkdownBlock } from "./MarkdownBlock";
import type { ConceptCard } from "../types";
import type { InlineFileRef } from "../lib/inlineRefs";
import { cn } from "../../lib/utils";

type ConceptHistoryEvent = NonNullable<ConceptCard["history"]>[number];
type ConceptFieldChange = NonNullable<ConceptHistoryEvent["fieldChanges"]>[number];

type ConceptRevisionMode = "latest" | "history";

type MasteryShift = {
  before?: ConstructConceptMasteryLevel;
  after: ConstructConceptMasteryLevel;
  direction: "increased" | "decreased" | "unchanged";
};

type TextDiffPart = {
  kind: "same" | "added" | "removed";
  text: string;
};

type ConceptRevisionSnapshot = {
  title: string;
  content: string;
  why: string;
  commonMistake: string;
  example: string;
  confidenceReason?: string;
  masteryReason?: string;
  lastChangeReason?: string;
};

const cardSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.9
};

export function KnowledgeCard({
  concept,
  relatedConcepts = [],
  saved,
  theme,
  onClose,
  onOpenConcept,
  onOpenFile,
  onSaveChange
}: {
  concept: ConceptCard;
  relatedConcepts?: ConceptCard[];
  saved: boolean;
  theme: "light" | "dark" | "system";
  onClose: () => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
  onSaveChange: (saved: boolean) => void;
}) {
  const related = buildConceptFiles(concept, relatedConcepts);
  const history = useMemo(() => orderConceptHistory(concept.history?.length ? concept.history : buildFallbackHistory(concept)), [concept]);
  const guideBlocks = concept.guides.filter((guide) => guide.content || guide.sections.length);
  const [mode, setMode] = useState<ConceptRevisionMode>("latest");
  const [collapsed, setCollapsed] = useState(false);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(() => Math.max(0, history.length - 1));

  useEffect(() => {
    setMode("latest");
    setSelectedHistoryIndex(Math.max(0, history.length - 1));
  }, [concept.id, concept.lastModifiedAt, history.length]);

  useEffect(() => {
    setCollapsed(false);
  }, [concept.id]);

  useEffect(() => {
    setSelectedHistoryIndex((index) => clamp(index, 0, Math.max(0, history.length - 1)));
  }, [history.length]);

  const currentMasteryLevel = masteryLevelForConcept(concept);
  const selectedHistory = history[selectedHistoryIndex] ?? history.at(-1) ?? null;
  const latestHistory = history.at(-1) ?? null;
  const highlightedHistory = mode === "history" ? selectedHistory : latestHistory;
  const displayedMasteryLevel = mode === "history" && selectedHistory
    ? masteryLevelForEvent(selectedHistory, currentMasteryLevel)
    : currentMasteryLevel;
  const masteryShift = highlightedHistory ? masteryShiftForEvent(highlightedHistory, displayedMasteryLevel) : null;
  const masteryRubric = conceptMasteryRubricForLevel(displayedMasteryLevel);
  const levelUp = Boolean(masteryShift && masteryShift.before !== undefined && masteryShift.after > masteryShift.before);
  const introduced = highlightedHistory?.kind === "introduced";
  const latestMasteryEventIndex = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (masteryShiftForEvent(history[index]) !== null) return index;
    }
    return Math.max(0, history.length - 1);
  }, [history]);

  const masteryTooltip = mode === "history" && selectedHistory && levelUp
    ? selectedHistory.masteryReason ?? selectedHistory.reason ?? "Mastery increased at this revision."
    : masteryRubric.text;
  const activeHistoryEvent = mode === "history" ? selectedHistory : null;
  const revisionSnapshot = activeHistoryEvent
    ? buildConceptRevisionSnapshot(concept, guideBlocks, history, selectedHistoryIndex)
    : null;

  return (
    <motion.section
      className={cn(
        "opaline-overlay-shadow flex min-h-0 w-full flex-col overflow-hidden rounded-[18px] border border-border/80 bg-popover/94 text-sm text-popover-foreground backdrop-blur-xl backdrop-saturate-150",
        collapsed ? "h-auto" : "h-full"
      )}
      data-construct-explainable="concept-card"
      data-construct-explainable-label={concept.title}
      data-collapsed={collapsed ? "true" : "false"}
      data-saved={saved ? "true" : "false"}
      data-revision-mode={mode}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={cardSpring}
    >
      <header className={cn("flex shrink-0 items-stretch bg-background/35", !collapsed && "border-b border-border/70")}>
        <MasteryBadge
          level={displayedMasteryLevel}
          title={masteryRubric.title}
          tooltip={masteryTooltip}
          emphasized={levelUp}
          newConcept={introduced && mode === "history"}
          onClick={() => {
            if (history.length) {
              setMode("history");
              setSelectedHistoryIndex(latestMasteryEventIndex);
            }
          }}
        />
        <div className="flex flex-1 flex-col py-2.5 pl-2.5 pr-3 min-w-0">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide">Concept</span>
                {introduced ? (
                  <span className="rounded-full border border-[color:var(--construct-success)]/35 bg-[color:var(--construct-success-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--construct-success)]">
                    New
                  </span>
                ) : mode === "history" && selectedHistory ? (
                  <span className={cn(
                    "rounded-full border px-1.5 py-0.5 capitalize",
                    selectedHistory.kind === "modified" && "border-[color:var(--construct-warning)]/35 bg-[color:var(--construct-warning-soft)] text-[color:var(--construct-warning)]"
                  )}>
                    {selectedHistory.kind}
                  </span>
                ) : null}
                {concept.technology ? <span className="rounded-full border px-1.5 py-0.5">{concept.technology}</span> : null}
              </div>
              <HeaderConceptTitle title={revisionSnapshot?.title ?? concept.title} event={activeHistoryEvent} />
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/75">{concept.id}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className={cn(
                  "grid size-8 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  collapsed && "bg-muted text-foreground"
                )}
                onClick={() => setCollapsed((value) => !value)}
                aria-pressed={collapsed}
                aria-label={collapsed ? "Expand concept card" : "Collapse concept card"}
                title={collapsed ? "Expand concept card" : "Collapse concept card"}
              >
                <ChevronUpIcon size={15} className={cn("transition-transform", collapsed && "rotate-180")} />
              </button>
              <button
                type="button"
                className={cn(
                  "grid size-8 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  mode === "history" && "bg-muted text-foreground"
                )}
                onClick={() => setMode((value) => value === "history" ? "latest" : "history")}
                aria-pressed={mode === "history"}
                aria-label="Toggle updates history"
                title="Toggle updates history"
              >
                <HistoryIcon size={15} />
              </button>
              <button
                type="button"
                className="grid size-8 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={onClose}
                aria-label="Close concept"
                title="Close concept"
              >
                <XIcon size={15} />
              </button>
            </div>
          </div>

          <div className={cn("construct-concept-card-accordion shrink-0", !collapsed && "is-open")} aria-hidden={collapsed}>
            <div>
              <div className="mt-2 border-t border-border/60 pt-1.5">
                {mode === "history" ? (
                  <>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">History</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none"
                          onClick={() => setSelectedHistoryIndex((index) => clamp(index - 1, 0, history.length - 1))}
                          disabled={selectedHistoryIndex <= 0}
                          aria-label="Previous concept update"
                          title="Previous concept update"
                          tabIndex={collapsed ? -1 : undefined}
                        >
                          <ChevronLeftIcon size={14} />
                        </button>
                        <span className="min-w-[2.5rem] text-center font-mono text-[11px] text-muted-foreground">
                          {history.length ? `${selectedHistoryIndex + 1}/${history.length}` : "0/0"}
                        </span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:pointer-events-none"
                          onClick={() => setSelectedHistoryIndex((index) => clamp(index + 1, 0, history.length - 1))}
                          disabled={selectedHistoryIndex >= history.length - 1}
                          aria-label="Next concept update"
                          title="Next concept update"
                          tabIndex={collapsed ? -1 : undefined}
                        >
                          <ChevronRightIcon size={14} />
                        </button>
                      </div>
                    </div>
                    <RevisionRail
                      events={history}
                      selectedIndex={selectedHistoryIndex}
                      onSelect={setSelectedHistoryIndex}
                    />
                  </>
                ) : (
                  <ConceptProfileStrip concept={concept} />
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className={cn("construct-concept-card-accordion min-h-0 flex-1", !collapsed && "is-open")} aria-hidden={collapsed}>
        <div>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <ConceptCardBody
              concept={concept}
              related={related}
              guideBlocks={guideBlocks}
              revisionSnapshot={revisionSnapshot}
              theme={theme}
              activeEvent={activeHistoryEvent}
              masteryShift={masteryShift}
              onOpenConcept={onOpenConcept}
              onOpenFile={onOpenFile}
            />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function MasteryBadge({
  level,
  title,
  tooltip,
  emphasized,
  newConcept,
  onClick
}: {
  level: ConstructConceptMasteryLevel;
  title: string;
  tooltip: string;
  emphasized: boolean;
  newConcept: boolean;
  onClick: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const glow = emphasized
    ? [
        "0 0 0 1px color-mix(in srgb,var(--construct-success)_46%,transparent), 0 8px 26px color-mix(in srgb,var(--construct-success)_16%,transparent)",
        "0 0 0 1px color-mix(in srgb,var(--construct-success)_72%,transparent), 0 16px 44px color-mix(in srgb,var(--construct-success)_32%,transparent)"
      ]
    : newConcept
      ? [
          "0 0 0 1px color-mix(in srgb,var(--primary)_24%,transparent), 0 8px 24px color-mix(in srgb,var(--primary)_10%,transparent)",
          "0 0 0 1px color-mix(in srgb,var(--primary)_40%,transparent), 0 14px 36px color-mix(in srgb,var(--primary)_18%,transparent)"
        ]
      : "0 1px 2px color-mix(in srgb,var(--foreground)_10%,transparent)";

  return (
    <div className="group relative shrink-0 self-stretch">
      <motion.button
        type="button"
        className={cn(
          "relative grid w-10 h-full place-items-center overflow-hidden rounded-none border-y-0 border-l-0 border-r border-border/70 bg-muted/20 text-foreground outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
          emphasized && "border-foreground/35 bg-muted/40 font-semibold",
          newConcept && !emphasized && "bg-muted/30"
        )}
        onClick={onClick}
        aria-label={`Mastery level ${level}: ${title}`}
        key={level}
        initial={reduceMotion ? false : { scale: 0.95, rotate: emphasized ? -2 : 0 }}
        animate={{
          scale: 1,
          rotate: 0,
          boxShadow: glow
        }}
        transition={emphasized || newConcept ? {
          scale: cardSpring,
          rotate: cardSpring,
          boxShadow: reduceMotion ? { duration: 0.01 } : { duration: 1.5, repeat: Infinity, repeatType: "reverse" }
        } : cardSpring}
      >
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,color-mix(in_srgb,var(--foreground)_6%,transparent),transparent_45%)]" />
        <span className="relative flex flex-col items-center leading-none">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">Level</span>
          <span className="mt-0.5 text-lg font-bold tabular-nums tracking-tight text-foreground">
            {level}
          </span>
        </span>
      </motion.button>
      <div className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-50 hidden w-64 rounded-[8px] border border-border bg-popover/98 p-2.5 text-xs leading-relaxed text-popover-foreground shadow-lg backdrop-blur-md group-hover:block group-focus-within:block">
        <div className="mb-1 font-semibold text-foreground">
          {title}
        </div>
        <p className="text-muted-foreground/90">{tooltip}</p>
      </div>
    </div>
  );
}

function ConceptProfileStrip({ concept }: { concept: ConceptCard }) {
  const author = concept.authoredBy ? `${capitalize(concept.authoredBy)} authored` : "Source unknown";
  const language = concept.language ? languageLabel(concept.language) : "Language neutral";
  const updated = concept.lastModifiedAt ? formatShortDate(concept.lastModifiedAt) : concept.savedAt ? formatShortDate(concept.savedAt) : "Not saved yet";

  const isAgent = concept.authoredBy?.toLowerCase() === "agent";

  return (
    <div className="mt-1 flex items-center gap-2.5 text-[10px] text-muted-foreground/75">
      {/* Mode / Language (always visible) */}
      <span className="font-semibold text-foreground/80">{language}</span>
      <span className="text-muted-foreground/20">·</span>

      {/* Author Popover */}
      <div className="group relative cursor-default">
        <span className="flex items-center gap-1 hover:text-foreground transition-colors py-0.5">
          <User size={11} className="text-muted-foreground/75" />
          <span className="font-medium">Author</span>
        </span>
        {/* Popover content */}
        <div className="pointer-events-none absolute left-1/2 top-[calc(100%+0.4rem)] z-50 hidden -translate-x-1/2 w-48 rounded-[8px] border border-border bg-popover/98 p-2 text-[11px] leading-normal text-popover-foreground shadow-lg backdrop-blur-md group-hover:block group-focus-within:block transition-all duration-200">
          <div className="font-semibold text-foreground mb-0.5">Author</div>
          <div className="text-muted-foreground">{author}</div>
        </div>
      </div>

      <span className="text-muted-foreground/20">·</span>

      {/* Updated Popover */}
      <div className="group relative cursor-default">
        <span className="flex items-center gap-1 hover:text-foreground transition-colors py-0.5">
          <HistoryIcon size={11} className="text-muted-foreground/75" />
          <span className="font-medium">Updated</span>
        </span>
        {/* Popover content */}
        <div className="pointer-events-none absolute left-1/2 top-[calc(100%+0.4rem)] z-50 hidden -translate-x-1/2 w-48 rounded-[8px] border border-border bg-popover/98 p-2 text-[11px] leading-normal text-popover-foreground shadow-lg backdrop-blur-md group-hover:block group-focus-within:block transition-all duration-200">
          <div className="font-semibold text-foreground mb-0.5">Last Updated</div>
          <div className="text-muted-foreground">{updated}</div>
        </div>
      </div>
    </div>
  );
}


function HeaderConceptTitle({ title, event }: { title: string; event: ConceptHistoryEvent | null }) {
  const titleChange = event ? fieldChangeFor(event, "title") : undefined;
  if (!titleChange) {
    return <h2 className="text-sm font-semibold tracking-tight break-words">{title}</h2>;
  }
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold tracking-tight break-words">
        {normalizeAuditText(titleChange.after) || title}
      </h2>
      {titleChange.before ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          was <span className="line-through decoration-destructive/60">{titleChange.before}</span>
        </p>
      ) : null}
    </div>
  );
}

function ConceptCardBody({
  concept,
  related,
  guideBlocks,
  revisionSnapshot,
  theme,
  activeEvent,
  masteryShift,
  onOpenConcept,
  onOpenFile
}: {
  concept: ConceptCard;
  related: Array<{ id: string; title: string; depth: number; kind: "folder" | "file" }>;
  guideBlocks: ConceptCard["guides"];
  revisionSnapshot: ConceptRevisionSnapshot | null;
  theme: "light" | "dark" | "system";
  activeEvent: ConceptHistoryEvent | null;
  masteryShift: MasteryShift | null;
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const visibleContent = revisionSnapshot?.content ?? concept.content ?? guideBlocks[0]?.content ?? "";
  const visibleWhy = revisionSnapshot?.why ?? concept.why;
  const visibleCommonMistake = revisionSnapshot?.commonMistake ?? concept.commonMistake;
  const visibleExample = revisionSnapshot?.example ?? concept.example;
  const visibleLastChangeReason = revisionSnapshot?.lastChangeReason ?? concept.lastChangeReason;
  const visibleMasteryReason = revisionSnapshot?.masteryReason ?? concept.masteryReason;
  const visibleConfidenceReason = revisionSnapshot?.confidenceReason ?? concept.confidenceReason;

  return (
    <>
      {activeEvent ? (
        <InlineRevisionMarker event={activeEvent} masteryShift={masteryShift} />
      ) : null}

      {related.length ? (
        <ConceptBlock>
          <div className="flex flex-col">
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground outline-none hover:text-foreground text-left"
              onClick={() => setIsTreeOpen((open) => !open)}
            >
              <ChevronRightIcon
                size={12}
                className={cn(
                  "shrink-0 text-muted-foreground/60 transition-transform duration-200",
                  isTreeOpen && "rotate-90"
                )}
              />
              <span>View concept tree</span>
            </button>
            <AnimatePresence initial={false}>
              {isTreeOpen && (
                <motion.div
                  key="concept-tree-accordion"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 flex flex-col gap-0.5 pl-1">
                    {related.map((item) => (
                      <button
                        key={`${item.kind}:${item.id}`}
                        type="button"
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                          item.id === concept.id && "bg-muted/60 text-foreground"
                        )}
                        style={{ paddingLeft: `${8 + item.depth * 14}px` }}
                        onClick={() => item.id !== concept.id && onOpenConcept(item.id)}
                      >
                        {item.kind === "folder" ? <FolderIcon size={14} className="shrink-0 text-muted-foreground" /> : <FileTextIcon size={14} className="shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.id !== concept.id ? <ChevronRightIcon size={13} className="shrink-0 text-muted-foreground" /> : null}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ConceptBlock>
      ) : null}

      {guideBlocks.length ? guideBlocks.map((guide) => {
        const label = guideLabel(guide.guideKind);
        const showTitle = label.toLowerCase() !== "explanation";
        const isExplanation = guide.id === "explanation" || guide.guideKind === "guide.explanation";
        const guideContent = isExplanation ? visibleContent : guide.content;
        return (
          <ConceptBlock key={guide.id} title={showTitle ? label : undefined} changed={isExplanation && Boolean(fieldChangeFor(activeEvent, "content"))}>
            {guideContent ? (
              <ConceptMarkdownOrDiff
                field="content"
                content={guideContent}
                event={isExplanation ? activeEvent : null}
                theme={theme}
                sources={concept.sources}
                onOpenConcept={onOpenConcept}
                onOpenFile={onOpenFile}
              />
            ) : null}
            {guide.sections.map((section) => (
              <MarkdownBlock key={section.kind} content={section.content} theme={theme} sources={concept.sources} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
            ))}
          </ConceptBlock>
        );
      }) : visibleContent ? (
        <ConceptBlock changed={Boolean(fieldChangeFor(activeEvent, "content"))}>
          <ConceptMarkdownOrDiff
            field="content"
            content={visibleContent}
            event={activeEvent}
            theme={theme}
            sources={concept.sources}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        </ConceptBlock>
      ) : null}

      {visibleWhy ? (
        <ConceptBlock title="Why" changed={Boolean(fieldChangeFor(activeEvent, "why"))}>
          <ConceptMarkdownOrDiff
            field="why"
            content={visibleWhy}
            event={activeEvent}
            theme={theme}
            sources={concept.sources}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        </ConceptBlock>
      ) : null}

      {visibleCommonMistake ? (
        <ConceptBlock title="Common mistake" changed={Boolean(fieldChangeFor(activeEvent, "commonMistake"))}>
          <ConceptMarkdownOrDiff
            field="commonMistake"
            content={visibleCommonMistake}
            event={activeEvent}
            theme={theme}
            sources={concept.sources}
            onOpenConcept={onOpenConcept}
            onOpenFile={onOpenFile}
          />
        </ConceptBlock>
      ) : null}

      {visibleExample ? (
        <ConceptBlock title="Example" changed={Boolean(fieldChangeFor(activeEvent, "example") ?? fieldChangeFor(activeEvent, "examples"))}>
          {fieldChangeFor(activeEvent, "example") ?? fieldChangeFor(activeEvent, "examples") ? (
            <InlineConceptDiff
              before={(fieldChangeFor(activeEvent, "example") ?? fieldChangeFor(activeEvent, "examples"))?.before}
              after={(fieldChangeFor(activeEvent, "example") ?? fieldChangeFor(activeEvent, "examples"))?.after ?? visibleExample}
            />
          ) : (
            <MarkdownBlock content={`\`\`\`${exampleLanguage(concept)}\n${visibleExample}\n\`\`\``} theme={theme} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />
          )}
        </ConceptBlock>
      ) : null}

      {(visibleLastChangeReason || visibleConfidenceReason || visibleMasteryReason || concept.learnerEvidence?.length || activeEvent?.evidence.length || activeEvent?.provenance) ? (
        <ConceptBlock title="Evidence" changed={Boolean(fieldChangeFor(activeEvent, "confidenceReason") ?? fieldChangeFor(activeEvent, "masteryReason"))}>
          <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
            {visibleLastChangeReason ? (
              <InlineEvidenceLine label="Why now" value={visibleLastChangeReason} change={fieldChangeFor(activeEvent, "lastChangeReason")} />
            ) : activeEvent?.reason ? (
              <InlineEvidenceLine label="Why now" value={activeEvent.reason} />
            ) : null}
            {visibleMasteryReason ? (
              <InlineEvidenceLine label="Mastery" value={visibleMasteryReason} change={fieldChangeFor(activeEvent, "masteryReason")} />
            ) : null}
            {visibleConfidenceReason ? (
              <InlineEvidenceLine label="Learning state" value={visibleConfidenceReason} change={fieldChangeFor(activeEvent, "confidenceReason")} />
            ) : null}
            {activeEvent?.provenance ? <InlineProvenance event={activeEvent} /> : null}
            {(activeEvent?.evidence.length ? activeEvent.evidence : concept.learnerEvidence)?.length ? (
              <ul className="flex flex-col gap-1">
                {(activeEvent?.evidence.length ? activeEvent.evidence : concept.learnerEvidence ?? []).map((item, index) => <li key={`${index}:${item}`}>- {item}</li>)}
              </ul>
            ) : null}
          </div>
        </ConceptBlock>
      ) : null}

      {concept.docs.length > 0 ? (
        <ConceptBlock title="Docs">
          <div className="flex flex-col gap-1">
            {concept.docs.map((link) => (
              <a className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" key={link.url} href={link.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon size={13} />
                <span>{link.title}</span>
              </a>
            ))}
          </div>
        </ConceptBlock>
      ) : null}

      {concept.sources?.length ? (
        <ConceptBlock title="Sources">
          <div className="flex flex-col gap-2">
            {concept.sources.map((source) => (
              <a key={`${source.id}:${source.url}`} className="rounded-[8px] border bg-muted/15 p-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" href={source.url} target="_blank" rel="noreferrer">
                <span className="flex min-w-0 items-center gap-2">
                  <ExternalLinkIcon size={13} className="shrink-0" />
                  <strong className="truncate text-foreground">{source.title}</strong>
                </span>
                {(source.quote || source.snippet) ? <span className="mt-1 block leading-relaxed">{source.quote || source.snippet}</span> : null}
              </a>
            ))}
          </div>
        </ConceptBlock>
      ) : null}
    </>
  );
}

function InlineRevisionMarker({ event, masteryShift }: { event: ConceptHistoryEvent; masteryShift: MasteryShift | null }) {
  return (
    <div className={cn(
      "mb-2 flex min-w-0 items-center justify-between gap-3 rounded-[10px] border bg-muted/15 px-3 py-2 text-xs text-muted-foreground",
      event.kind === "introduced" && "border-[color:var(--construct-success)]/30 bg-[color:var(--construct-success-soft)]/20",
      masteryShift?.direction === "increased" && "border-[color:var(--construct-success)]/35"
    )}>
      <span className="min-w-0 truncate">
        <strong className="capitalize text-foreground">{event.kind}</strong>
        {event.reason ? <span> · {event.reason}</span> : null}
      </span>
      <time className="shrink-0 font-mono text-[10px]">{formatShortDate(event.createdAt)}</time>
    </div>
  );
}

function ConceptMarkdownOrDiff({
  field,
  content,
  event,
  theme,
  sources,
  onOpenConcept,
  onOpenFile
}: {
  field: string;
  content: string;
  event: ConceptHistoryEvent | null;
  theme: "light" | "dark" | "system";
  sources: ConceptCard["sources"];
  onOpenConcept: (conceptId: string) => void;
  onOpenFile: (reference: InlineFileRef) => void;
}) {
  const change = fieldChangeFor(event, field);
  if (change) {
    return <InlineConceptDiff before={change.before} after={change.after ?? content} />;
  }
  return <MarkdownBlock content={content} theme={theme} sources={sources} onOpenConcept={onOpenConcept} onOpenFile={onOpenFile} />;
}

function InlineConceptDiff({ before, after }: { before?: string; after?: string }) {
  const diff = buildTextDiff(normalizeAuditText(before), normalizeAuditText(after));
  if (!diff.length) {
    return <p className="text-sm leading-7 text-muted-foreground">No visible text change recorded.</p>;
  }
  return (
    <div className="text-sm leading-7 text-foreground">
      {diff.map((part, index) => (
        <span
          key={`${index}:${part.kind}:${part.text}`}
          className={cn(
            part.kind === "same" && "text-muted-foreground",
            part.kind === "added" && "rounded-[5px] bg-[color:var(--construct-success-soft)] px-1 py-0.5 font-medium text-[color:var(--construct-success)]",
            part.kind === "removed" && "rounded-[5px] bg-destructive/10 px-1 py-0.5 text-destructive line-through decoration-destructive/60"
          )}
        >
          {part.text}
          {index < diff.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
}

function InlineEvidenceLine({ label, value, change }: { label: string; value: string; change?: { before?: string; after?: string } }) {
  return (
    <div>
      <strong className="text-foreground">{label}:</strong>
      {change ? (
        <div className="mt-1">
          <InlineConceptDiff before={change.before} after={change.after ?? value} />
        </div>
      ) : (
        <span> {value}</span>
      )}
    </div>
  );
}

function InlineProvenance({ event }: { event: ConceptHistoryEvent }) {
  if (!event.provenance) return null;
  const path = event.provenance.pathNodeTitle ?? event.provenance.pathNodeId;
  const task = event.provenance.taskTitle ?? event.provenance.taskId;
  return (
    <p>
      <strong className="text-foreground">Source:</strong>{" "}
      {[event.provenance.projectTitle, path, task].filter(Boolean).join(" / ")}
    </p>
  );
}

function RevisionRail({
  events,
  selectedIndex,
  onSelect
}: {
  events: ConceptHistoryEvent[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="relative flex items-center justify-between px-2 py-3">
      {/* Background connector line running behind all dots */}
      <div className="absolute left-[18px] right-[18px] h-[1px] bg-border/80" />

      {/* Selected path line */}
      <div
        className="absolute left-[18px] h-[1px] bg-foreground/45 transition-all duration-150"
        style={{
          width: events.length > 1
            ? `calc((100% - 36px) * ${selectedIndex / (events.length - 1)})`
            : '0%',
        }}
      />

      {events.map((event, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={event.id}
            type="button"
            className="z-10 flex size-5 items-center justify-center rounded-full focus-visible:outline-none"
            onClick={() => onSelect(index)}
            aria-label={`Concept update ${index + 1}: ${event.kind}`}
            title={`${capitalize(event.kind)} - ${formatShortDate(event.createdAt)}`}
          >
            <span className={cn(
              "size-2 rounded-full border transition-all duration-150",
              selected
                ? "bg-foreground border-foreground scale-125 shadow-[0_0_8px_rgba(255,255,255,0.2)]"
                : "bg-muted/90 border-border/80 hover:bg-muted-foreground/50 hover:border-muted-foreground/50"
            )} />
          </button>
        );
      })}
    </div>
  );
}

function ConceptBlock({ title, changed, children }: { title?: string; changed?: boolean; children: ReactNode }) {
  return (
    <section className={cn(
      "border-t py-2.5 first:border-t-0 first:pt-0",
      changed && "rounded-[12px] border border-[color:var(--construct-success)]/25 bg-[color:var(--construct-success-soft)]/10 px-3 first:border-t"
    )}>
      {title ? (
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{title}</span>
          {changed ? <span className="rounded-full border border-[color:var(--construct-success)]/25 bg-background/60 px-1.5 py-0.5 text-[9px] text-[color:var(--construct-success)]">changed</span> : null}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function buildConceptFiles(concept: ConceptCard, concepts: ConceptCard[]) {
  const rows: Array<{ id: string; title: string; depth: number; kind: "folder" | "file" }> = [];
  const segments = concept.id.split(".").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    const id = segments.slice(0, index).join(".");
    rows.push({
      id,
      title: concepts.find((item) => item.id === id)?.title ?? conceptTitleFromId(id),
      depth: index - 1,
      kind: "folder"
    });
  }
  rows.push({ id: concept.id, title: concept.title, depth: Math.max(0, segments.length - 1), kind: "file" });

  const childPrefix = `${concept.id}.`;
  const directChildren = concepts
    .filter((item) => item.id.startsWith(childPrefix))
    .filter((item) => item.id.slice(childPrefix.length).split(".").filter(Boolean).length === 1)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const child of directChildren) {
    rows.push({
      id: child.id,
      title: child.title,
      depth: segments.length,
      kind: "file"
    });
  }

  for (const relatedId of concept.relatedConcepts ?? []) {
    if (rows.some((row) => row.id === relatedId)) continue;
    const related = concepts.find((item) => item.id === relatedId);
    rows.push({
      id: relatedId,
      title: related?.title ?? conceptTitleFromId(relatedId),
      depth: 0,
      kind: "file"
    });
  }

  return rows;
}

function buildFallbackHistory(concept: ConceptCard): NonNullable<ConceptCard["history"]> {
  if (!concept.lastChangeReason && !concept.savedAt && !concept.lastModifiedAt) return [];
  return [{
    id: `${concept.id}:latest`,
    kind: concept.savedAt === concept.lastModifiedAt ? "introduced" : "modified",
    reason: concept.lastChangeReason ?? "Concept record changed.",
    evidence: concept.learnerEvidence ?? [],
    changedFields: [],
    fieldChanges: [],
    confidence: concept.confidence,
    confidenceReason: concept.confidenceReason,
    masteryLevel: concept.masteryLevel,
    masteryText: concept.masteryText,
    masteryReason: concept.masteryReason,
    authoredBy: concept.authoredBy,
    agentContributionPercent: concept.agentContributionPercent,
    createdAt: concept.lastModifiedAt ?? concept.savedAt ?? new Date().toISOString()
  }];
}

function buildConceptRevisionSnapshot(
  concept: ConceptCard,
  guideBlocks: ConceptCard["guides"],
  history: NonNullable<ConceptCard["history"]>,
  selectedIndex: number
): ConceptRevisionSnapshot {
  const snapshot: ConceptRevisionSnapshot = {
    title: concept.title,
    content: concept.content ?? guideBlocks.find((guide) => guide.id === "explanation")?.content ?? guideBlocks[0]?.content ?? "",
    why: concept.why,
    commonMistake: concept.commonMistake ?? "",
    example: concept.example,
    confidenceReason: concept.confidenceReason,
    masteryReason: concept.masteryReason,
    lastChangeReason: concept.lastChangeReason
  };

  for (let index = history.length - 1; index > selectedIndex; index -= 1) {
    for (const change of history[index]?.fieldChanges ?? []) {
      applySnapshotBeforeValue(snapshot, change.field, change.before);
    }
  }

  return snapshot;
}

function applySnapshotBeforeValue(snapshot: ConceptRevisionSnapshot, field: string, before?: string) {
  if (before === undefined) return;
  if (field === "title") snapshot.title = before;
  if (field === "content" || field === "summary") snapshot.content = before;
  if (field === "why") snapshot.why = before;
  if (field === "commonMistake") snapshot.commonMistake = before;
  if (field === "example" || field === "examples") snapshot.example = before;
  if (field === "confidenceReason") snapshot.confidenceReason = before;
  if (field === "masteryReason") snapshot.masteryReason = before;
  if (field === "lastChangeReason") snapshot.lastChangeReason = before;
}

function fieldChangeFor(event: ConceptHistoryEvent | null | undefined, field: string): ConceptFieldChange | undefined {
  return event?.fieldChanges?.find((change) => change.field === field);
}

function orderConceptHistory(history: NonNullable<ConceptCard["history"]>): NonNullable<ConceptCard["history"]> {
  return history.slice().sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    if (Number.isNaN(left) || Number.isNaN(right)) return 0;
    return left - right;
  });
}

function masteryLevelForConcept(concept: ConceptCard): ConstructConceptMasteryLevel {
  const explicit = readMasteryLevel(concept.masteryLevel);
  if (explicit !== undefined) return explicit;
  if (concept.confidence === "applying") return 3;
  if (concept.confidence === "solid" || concept.confidence === "strong") return 4;
  if (concept.confidence === "fluent" || concept.confidence === "teaching") return 5;
  if (concept.confidence === "practicing" || concept.confidence === "emerging") return 2;
  if (concept.confidence === "confused" || concept.confidence === "fragile" || concept.confidence === "weak") return 1;
  return 0;
}

function masteryLevelForEvent(event: ConceptHistoryEvent, fallback: ConstructConceptMasteryLevel): ConstructConceptMasteryLevel {
  const shift = masteryShiftForEvent(event);
  if (shift) return shift.after;
  const explicit = readMasteryLevel(event.masteryLevel);
  return explicit ?? fallback;
}

function masteryShiftForEvent(event: ConceptHistoryEvent, fallbackAfter?: ConstructConceptMasteryLevel): MasteryShift | null {
  const masteryChange = event.fieldChanges?.find((change) => change.field === "masteryLevel");
  const before = readMasteryLevel(masteryChange?.before);
  const after = readMasteryLevel(masteryChange?.after) ?? readMasteryLevel(event.masteryLevel) ?? fallbackAfter;
  if (after === undefined) return null;
  const direction = event.masteryDirection
    ?? (before === undefined ? "unchanged" : after > before ? "increased" : after < before ? "decreased" : "unchanged");
  if (before === undefined && event.masteryDirection === undefined && event.masteryLevel === undefined) return null;
  return { before, after, direction };
}

function readMasteryLevel(value: unknown): ConstructConceptMasteryLevel | undefined {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5) return parsed;
  }
  return undefined;
}

function normalizeAuditText(value?: string): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function buildTextDiff(before: string, after: string): TextDiffPart[] {
  if (!before && !after) return [];
  if (!before) return [{ kind: "added", text: after }];
  if (!after) return [{ kind: "removed", text: before }];
  if (before === after) return [{ kind: "same", text: after }];

  const beforeTokens = tokenizeDiffText(before, after);
  const afterTokens = tokenizeDiffText(after, before);
  if (beforeTokens.length * afterTokens.length > 42000) {
    return [
      { kind: "removed", text: compactChangeText(before) },
      { kind: "added", text: compactChangeText(after) }
    ];
  }

  const dp = Array.from({ length: beforeTokens.length + 1 }, () => Array<number>(afterTokens.length + 1).fill(0));
  for (let left = beforeTokens.length - 1; left >= 0; left -= 1) {
    for (let right = afterTokens.length - 1; right >= 0; right -= 1) {
      dp[left][right] = beforeTokens[left] === afterTokens[right]
        ? dp[left + 1][right + 1] + 1
        : Math.max(dp[left + 1][right], dp[left][right + 1]);
    }
  }

  const parts: TextDiffPart[] = [];
  let left = 0;
  let right = 0;
  while (left < beforeTokens.length && right < afterTokens.length) {
    if (beforeTokens[left] === afterTokens[right]) {
      pushDiffPart(parts, "same", beforeTokens[left]);
      left += 1;
      right += 1;
    } else if (dp[left + 1][right] >= dp[left][right + 1]) {
      pushDiffPart(parts, "removed", beforeTokens[left]);
      left += 1;
    } else {
      pushDiffPart(parts, "added", afterTokens[right]);
      right += 1;
    }
  }
  while (left < beforeTokens.length) {
    pushDiffPart(parts, "removed", beforeTokens[left]);
    left += 1;
  }
  while (right < afterTokens.length) {
    pushDiffPart(parts, "added", afterTokens[right]);
    right += 1;
  }
  return parts;
}

function tokenizeDiffText(value: string, counterpart: string): string[] {
  const compact = value.trim();
  const counterpartCompact = counterpart.trim();
  if (!/\s/.test(compact) && !/\s/.test(counterpartCompact) && Math.max(compact.length, counterpartCompact.length) <= 96) {
    return [...compact];
  }
  return compact.split(/\s+/).filter(Boolean);
}

function pushDiffPart(parts: TextDiffPart[], kind: TextDiffPart["kind"], text: string) {
  const previous = parts.at(-1);
  if (previous?.kind === kind) {
    previous.text = joinDiffText(previous.text, text);
    return;
  }
  parts.push({ kind, text });
}

function joinDiffText(left: string, right: string): string {
  if (left.length === 1 && right.length === 1 && !/\s/.test(left + right)) return `${left}${right}`;
  return `${left} ${right}`;
}

function compactChangeText(value: string): string {
  const normalized = normalizeAuditText(value);
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 168).trim()}...`;
}

function conceptTitleFromId(id: string): string {
  return id
    .split(".")
    .filter(Boolean)
    .map((part) => part.replace(/-/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ") || id;
}

function confidenceLabel(value: string): string {
  return value.replace(/-/g, " ");
}

function guideLabel(kind: string): string {
  return kind.replace(/^guide\./, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function exampleLanguage(concept: ConceptCard): string {
  if (concept.language === "swift") return "swift";
  if (concept.language === "python") return "python";
  if (concept.language === "javascript") return "javascript";
  if (concept.language === "cpp") return "cpp";
  return "ts";
}

function languageLabel(value: string): string {
  if (value === "swift") return "Swift";
  if (value === "python") return "Python";
  if (value === "typescript") return "TypeScript";
  if (value === "javascript") return "JavaScript";
  if (value === "cpp") return "C++";
  return "Language neutral";
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function capitalize(value: string): string {
  const normalized = confidenceLabel(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
