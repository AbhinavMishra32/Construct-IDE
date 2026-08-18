export const CONSTRUCT_SELECTION_CONTEXT_EVENT = "construct:selection-context";

export type ConstructSelectionSource =
  | "editor"
  | "guide"
  | "knowledge-card"
  | "knowledge-dialog"
  | "slot-panel"
  | "workspace";

export type ConstructSelectionContext = {
  id: string;
  text: string;
  source: ConstructSelectionSource;
  sourceLabel: string;
  contextText: string;
  anchor: { x: number; y: number };
  filePath?: string;
  language?: string;
  lineStart?: number;
  lineEnd?: number;
};

export function emitConstructSelectionContext(context: Omit<ConstructSelectionContext, "id">): void {
  window.dispatchEvent(new CustomEvent<ConstructSelectionContext>(CONSTRUCT_SELECTION_CONTEXT_EVENT, {
    detail: {
      ...context,
      id: `${Date.now()}:${context.source}:${context.text.slice(0, 32)}`
    }
  }));
}

export function normalizeSelectionText(value: string, maximumLength = 2_400): string {
  const normalized = value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  return normalized.length > maximumLength ? `${normalized.slice(0, maximumLength).trimEnd()}…` : normalized;
}

export function excerptLines(content: string, startLine: number, endLine: number, radius = 8): string {
  const lines = content.split("\n");
  const from = Math.max(0, startLine - 1 - radius);
  const to = Math.min(lines.length, endLine + radius);
  return lines.slice(from, to).map((line, index) => `${from + index + 1}: ${line}`).join("\n");
}

export function closestExplainableSurface(target: Element): { source: ConstructSelectionSource; label: string; element: Element } | null {
  const explicit = target.closest<HTMLElement>("[data-construct-explainable]");
  if (explicit) {
    return {
      source: normalizeSource(explicit.dataset.constructExplainable),
      label: explicit.dataset.constructExplainableLabel?.trim() || inferSurfaceLabel(explicit),
      element: explicit
    };
  }

  const slotPanel = target.closest(".opaline-slot-panel");
  if (slotPanel) return { source: "slot-panel", label: "Panel", element: slotPanel };
  return null;
}

function normalizeSource(value: string | undefined): ConstructSelectionSource {
  if (value === "guide" || value === "knowledge-card" || value === "knowledge-dialog" || value === "slot-panel" || value === "editor") return value;
  return "workspace";
}

function inferSurfaceLabel(element: Element): string {
  const heading = element.querySelector("h1, h2, h3, [role=heading]")?.textContent?.trim();
  return heading || "Workspace";
}
