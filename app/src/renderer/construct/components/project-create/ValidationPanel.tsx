import { AgentActivityList, AgentSuggestion, AgentThinking, Button } from "@opaline/ui";
import type { AgentActivityEntry } from "@opaline/ui";
import { AlertCircle, FileCode2, Sparkles } from "lucide-react";

import type { AuthoringSuggestion } from "../../compiler/semantic-review";
import type { ConstructFix, ConstructValidationResult } from "../../compiler/types";

export type ValidationStage = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "active" | "completed" | "warning" | "error";
};

export function ValidationPanel({
  result,
  stages,
  semanticSuggestions,
  authoringSuggestions,
  reviewing,
  onApplyFix,
  onRunSemanticReview,
  onRawEdit,
}: {
  result: ConstructValidationResult;
  stages: ValidationStage[];
  semanticSuggestions: ConstructFix[];
  authoringSuggestions: AuthoringSuggestion[];
  reviewing: boolean;
  onApplyFix: (fix: ConstructFix) => void;
  onRunSemanticReview: () => void;
  onRawEdit: () => void;
}) {
  const activeStage = stages.find((stage) => stage.status === "active");
  const blockingError = result.valid ? null : result.diagnostics.find((item) => item.severity === "error") ?? null;
  const warnings = result.diagnostics.filter((item) => item.severity !== "error");
  const suggestions = [...result.suggestions, ...semanticSuggestions];
  const entries: AgentActivityEntry[] = stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    detail: stage.detail,
    status: stage.status === "completed" ? "complete" : stage.status,
  }));
  const activityLabel = activeStage
    ? "Checking project tape"
    : result.valid
      ? result.appliedFixes.length > 0
        ? `Checked project tape · ${result.appliedFixes.length} safe repair${result.appliedFixes.length === 1 ? "" : "s"}`
        : "Checked project tape"
      : "Project tape needs attention";

  return (
    <div className="space-y-3">
      <AgentThinking
        state={activeStage ? "thinking" : "thought"}
        label={activityLabel}
        content={<AgentActivityList entries={entries} />}
      />

      {!activeStage ? <p className="text-xs text-muted-foreground">{result.valid ? `${result.document.spec} · ${result.document.root.children.length} top-level blocks${warnings.length > 0 ? ` · ${warnings.length} optional suggestion${warnings.length === 1 ? "" : "s"}` : ""}` : blockingError ? `Line ${blockingError.line}` : null}</p> : null}

      {blockingError ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="mt-0.5 shrink-0" size={15} />
          <div className="min-w-0 flex-1"><strong className="block text-sm font-medium">{blockingError.message}</strong><small className="mt-0.5 block text-xs opacity-80">{blockingError.details}</small></div>
          <button className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-destructive/10" type="button" onClick={onRawEdit}><FileCode2 size={13} />Edit source</button>
        </div>
      ) : null}

      {suggestions.length > 0 || authoringSuggestions.length > 0 ? (
        <section className="space-y-2 border-t pt-3">
          <header className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles size={14} /><span>Optional suggestions</span></header>
          {suggestions.map((fix) => (
            <AgentSuggestion key={fix.id} title={fix.title} description={fix.description} onAction={() => onApplyFix(fix)} />
          ))}
          {authoringSuggestions.map((suggestion) => (
            <AgentSuggestion key={suggestion.id} title={suggestion.title} description={suggestion.reason} />
          ))}
        </section>
      ) : result.valid ? (
        <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" type="button" disabled={reviewing} onClick={onRunSemanticReview}>
          <Sparkles size={13} />{reviewing ? "Reviewing teaching flow…" : "Review teaching flow"}
        </button>
      ) : null}

      {result.valid && (suggestions.length > 0 || authoringSuggestions.length > 0) ? (
        <Button variant="secondary" disabled={reviewing} onClick={onRunSemanticReview}>
          {reviewing ? "Reviewing…" : "Refresh suggestions"}
        </Button>
      ) : null}
    </div>
  );
}
