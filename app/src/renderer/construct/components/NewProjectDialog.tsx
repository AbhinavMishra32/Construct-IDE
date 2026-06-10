import { useState } from "react";
import { FilePlus, FolderOpen, GitBranch, MagicWand, ProjectorScreenChart } from "@phosphor-icons/react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogSection } from "@opaline/ui";

import { applyConstructPatch } from "../compiler/patches";
import { validateConstructSource } from "../compiler/pipeline";
import { parseConstructDocument } from "../compiler/parser";
import type { ConstructFix, ConstructValidationResult } from "../compiler/types";
import { runSemanticAuthoringReview, type AuthoringSuggestion } from "../compiler/semantic-review";
import { getSettings, openConstructFile, selectWorkspaceDirectory } from "../lib/bridge";
import { parseConstructSource } from "../lib/parser";
import { createProjectFromConstructFile } from "../lib/projectStore";
import type { ConstructProgram, ProjectRecord } from "../types";
import { ValidationPanel, type ValidationStage } from "./project-create/ValidationPanel";

type SelectedConstructFile = {
  path: string;
  originalSource: string;
  source: string;
  program: ConstructProgram | null;
  validation: ConstructValidationResult;
};

const initialStages: ValidationStage[] = [
  { id: "read", title: "Reading project tape", detail: "Waiting for a .construct source file.", status: "pending" },
  { id: "tree", title: "Building block tree", detail: "Fence-aware lexer and tolerant parser.", status: "pending" },
  { id: "grammar", title: "Checking grammar", detail: "Canonical rules for the declared tape spec.", status: "pending" },
  { id: "repair", title: "Applying safe repairs", detail: "Only deterministic source transforms are automatic.", status: "pending" },
  { id: "suggest", title: "Preparing suggestions", detail: "Ambiguous patches remain user-selectable.", status: "pending" },
  { id: "final", title: "Final validation", detail: "The runtime parser is the final project gate.", status: "pending" }
];

