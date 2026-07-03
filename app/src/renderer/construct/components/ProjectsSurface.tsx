import { BookOpenIcon, ChevronRightIcon, FolderOpenIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@opaline/ui";
import { conceptMasteryRubricForLevel } from "../../../shared/constructLearning";
import { formatLastOpened } from "../lib/projectStore";
import type { ProjectLearnedConceptSummary, ProjectSummary } from "../types";
import { cn } from "../../lib/utils";

export function ProjectsSurface({
  projects,
  onOpenProject,
  onOpenProjectSettings
}: {
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)),
    [projects]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sortedProjects;
    return sortedProjects.filter((project) =>
      [project.title, project.description, project.flowGoal, ...(project.learnedConcepts ?? []).map((c) => c.title)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [query, sortedProjects]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[960px] flex-col px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Projects</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {projects.length} project{projects.length === 1 ? "" : "s"} · {totalConcepts(projects)} concepts learned
            </p>
          </div>
          <div className="relative">
            <SearchIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-8 rounded-md border bg-muted/30 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
              placeholder="Search projects..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <FolderOpenIcon size={32} strokeWidth={1.5} />
            <p className="text-sm">{query ? "No projects match your search." : "No projects yet."}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((project) => {
              const isExpanded = expandedId === project.id;
              const concepts = project.learnedConcepts ?? [];
              const conceptCount = concepts.length || project.conceptCount || 0;
              const kind = project.kind === "flow" ? "Construct" : "Legacy tape";

              return (
                <div
                  key={project.id}
                  className={cn(
                    "rounded-lg border bg-background transition-colors",
                    isExpanded && "ring-1 ring-ring/30"
                  )}
                >
                  {/* Row header */}
                  <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="grid size-5 shrink-0 place-items-center text-muted-foreground"
                      onClick={() => setExpandedId(isExpanded ? null : project.id)}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      <ChevronRightIcon
                        size={14}
                        className={cn("transition-transform", isExpanded && "rotate-90")}
                      />
                    </button>

                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onOpenProject(project.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{project.title}</span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {kind}
                        </span>
                      </div>
                      {project.description || project.flowGoal ? (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {project.description || project.flowGoal}
                        </div>
                      ) : null}
                    </button>

                    <div className="flex shrink-0 items-center gap-3">
                      {conceptCount > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <BookOpenIcon size={12} />
                          {conceptCount}
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {formatLastOpened(project.lastOpenedAt ?? project.flowLastActivityAt ?? project.completedAt ?? null)}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded ? (
                    <div className="border-t px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <BookOpenIcon size={12} />
                          Concepts learned ({conceptCount})
                        </h3>
                        <Button size="small" variant="ghost" onClick={() => onOpenProjectSettings(project.id)}>
                          Project settings
                        </Button>
                      </div>

                      {concepts.length > 0 ? (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {concepts.map((concept) => (
                            <ProjectConceptPill key={concept.id} concept={concept} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/70">
                          {conceptCount > 0 ? `${conceptCount} concepts (details not loaded)` : "No concepts learned yet."}
                        </p>
                      )}

                      {/* Stats row */}
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
                        {project.fileCount != null ? <span>{project.fileCount} files</span> : null}
                        {project.stepCount != null ? <span>{project.stepCount} steps</span> : null}
                        {project.flowSessionCount != null ? <span>{project.flowSessionCount} sessions</span> : null}
                        {project.progress != null && project.progress > 0 ? <span>{Math.round(project.progress * 100)}% progress</span> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectConceptPill({ concept }: { concept: ProjectLearnedConceptSummary }) {
  const rubric = conceptMasteryRubricForLevel(concept.masteryLevel);
  const level = concept.masteryLevel ?? 0;
  const barColor =
    level >= 4 ? "bg-emerald-500" :
    level >= 3 ? "bg-sky-500" :
    level >= 2 ? "bg-amber-400" :
    "bg-muted-foreground/40";

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/35 px-2.5 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{concept.title}</div>
        <div className="mt-0.5 truncate text-muted-foreground">{rubric.title}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1" aria-label={`Mastery: ${rubric.title}`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn("h-1 w-2.5 rounded-full", i < level ? barColor : "bg-muted-foreground/15")}
          />
        ))}
      </div>
    </div>
  );
}

function activityTime(project: ProjectSummary): number {
  const timestamp = Date.parse(project.lastOpenedAt ?? project.flowLastActivityAt ?? project.completedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function totalConcepts(projects: ProjectSummary[]): number {
  return projects.reduce((sum, project) => sum + (project.learnedConcepts?.length ?? project.conceptCount ?? 0), 0);
}
