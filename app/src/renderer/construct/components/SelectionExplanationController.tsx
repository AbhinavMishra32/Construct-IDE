import { AnimatePresence, motion } from "framer-motion";
import { Check, Code2, Copy, Globe2, Lightbulb, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentActivityList,
  AgentContextSources,
  AgentThinking
} from "@opaline/ui";
import type { AgentActivityEntry } from "@opaline/ui";

import { SelectionDropdown, SelectionDropdownItem } from "@/components/ui/selection-dropdown";
import type { SelectionDropdownMode } from "@/components/ui/selection-dropdown";
import { explainSelection, onSelectionExplanationLog } from "../lib/bridge";
import { currentBlock } from "../lib/runtime";
import {
  closestExplainableSurface,
  CONSTRUCT_SELECTION_CONTEXT_EVENT,
  normalizeSelectionText,
  type ConstructSelectionContext
} from "../lib/selectionContext";
import type { ProjectRecord, SelectionExplanationLogEntry, SelectionExplanationResult } from "../types";
import { MarkdownBlock } from "./MarkdownBlock";

export function SelectionExplanationController({
  project,
  theme,
  onOpenFile
}: {
  project: ProjectRecord;
  theme: "light" | "dark" | "system";
  onOpenFile?: (path: string) => void;
}) {
  const [selection, setSelection] = useState<ConstructSelectionContext | null>(null);
  const [stage, setStage] = useState<"prompt" | "working" | "result" | "error">("prompt");
  const [mode, setMode] = useState<SelectionDropdownMode>("anchored");
  const [logs, setLogs] = useState<SelectionExplanationLogEntry[]>([]);
  const [result, setResult] = useState<SelectionExplanationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const acceptSelection = useCallback((next: ConstructSelectionContext) => {
    if (!next.text) return;
    setSelection(next);
    setStage("prompt");
    setMode("anchored");
    setLogs([]);
    setResult(null);
    setError(null);
    setCopied(false);
    setActivityExpanded(true);
    requestIdRef.current = null;
  }, []);

  useEffect(() => {
    const onEditorSelection = (event: Event) => {
      acceptSelection((event as CustomEvent<ConstructSelectionContext>).detail);
    };
    window.addEventListener(CONSTRUCT_SELECTION_CONTEXT_EVENT, onEditorSelection);
    return () => window.removeEventListener(CONSTRUCT_SELECTION_CONTEXT_EVENT, onEditorSelection);
  }, [acceptSelection]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-slot=selection-dropdown], input, textarea, [contenteditable=true], .monaco-editor")) return;

      window.setTimeout(() => {
        const browserSelection = window.getSelection();
        if (!browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) return;
        const surface = closestExplainableSurface(target);
        if (!surface) return;
        const range = browserSelection.getRangeAt(0);
        const commonNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? range.commonAncestorContainer as Element
          : range.commonAncestorContainer.parentElement;
        if (!commonNode || !surface.element.contains(commonNode)) return;
        const text = normalizeSelectionText(browserSelection.toString());
        if (!text) return;
        const rect = range.getBoundingClientRect();
        const contextText = normalizeSelectionText(surface.element.textContent ?? "", 12_000);
        acceptSelection({
          id: `${Date.now()}:${surface.source}:${text.slice(0, 32)}`,
          text,
          source: surface.source,
          sourceLabel: surface.label,
          contextText,
          anchor: { x: rect.left, y: rect.bottom }
        });
      });
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [acceptSelection]);

  useEffect(() => {
    return onSelectionExplanationLog((event) => {
      if (!requestIdRef.current || event.requestId !== requestIdRef.current) return;
      setLogs((current) => [...current, event.entry]);
    });
  }, []);

  useEffect(() => {
    setSelection(null);
    requestIdRef.current = null;
  }, [project.id]);

  const activityEntries = useMemo<AgentActivityEntry[]>(() => {
    const sourceLogs = logs.length > 0 ? logs : stage === "working" ? [{
      at: new Date().toISOString(),
      status: "running" as const,
      message: "Starting the explanation agent",
      detail: "Preparing project and selection context",
      tool: "agent" as const
    }] : [];
    return sourceLogs.map((entry, index) => ({
      id: `${entry.at}:${index}`,
      title: entry.message,
      detail: entry.detail,
      status: logStatus(entry.status),
      icon: entry.tool === "web" ? <Globe2 size={12} /> : entry.tool === "codebase" ? <Code2 size={12} /> : <Sparkles size={12} />
    }));
  }, [logs, stage]);

  const dismiss = useCallback(() => {
    setSelection(null);
    requestIdRef.current = null;
  }, []);

  async function startExplanation() {
    if (!selection) return;
    const nextRequestId = crypto.randomUUID();
    requestIdRef.current = nextRequestId;
    setStage("working");
    setLogs([]);
    setResult(null);
    setError(null);
    setActivityExpanded(true);
    try {
      const explanation = await explainSelection({
        requestId: nextRequestId,
        projectId: project.id,
        selection,
        learningContext: learningContextFor(project)
      });
      setResult(explanation);
      setStage("result");
      setActivityExpanded(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("error");
      setActivityExpanded(true);
    }
  }

  async function copySelection() {
    if (!selection) return;
    await navigator.clipboard.writeText(selection.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const webSources = result?.sources.filter((source): source is typeof source & { url: string } => source.kind === "web" && Boolean(source.url)) ?? [];
  const codeSources = result?.sources.filter((source) => source.kind === "code" && source.path) ?? [];

  return (
    <SelectionDropdown
      open={selection != null}
      anchor={selection?.anchor}
      mode={mode}
      expanded={stage !== "prompt"}
      eyebrow={stage === "prompt" ? undefined : selection?.sourceLabel}
      title={stage === "prompt" ? undefined : result?.title ?? selection?.text}
      onDismiss={dismiss}
      onModeChange={setMode}
    >
      {selection && stage === "prompt" ? (
        <div className="flex min-w-full flex-col gap-0.5">
          <SelectionDropdownItem
            icon={<Lightbulb size={14} />}
            label="Explain"
            onClick={() => void startExplanation()}
          />
          <SelectionDropdownItem
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            label={copied ? "Copied" : "Copy selection"}
            onClick={() => void copySelection()}
          />
        </div>
      ) : null}

      {selection && stage !== "prompt" ? (
        <div className="space-y-3">
          <AgentThinking
            state={stage === "working" ? "thinking" : "thought"}
            label={stage === "working" ? "Researching this in context" : "Research trail"}
            expanded={activityExpanded}
            onExpandedChange={setActivityExpanded}
            content={<AgentActivityList entries={activityEntries} />}
          />

          <AnimatePresence mode="wait">
            {stage === "result" && result ? (
              <motion.div
                className="space-y-3"
                key="result"
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <MarkdownBlock content={result.explanation} theme={theme} />
                <AgentContextSources
                  sources={webSources.map((source) => ({ id: source.id, title: source.title, url: source.url, domain: source.domain }))}
                />
                {codeSources.length > 0 ? (
                  <section className="border-t pt-3">
                    <small className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">In this project</small>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {codeSources.map((source) => (
                        <button className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted" key={source.id} type="button" onClick={() => source.path && onOpenFile?.(source.path)}>
                          <Code2 size={12} />
                          <span>{source.title}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </motion.div>
            ) : null}
            {stage === "error" ? (
              <motion.div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <strong className="font-medium">Couldn't explain this yet</strong>
                <p className="mt-1 text-xs opacity-80">{error}</p>
                <button className="mt-2 rounded-md border border-destructive/30 px-2 py-1 text-xs hover:bg-destructive/10" type="button" onClick={() => void startExplanation()}>Try again</button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </SelectionDropdown>
  );
}

function logStatus(status: SelectionExplanationLogEntry["status"]): AgentActivityEntry["status"] {
  if (status === "done") return "complete";
  if (status === "running") return "active";
  if (status === "failed") return "error";
  if (status === "warning") return "warning";
  return "pending";
}

function learningContextFor(project: ProjectRecord) {
  const step = project.program.steps[project.currentStepIndex];
  const block = currentBlock(project);
  const conceptIds = block && "concepts" in block && Array.isArray(block.concepts) ? block.concepts : [];
  return {
    projectTitle: project.title,
    stepTitle: step?.title,
    blockKind: block?.kind,
    blockText: blockText(block),
    concepts: conceptIds
      .map((conceptId) => project.program.concepts.find((concept) => concept.id === conceptId))
      .filter(Boolean)
      .map((concept) => ({ id: concept!.id, title: concept!.title, summary: concept!.summary }))
  };
}

function blockText(block: ReturnType<typeof currentBlock>): string {
  if (!block) return "";
  if (block.kind === "explain" || block.kind === "checkpoint" || block.kind === "expect") return block.content.slice(0, 4_000);
  if (block.kind === "recall") return `${block.task}\n\n${block.support}`.slice(0, 4_000);
  if (block.kind === "interact") return `${block.prompt}\n\n${block.resources.concepts.join(" ")}`.slice(0, 4_000);
  if (block.kind === "edit") return `${block.path}\n${block.notes.map((note) => note.content).join("\n")}`.slice(0, 4_000);
  if (block.kind === "guide") return `${block.content}\n${block.sections.map((section) => section.content).join("\n")}`.slice(0, 4_000);
  return block.kind === "run" ? `${block.cwd}\n${block.command}`.slice(0, 4_000) : "";
}
