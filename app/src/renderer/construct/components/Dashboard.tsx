import { FolderOpen, RefreshCcw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { AgentSessionComposer, Badge, Button } from "@opaline/ui";
import { formatLastOpened } from "../lib/projectStore";
import type { ProjectSummary } from "../types";

export function Dashboard({
  projects,
  busy,
  error,
  onRefresh,
  onCreateProjectFromPrompt,
  onOpenProject
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreateProjectFromPrompt: (prompt: string) => Promise<void>;
  onOpenProject: (projectId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const recentProjects = useMemo(() => [...projects].sort(compareProjectActivity).slice(0, 3), [projects]);

  async function submitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || creating) return;
    try {
      setCreating(true);
      setCreateError(null);
      await onCreateProjectFromPrompt(trimmed);
      setPrompt("");
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col px-6 py-6">
        <div className="flex items-center justify-end">
          <Button size="small" variant="ghost" onClick={onRefresh} disabled={busy} aria-label="Refresh projects">
            <RefreshCcw data-icon="inline-start" className={busy ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>

        <main className="flex flex-1 flex-col items-center justify-center gap-7 pb-[8vh] pt-8">
          <div className="flex w-full max-w-[920px] flex-col items-center gap-6">
            <h1 className="text-center text-[28px] font-semibold leading-tight sm:text-[34px]">
              What should we build in Construct?
            </h1>

            <AgentSessionComposer
              aria-label="Describe the project to create"
              className="max-w-[860px]"
              disabled={busy}
              footerStart={
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">
                    <Sparkles data-icon="inline-start" />
                    Flow project
                  </Badge>
                  <Badge variant="outline">Research first</Badge>
                </div>
              }
              footerEnd={
                <span className="truncate px-1 text-xs text-muted-foreground">
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                </span>
              }
              onSubmit={() => void submitPrompt()}
              onValueChange={setPrompt}
              pending={creating}
              placeholder="Build a local-first drawing app that teaches canvas architecture as we go..."
              submitLabel="Create Flow project"
              value={prompt}
            />

            {createError || error ? (
              <div className="w-full max-w-[860px] rounded-[8px] border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError ?? error}
              </div>
            ) : null}

            {recentProjects.length > 0 ? (
              <div className="w-full max-w-[860px] overflow-hidden rounded-[8px] border">
                {recentProjects.map((project) => (
                  <button
                    className="grid min-h-11 w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" className="text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{project.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{projectSubtitle(project)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatLastOpened(project.lastOpenedAt)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function compareProjectActivity(left: ProjectSummary, right: ProjectSummary): number {
  return projectActivityTime(right) - projectActivityTime(left);
}

function projectActivityTime(project: ProjectSummary): number {
  const timestamp = Date.parse(project.lastOpenedAt ?? project.flowLastActivityAt ?? project.completedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function projectSubtitle(project: ProjectSummary): string {
  const kind = project.kind === "flow" ? "Flow" : "Tape";
  const concepts = project.learnedConcepts?.length ?? project.conceptCount ?? 0;
  return `${kind} · ${concepts} Concept${concepts === 1 ? "" : "s"}`;
}
