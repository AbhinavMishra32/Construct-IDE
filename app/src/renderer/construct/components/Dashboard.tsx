import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCode2,
  Folder,
  Plus,
  RotateCcw,
  Settings,
  TerminalSquare
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@opaline/ui";
import type { ProjectSummary } from "../types";

export function Dashboard({
  projects,
  busy,
  error,
  onRefresh,
  onCreateProject,
  onOpenProject,
  onOpenProjectSettings
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreateProject: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
}) {
  const mostRecent = [...projects].sort((a, b) => {
    const left = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
    const right = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
    return right - left;
  });
  const nextProject = mostRecent.find((project) => project.progress > 0 && project.progress < 100) ?? mostRecent[0] ?? null;
  const completedProjects = mostRecent
    .filter((project) => project.progress >= 100 || project.completedAt)
    .slice(0, 3);
  const activeCount = projects.filter((project) => project.progress > 0 && project.progress < 100).length;
  const savedConceptCount = projects.reduce((count, project) => count + (project.conceptCount ?? 0), 0);
  const verificationPassCount = projects.reduce((count, project) => count + (project.verificationPassCount ?? 0), 0);

  return (
    <div className="h-full overflow-auto bg-background px-8 py-7 text-foreground">
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">Projects</h1>
            <p className="text-[13px] text-muted-foreground">{projects.length} local project{projects.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" variant="ghost" onClick={onRefresh} disabled={busy}>
              <RotateCcw size={14} className={busy ? "animate-spin" : undefined} />
              Refresh
            </Button>
            <Button size="small" onClick={onCreateProject}>
              <Plus size={14} />
              New project
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <main className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Continue</CardTitle>
                <CardDescription>{nextProject ? formatProjectPosition(nextProject) : "No active project"}</CardDescription>
              </CardHeader>
              <CardContent>
                {nextProject ? (
                  <button
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
                    type="button"
                    onClick={() => onOpenProject(nextProject.id)}
                  >
                    <IconTile><BookOpen size={18} /></IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{nextProject.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{describeNextWork(nextProject)}</span>
                    </span>
                    <Progress value={nextProject.progress} />
                    <ArrowRight size={16} className="text-muted-foreground" />
                  </button>
                ) : (
                  <EmptyState icon={<BookOpen size={18} />} title="No local projects yet" description="Create a Flow project or import a .construct tape to start building." />
                )}
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Active" value={activeCount} icon={<TerminalSquare size={15} />} />
              <Metric label="Knowledge" value={savedConceptCount} icon={<BookOpen size={15} />} />
              <Metric label="Verified" value={verificationPassCount} icon={<CheckCircle2 size={15} />} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
                <CardDescription>Recent local project state</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {mostRecent.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    onOpen={() => onOpenProject(project.id)}
                    onSettings={() => onOpenProjectSettings(project.id)}
                  />
                ))}
                {projects.length === 0 ? (
                  <EmptyState icon={<Folder size={18} />} title="No projects" description="Open or create a local project to see it here." />
                ) : null}
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Up next</CardTitle>
                <CardDescription>{mostRecent.length ? "Recent project queue" : "Nothing queued"}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {mostRecent.slice(0, 3).map((project) => (
                  <MiniProject key={project.id} project={project} onOpen={() => onOpenProject(project.id)} />
                ))}
                {mostRecent.length === 0 ? (
                  <EmptyState icon={<Folder size={18} />} title="No recent project state" description="Projects will appear here after opening a tape." />
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Completed</CardTitle>
                <CardDescription>{completedProjects.length ? "Recently finished" : "None yet"}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {completedProjects.map((project) => (
                  <MiniProject
                    key={project.id}
                    icon={<CheckCircle2 size={15} />}
                    project={project}
                    meta={formatDashboardSidebarTime(project.completedAt ?? project.lastOpenedAt)}
                    onOpen={() => onOpenProject(project.id)}
                  />
                ))}
                {completedProjects.length === 0 ? (
                  <EmptyState icon={<CheckCircle2 size={18} />} title="No completed projects" description="Finished projects will settle here." />
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </main>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <IconTile compact>{icon}</IconTile>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
        <strong className="text-lg font-semibold tabular-nums">{value}</strong>
      </CardContent>
    </Card>
  );
}

function ProjectRow({
  project,
  onOpen,
  onSettings
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" type="button" onClick={onOpen}>
        <IconTile><Folder size={17} /></IconTile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{project.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{describeProjectRow(project)}</span>
        </span>
        <Badge variant="secondary">{project.kind === "flow" ? "Flow" : project.progress >= 100 || project.completedAt ? "Done" : `${project.progress}%`}</Badge>
      </button>
      <button
        className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        type="button"
        onClick={onSettings}
        aria-label={`Open settings for ${project.title}`}
      >
        <Settings size={15} />
      </button>
    </div>
  );
}

function MiniProject({
  icon = <FileCode2 size={15} />,
  meta,
  project,
  onOpen
}: {
  icon?: ReactNode;
  meta?: string;
  project: ProjectSummary;
  onOpen: () => void;
}) {
  return (
    <button className="flex min-w-0 items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted" type="button" onClick={onOpen}>
      <IconTile compact>{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{project.currentStepTitle || project.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta ?? describeNextWork(project)}</span>
      </span>
    </button>
  );
}

function EmptyState({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
      <IconTile compact>{icon}</IconTile>
      <span className="min-w-0">
        <strong className="block text-foreground">{title}</strong>
        <span className="block">{description}</span>
      </span>
    </div>
  );
}

function IconTile({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <span className={compact ? "grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" : "grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"}>
      {children}
    </span>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
      <span className="block h-full rounded-full bg-muted-foreground/55" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function describeProjectRow(project: ProjectSummary): string {
  const active = project.activeFilePath ? `Editing ${project.activeFilePath}` : project.workspacePath;
  return `${formatProjectPosition(project)} · ${active}`;
}

function describeNextWork(project: ProjectSummary): string {
  if (project.kind === "flow") {
    return project.flowGoal ? `Flow: ${project.flowGoal}` : "Flow workspace";
  }
  const step = project.currentStepTitle ? `Step: ${project.currentStepTitle}` : "Next tape step";
  const block = project.currentBlockKind ? `${project.currentBlockKind}${project.currentBlockLabel ? ` · ${project.currentBlockLabel}` : ""}` : null;
  return block ? `${step} — ${block}` : step;
}

function formatProjectPosition(project: ProjectSummary): string {
  if (project.kind === "flow") {
    return `${project.flowSessionCount ?? 0} Flow session${(project.flowSessionCount ?? 0) === 1 ? "" : "s"}`;
  }
  const step = typeof project.currentStepIndex === "number" && project.stepCount
    ? `step ${project.currentStepIndex + 1}/${project.stepCount}`
    : "step ready";
  const blocks = typeof project.completedBlockCount === "number" && typeof project.blockCount === "number"
    ? `${project.completedBlockCount}/${project.blockCount} blocks`
    : `${project.progress}%`;
  return `${step} · ${blocks}`;
}

function formatDashboardSidebarTime(value: string | null | undefined) {
  if (!value) {
    return "Recently opened";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Recently opened";
  }

  const diffMs = Date.now() - timestamp;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    return "Just now";
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
