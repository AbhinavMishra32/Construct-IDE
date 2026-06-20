import { useState } from "react";
import { FilePlus, FolderOpen, GitBranch, MagicWand, ProjectorScreenChart } from "@phosphor-icons/react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  AgentActivityList,
  AgentThinking,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  Input,
  Switch,
  Textarea,
} from "@opaline/ui";
import type { AgentActivityEntry } from "@opaline/ui";

import type {
  ConstructFlowProjectSettings
} from "../../../shared/constructFlow";
import { applyConstructPatch } from "../compiler/patches";
import { validateConstructSource } from "../compiler/pipeline";
import { parseConstructDocument } from "../compiler/parser";
import type { ConstructFix, ConstructValidationResult } from "../compiler/types";
import { runSemanticAuthoringReview, type AuthoringSuggestion } from "../compiler/semantic-review";
import { createFlowProject, getSettings, openConstructFile, selectWorkspaceDirectory } from "../lib/bridge";
import { parseConstructSource } from "../lib/parser";
import { createProjectFromConstructFile } from "../lib/projectStore";
import type { AnyProjectRecord, ConstructProgram } from "../types";
import { cn } from "../../lib/utils";
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

const defaultFlowProjectSettings: ConstructFlowProjectSettings = {
  projectType: "agent",
  codebaseState: "empty",
  projectPhase: "build",
  setupScope: "standard",
  packageManager: "auto",
  testStrategy: "unit",
  docsLevel: "standard",
  gitStrategy: "initialize",
  agentEdits: "ask",
  openWorkspace: true
};