export function NewProjectDialog({ open, onOpenChange, onProjectCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: (project: ProjectRecord) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<SelectedConstructFile | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [initializeGit, setInitializeGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState(initialStages);
  const [semanticSuggestions, setSemanticSuggestions] = useState<ConstructFix[]>([]);
  const [authoringSuggestions, setAuthoringSuggestions] = useState<AuthoringSuggestion[]>([]);
  const [rawEditing, setRawEditing] = useState(false);
  const [rawSource, setRawSource] = useState("");

  async function chooseConstructFile() {
    try {
      setBusy(true);
      setError(null);
      const file = await openConstructFile();
      if (!file) return;
      const preliminaryDocument = parseConstructDocument(file.source);
      const preliminaryValidation: ConstructValidationResult = {
        originalSource: file.source,
        source: file.source,
        document: preliminaryDocument,
        diagnostics: preliminaryDocument.diagnostics,
        appliedFixes: [],
        suggestions: [],
        valid: false
      };
      setSelectedFile({ path: file.path, originalSource: file.source, source: file.source, program: null, validation: preliminaryValidation });
      setRawSource(file.source);
      setStages(updateStage(updateStage(initialStages, "read", "completed", `${preliminaryDocument.tokens.length} lexical tokens found.`), "tree", "active", "Recovering nested blocks and source ranges."));
      await visualBeat();
      setStages((current) => updateStage(updateStage(current, "tree", "completed", `${preliminaryDocument.root.children.length} top-level blocks recovered.`), "grammar", "active", `Checking ${preliminaryDocument.spec} placement rules.`));
      await visualBeat();
      setStages((current) => updateStage(updateStage(current, "grammar", "completed", "Canonical parent and child rules checked."), "repair", "active", "Applying deterministic transforms and reparsing after each edit."));
      await visualBeat();
      const validation = validateConstructSource(file.source);
      const program = validation.valid ? parseConstructSource(validation.source) : null;
      setStages(finalizeStages(validation));
      setSelectedFile({ path: file.path, originalSource: file.source, source: validation.source, program, validation });
      setRawSource(validation.source);
      setSemanticSuggestions([]);
      setAuthoringSuggestions([]);
      const settings = await getSettings().catch(() => null);
      setWorkspacePath(suggestWorkspacePath(file.path, program?.id ?? fileNameStem(file.path), settings?.workspaceRoot));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStages((current) => updateStage(current, "final", "error", "Validation stopped before a valid runtime project could be produced."));
    } finally {
      setBusy(false);
    }
  }

  async function chooseWorkspaceDirectory() {
    const directory = await selectWorkspaceDirectory({ defaultPath: workspacePath || undefined });
    if (directory) setWorkspacePath(directory);
  }

  function applyFix(fix: ConstructFix) {
    if (!selectedFile) return;
    const source = applyConstructPatch(selectedFile.source, fix.patch);
    updateValidationSource(source, selectedFile.originalSource, selectedFile.path, [fix]);
  }

  function applyRawSource() {
    if (!selectedFile) return;
    updateValidationSource(rawSource, selectedFile.originalSource, selectedFile.path);
    setRawEditing(false);
  }

  function updateValidationSource(source: string, originalSource: string, path: string, manuallyApplied: ConstructFix[] = []) {
    const validation = validateConstructSource(source);
    validation.appliedFixes = [
      ...(selectedFile?.validation.appliedFixes ?? []),
      ...manuallyApplied.map((fix) => ({ ...fix, appliedAt: new Date().toISOString() })),
      ...validation.appliedFixes
    ];
    const program = validation.valid ? parseConstructSource(validation.source) : null;
    setSelectedFile({ path, originalSource, source: validation.source, program, validation });
    setRawSource(validation.source);
    setStages(finalizeStages(validation));
  }

  async function runSemanticReview() {
    if (!selectedFile?.program) return;
    setReviewing(true);
    setStages((current) => updateStage(current, "suggest", "active", "Reviewing compact project structure and relevant authoring signals."));
    await visualBeat(260);
    const suggestions = createLocalTeachingSuggestions(selectedFile.program, selectedFile.source);
    setSemanticSuggestions(suggestions);
    try {
      const agentSuggestions = await runSemanticAuthoringReview(selectedFile.program, selectedFile.source, selectedFile.validation.diagnostics);
      setAuthoringSuggestions(agentSuggestions);
      const count = suggestions.length + agentSuggestions.length;
      setStages((current) => updateStage(current, "suggest", count > 0 ? "warning" : "completed", count > 0 ? `${count} optional teaching suggestion${count === 1 ? "" : "s"} prepared.` : "No focused teaching issues found."));
    } catch (caught) {
      setAuthoringSuggestions([]);
      setStages((current) => updateStage(current, "suggest", suggestions.length > 0 ? "warning" : "completed", suggestions.length > 0 ? `${suggestions.length} local teaching patch${suggestions.length === 1 ? "" : "es"} prepared. Agent review was unavailable.` : `Agent review unavailable: ${caught instanceof Error ? caught.message : String(caught)}`));
    }
    setReviewing(false);
  }

  async function createProject() {
    if (!selectedFile?.program || !selectedFile.validation.valid || !workspacePath.trim()) return;
    try {
      setBusy(true);
      setError(null);
      const project = await createProjectFromConstructFile({
        initializeGit,
        originalSource: selectedFile.originalSource,
        appliedFixes: selectedFile.validation.appliedFixes,
        source: selectedFile.source,
        sourcePath: selectedFile.path,
        workspacePath: workspacePath.trim()
      });
      onProjectCreated(project);
      onOpenChange(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSelectedFile(null);
    setWorkspacePath("");
    setInitializeGit(true);
    setError(null);
    setStages(initialStages);
    setSemanticSuggestions([]);
    setAuthoringSuggestions([]);
    setRawEditing(false);
    setRawSource("");
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { onOpenChange(nextOpen); if (!nextOpen) reset(); }}>
      <DialogContent size={rawEditing ? "wide" : selectedFile ? "default" : "wide"} contentClassName={selectedFile ? "new-project-validation-dialog" : ""}>
        <DialogHeader icon={<ProjectorScreenChart size={20} weight="duotone" />} title={selectedFile ? "Create project" : "New project"} subtitle={selectedFile ? "Construct checks and safely repairs the tape before opening it." : "Import a .construct file, repair it safely, then materialize a real local workspace."} />
        <DialogBody className="new-project-dialog">
          {!selectedFile ? (
            <DialogSection className="new-project-dialog__choices">
              <button className="new-project-choice is-disabled" type="button" disabled><span><MagicWand size={20} weight="duotone" /></span><strong>Agent project</strong><small>Generate a tape, then run the same compiler validation flow.</small></button>
              <button className="new-project-choice" type="button" disabled={busy} onClick={() => void chooseConstructFile()}><span><FilePlus size={20} weight="duotone" /></span><strong>Open .construct file</strong><small>Read, repair, preview patches, and validate before opening.</small></button>
            </DialogSection>
          ) : rawEditing ? (
            <div className="construct-raw-editor"><header><div><strong>Raw tape editor</strong><span>Advanced mode · edits are recompiled before the project can open.</span></div><code>{selectedFile.path}</code></header><textarea spellCheck={false} value={rawSource} onChange={(event) => setRawSource(event.target.value)} /><footer><Button variant="secondary" onClick={() => setRawEditing(false)}>Cancel</Button><Button onClick={applyRawSource}>Revalidate source</Button></footer></div>
          ) : (
            <>
              <div className="new-project-validation-file"><span><FilePlus size={16} /></span><div><strong>{selectedFile.program?.title ?? fileNameStem(selectedFile.path)}</strong><small>{selectedFile.path}</small></div><code>{selectedFile.validation.document.spec}</code></div>
              <ValidationPanel result={selectedFile.validation} stages={stages} semanticSuggestions={semanticSuggestions} authoringSuggestions={authoringSuggestions} reviewing={reviewing} onApplyFix={applyFix} onRunSemanticReview={() => void runSemanticReview()} onRawEdit={() => setRawEditing(true)} />
              {selectedFile.validation.valid ? <DialogSection className="new-project-dialog__settings new-project-dialog__settings--compact"><label className="construct-field"><span>Workspace folder</span><div className="construct-path-input"><input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Choose where project files will be saved" /><button type="button" onClick={() => void chooseWorkspaceDirectory()}><FolderOpen size={16} weight="duotone" />Browse</button></div></label><label className="construct-checkbox"><input type="checkbox" checked={initializeGit} onChange={(event) => setInitializeGit(event.target.checked)} /><span><GitBranch size={16} weight="duotone" />Initialize a Git repository</span></label></DialogSection> : null}
            </>
          )}
          {error ? <div className="construct-dialog-error">{error}</div> : null}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>{selectedFile && !rawEditing ? <Button disabled={!selectedFile.validation.valid || !selectedFile.program || !workspacePath.trim() || busy} onClick={() => void createProject()}>{busy ? "Creating project…" : "Start project"}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function finalizeStages(result: ConstructValidationResult): ValidationStage[] {
  const errorCount = result.diagnostics.filter((item) => item.severity === "error").length;
  return [
    { id: "read", title: "Reading project tape", detail: `${result.document.tokens.length} lexical tokens found.`, status: "completed" },
    { id: "tree", title: "Building block tree", detail: `${result.document.root.children.length} top-level blocks recovered.`, status: "completed" },
    { id: "grammar", title: "Checking grammar", detail: errorCount > 0 ? `${errorCount} structural error${errorCount === 1 ? "" : "s"} remain.` : `${result.document.spec} grammar accepted.`, status: errorCount > 0 ? "error" : "completed" },
    { id: "repair", title: "Applying safe repairs", detail: result.appliedFixes.length > 0 ? `${result.appliedFixes.length} deterministic repair${result.appliedFixes.length === 1 ? "" : "s"} applied.` : "No automatic changes needed.", status: "completed" },
    { id: "suggest", title: "Preparing suggestions", detail: result.suggestions.length > 0 ? `${result.suggestions.length} patch${result.suggestions.length === 1 ? "" : "es"} need review.` : "No ambiguous compiler patches remain.", status: result.suggestions.length > 0 ? "warning" : "completed" },
    { id: "final", title: "Final validation", detail: result.valid ? "Runtime parser accepted the repaired tape." : "Resolve compiler errors or edit the source manually.", status: result.valid ? "completed" : "error" }
  ];
}

function updateStage(stages: ValidationStage[], id: string, status: ValidationStage["status"], detail: string): ValidationStage[] {
  return stages.map((stage) => stage.id === id ? { ...stage, status, detail } : stage);
}

function createLocalTeachingSuggestions(program: ConstructProgram, source: string): ConstructFix[] {
  const suggestions: ConstructFix[] = [];
  for (const step of program.steps) {
    for (const block of step.blocks) {
      if (block.kind === "recall" && !block.support.trim() && block.supportSections.length === 0) {
        const marker = `::recall id="${block.id}"`;
        const start = source.indexOf(marker);
        if (start >= 0) {
          const insertion = source.indexOf("\n", start) + 1;
          suggestions.push({ id: `semantic:support:${block.id}`, title: `Add support scaffold to ${block.id}`, description: "This recall has no support. Insert an empty tape-0.3 support structure for the author to complete.", safety: "semantic", kind: "add-missing-support", patch: { edits: [{ start: insertion, end: insertion, text: "::support\n\n::intent\nDescribe the engineering intent.\n::end\n\n::mental-model\nExplain the governing mental model.\n::end\n\n::end\n\n" }] } });
        }
      }
    }
  }
  return suggestions;
}

function suggestWorkspacePath(sourcePath: string, projectId: string, workspaceRoot?: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  if (workspaceRoot && normalized.includes("/app/src/")) return `${workspaceRoot.replace(/\/+$/, "")}/${projectId}`;
  const lastSlash = normalized.lastIndexOf("/");
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
  return directory ? `${directory}/${projectId}` : projectId;
}

function fileNameStem(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop()?.replace(/\.construct$/i, "") || "construct-project";
}

function visualBeat(ms = 140): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
