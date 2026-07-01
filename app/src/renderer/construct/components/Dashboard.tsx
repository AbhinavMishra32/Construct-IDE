import { FolderOpen, RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { AgentSessionComposer, Button } from "@opaline/ui";
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
    <div className="construct-home-surface">
      <div className="construct-home-frame">
        <div className="construct-home-actions">
          <Button size="small" variant="ghost" onClick={onRefresh} disabled={busy} aria-label="Refresh projects">
            <RefreshCcw data-icon="inline-start" className={busy ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>

        <main className="construct-home-main">
          <div className="construct-home-stack">
            <h1 className="construct-home-title">What should we build in construct?</h1>

            <AgentSessionComposer
              aria-label="Describe the project to create"
              className="construct-flow-composer construct-home-composer"
              disabled={busy}
              footerEnd={
                <span className="construct-home-composer-count">
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
              <div className="construct-home-error">
                {createError ?? error}
              </div>
            ) : null}

            {recentProjects.length > 0 ? (
              <div className="construct-home-project-list">
                {recentProjects.map((project) => (
                  <button
                    className="construct-home-project-row"
                    key={project.id}
                    onClick={() => onOpenProject(project.id)}
                    type="button"
                  >
                    <span className="construct-home-project-icon" aria-hidden="true">
                      <FolderOpen size={20} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="construct-home-project-title">{project.title}</span>
                      <span className="construct-home-project-subtitle">{projectSubtitle(project)}</span>
                    </span>
                    <span className="construct-home-project-time">{formatLastOpened(project.lastOpenedAt)}</span>
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
