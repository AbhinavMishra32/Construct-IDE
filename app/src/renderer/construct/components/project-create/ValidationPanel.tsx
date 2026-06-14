import { AgentActivityList, AgentSuggestion, AgentThinking, Button } from "@opaline/ui/v2";
import type { AgentActivityEntry } from "@opaline/ui/v2";
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
    <div className="construct-validation-flow">
      <AgentThinking
        className="construct-validation-flow__activity"
        state={activeStage ? "thinking" : "thought"}
        label={activityLabel}
        content={<AgentActivityList entries={entries} />}
      />

      {!activeStage ? <p className="construct-validation-flow__summary">{result.valid ? `${result.document.spec} · ${result.document.root.children.length} top-level blocks${warnings.length > 0 ? ` · ${warnings.length} optional suggestion${warnings.length === 1 ? "" : "s"}` : ""}` : blockingError ? `Line ${blockingError.line}` : null}</p> : null}

      {blockingError ? (
        <div className="construct-validation-flow__blocking">
          <AlertCircle size={15} />
          <div><strong>{blockingError.message}</strong><small>{blockingError.details}</small></div>
          <button type="button" onClick={onRawEdit}><FileCode2 size={13} />Edit source</button>
        </div>
      ) : null}

      {suggestions.length > 0 || authoringSuggestions.length > 0 ? (
        <section className="construct-validation-flow__suggestions">
          <header><Sparkles size={14} /><span>Optional suggestions</span></header>
          {suggestions.map((fix) => (
            <AgentSuggestion key={fix.id} title={fix.title} description={fix.description} onAction={() => onApplyFix(fix)} />
          ))}
          {authoringSuggestions.map((suggestion) => (
            <AgentSuggestion key={suggestion.id} title={suggestion.title} description={suggestion.reason} />
          ))}
        </section>
      ) : result.valid ? (
        <button className="construct-validation-flow__review" type="button" disabled={reviewing} onClick={onRunSemanticReview}>
          <Sparkles size={13} />{reviewing ? "Reviewing teaching flow…" : "Review teaching flow"}
        </button>
      ) : null}

      {result.valid && (suggestions.length > 0 || authoringSuggestions.length > 0) ? (
        <Button className="construct-validation-flow__review-again" variant="secondary" disabled={reviewing} onClick={onRunSemanticReview}>
          {reviewing ? "Reviewing…" : "Refresh suggestions"}
        </Button>
      ) : null}
    </div>
  );
}