export function NewProjectDialog({ open, onOpenChange, onProjectCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: (project: AnyProjectRecord) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<SelectedConstructFile | null>(null);
  const [flowMode, setFlowMode] = useState(false);
  const [flowTitle, setFlowTitle] = useState("");
  const [flowGoal, setFlowGoal] = useState("");
  const [flowStackPreference, setFlowStackPreference] = useState("");
  const [flowResearchFirst, setFlowResearchFirst] = useState(true);
  const [flowCreationStage, setFlowCreationStage] = useState<"idle" | "memory" | "opening">("idle");
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

  async function createFlow() {
    const goal = flowGoal.trim();
    if (!goal) return;
    try {
      setBusy(true);
      setError(null);
      setFlowCreationStage("memory");
      await visualBeat(220);
      const title = flowTitle.trim() || inferFlowTitle(goal);
      const project = await createFlowProject({
        title,
        goal,
        workspacePath: workspacePath.trim() || undefined,
        stackPreference: flowStackPreference.trim() || undefined,
        researchFirst: flowResearchFirst,
        autonomyPreference: "balanced",
        permissionsPreference: defaultFlowProjectSettings.agentEdits,
        projectSettings: defaultFlowProjectSettings
      });
      setFlowCreationStage("opening");
      onProjectCreated(project);
      onOpenChange(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setFlowCreationStage("idle");
    }
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
    setFlowMode(false);
    setFlowTitle("");
    setFlowGoal("");
    setFlowStackPreference("");
    setFlowResearchFirst(true);
    setFlowCreationStage("idle");
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
    <ShadcnDialog open={open} onOpenChange={(nextOpen) => { onOpenChange(nextOpen); if (!nextOpen) reset(); }}>
      <ShadcnDialogContent
        className={cn(
          "flex flex-col overflow-hidden rounded-[10px]",
          rawEditing
            ? "h-[min(90vh,58rem)] w-[min(94vw,64rem)] max-w-none"
            : flowMode
              ? "h-[min(84vh,48rem)] w-[min(98vw,76rem)] max-w-none sm:max-w-none"
              : "max-h-[88vh] max-w-2xl"
        )}
      >
        <ShadcnDialogHeader className="shrink-0">
          <span className="mb-1 flex size-8 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"><ProjectorScreenChart size={18} weight="duotone" /></span>
          <div>
            <ShadcnDialogTitle>{selectedFile ? "Create project" : flowMode ? "New Flow project" : "New project"}</ShadcnDialogTitle>
            <ShadcnDialogDescription>{selectedFile ? "Construct checks and safely repairs the tape before opening it." : flowMode ? "Set the project intent and startup controls." : "Create a Flow workspace or import a .construct tape."}</ShadcnDialogDescription>
          </div>
        </ShadcnDialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-1 pr-1">
          {!selectedFile && !flowMode ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="cursor-pointer bg-card/70 shadow-none transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" size="sm" role="button" tabIndex={busy ? -1 : 0} onClick={() => { if (!busy) setFlowMode(true); }} onKeyDown={(event) => { if (!busy && (event.key === "Enter" || event.key === " ")) setFlowMode(true); }}>
                <CardHeader><span><MagicWand size={18} weight="duotone" /></span><CardTitle>Construct Flow</CardTitle><CardDescription>Natural coding mentor workspace with Flow Memory, tool calls, and practice tasks.</CardDescription></CardHeader>
                <CardContent><span className="text-xs font-medium text-primary">Create Flow project</span></CardContent>
              </Card>
              <Card className="cursor-pointer bg-card/70 shadow-none transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" size="sm" role="button" tabIndex={busy ? -1 : 0} onClick={() => { if (!busy) void chooseConstructFile(); }} onKeyDown={(event) => { if (!busy && (event.key === "Enter" || event.key === " ")) void chooseConstructFile(); }}>
                <CardHeader><span><FilePlus size={18} weight="duotone" /></span><CardTitle>Open .construct file</CardTitle><CardDescription>Read, repair, preview patches, and validate before opening.</CardDescription></CardHeader>
                <CardContent><span className="text-xs font-medium text-primary">Choose file</span></CardContent>
              </Card>
            </div>
          ) : flowMode ? (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.65fr)]">
              <div className="flex min-h-0 flex-col gap-4 rounded-[8px] border bg-card/70 p-4">
                <label className="flex min-w-0 flex-col gap-2">
                  <span className="text-sm font-medium">Title</span>
                  <Input
                    value={flowTitle}
                    onChange={(event) => setFlowTitle(event.target.value)}
                    placeholder={flowGoal.trim() ? inferFlowTitle(flowGoal) : "TypeScript Agent Framework"}
                  />
                </label>
                <label className="flex min-h-0 flex-1 flex-col gap-2">
                  <span className="text-sm font-medium">Project intent</span>
                  <Textarea
                    className="min-h-56 flex-1 resize-none"
                    value={flowGoal}
                    onChange={(event) => setFlowGoal(event.target.value)}
                    placeholder="I am making a TypeScript agent framework from scratch."
                  />
                </label>
              </div>
              <div className="flex min-h-0 flex-col gap-4">
                <div className="flex items-center justify-between gap-4 rounded-[8px] border bg-card/70 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">Research</h3>
                    <p className="text-xs text-muted-foreground">Let Flow research the project before the mentor starts.</p>
                  </div>
                  <Switch checked={flowResearchFirst} onCheckedChange={setFlowResearchFirst} />
                </div>
                <label className="flex min-h-0 flex-1 flex-col gap-2 rounded-[8px] border bg-card/70 p-4">
                  <span className="text-sm font-medium">Extra context</span>
                  <Textarea
                    className="min-h-52 flex-1 resize-none"
                    value={flowStackPreference}
                    onChange={(event) => setFlowStackPreference(event.target.value)}
                    placeholder="Use Next.js, keep it local-first, teach architecture before implementation, avoid a backend for now."
                  />
                </label>
              </div>
              {busy && flowCreationStage !== "idle" ? (
                <AgentThinking
                  className="lg:col-span-2"
                  state="thinking"
                  label={flowCreationLabel(flowCreationStage)}
                  content={<AgentActivityList entries={flowCreationEntries(flowCreationStage)} />}
                />
              ) : null}
            </div>
          ) : selectedFile && rawEditing ? (
            <div className="flex min-h-[420px] flex-col overflow-hidden rounded-[8px] border"><header className="flex items-start justify-between gap-4 border-b p-3"><div><strong className="block text-sm font-medium">Raw tape editor</strong><span className="text-xs text-muted-foreground">Advanced mode - edits are recompiled before the project can open.</span></div><code className="max-w-64 truncate rounded-full bg-muted px-2 py-1 font-mono text-[10px]">{selectedFile.path}</code></header><textarea className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs outline-none" spellCheck={false} value={rawSource} onChange={(event) => setRawSource(event.target.value)} /><footer className="flex justify-end gap-2 border-t p-3"><Button variant="secondary" onClick={() => setRawEditing(false)}>Cancel</Button><Button onClick={applyRawSource}>Revalidate source</Button></footer></div>
          ) : selectedFile ? (
            <>
              <div className="flex items-center gap-3 rounded-[8px] border bg-muted/25 p-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-background"><FilePlus size={16} /></span><div className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{selectedFile.program?.title ?? fileNameStem(selectedFile.path)}</strong><small className="block truncate text-xs text-muted-foreground">{selectedFile.path}</small></div><code className="rounded-full bg-background px-2 py-1 font-mono text-[10px]">{selectedFile.validation.document.spec}</code></div>
              <ValidationPanel result={selectedFile.validation} stages={stages} semanticSuggestions={semanticSuggestions} authoringSuggestions={authoringSuggestions} reviewing={reviewing} onApplyFix={applyFix} onRunSemanticReview={() => void runSemanticReview()} onRawEdit={() => setRawEditing(true)} />
              {selectedFile.validation.valid ? <Card className="bg-card/70 shadow-none" size="sm"><CardContent className="space-y-4"><label className="space-y-2"><span className="text-sm font-medium">Workspace folder</span><div className="flex gap-2"><Input className="min-w-0 flex-1" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Choose where project files will be saved" /><Button variant="secondary" type="button" onClick={() => void chooseWorkspaceDirectory()}><FolderOpen size={16} weight="duotone" />Browse</Button></div></label><label className="flex items-center gap-2 text-sm"><input className="size-4 rounded border" type="checkbox" checked={initializeGit} onChange={(event) => setInitializeGit(event.target.checked)} /><span className="flex items-center gap-2"><GitBranch size={16} weight="duotone" />Initialize a Git repository</span></label></CardContent></Card> : null}
            </>
          ) : (
            null
          )}
          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        </div>
        <ShadcnDialogFooter className="shrink-0">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {flowMode ? (
            <Button disabled={!flowGoal.trim() || busy} onClick={() => void createFlow()}>{busy ? "Creating Flow..." : "Start Flow"}</Button>
          ) : null}
          {selectedFile && !rawEditing ? <Button disabled={!selectedFile.validation.valid || !selectedFile.program || !workspacePath.trim() || busy} onClick={() => void createProject()}>{busy ? "Creating project..." : "Start project"}</Button> : null}
        </ShadcnDialogFooter>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function inferFlowTitle(goal: string): string {
  const stripped = goal
    .replace(/^i\s*(am|'m)?\s*(making|building|creating|working on)\s+/i, "")
    .replace(/^a\s+/i, "")
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean).slice(0, 7);
  return words.length ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : "Flow Project";
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

function flowCreationLabel(stage: "idle" | "memory" | "opening"): string {
  if (stage === "opening") return "Finishing Flow project";
  return "Creating Flow project";
}

function flowCreationEntries(stage: "idle" | "memory" | "opening"): AgentActivityEntry[] {
  return [
    {
      id: "memory",
      title: "Create Flow Memory",
      detail: "Ensuring research.md, project.md, path.md, and learner.md.",
      status: stage === "memory" ? "active" : "complete"
    },
    {
      id: "opening",
      title: "Finish Flow project",
      detail: "Preparing the natural mentor workspace.",
      status: stage === "opening" ? "active" : "pending"
    }
  ];
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
