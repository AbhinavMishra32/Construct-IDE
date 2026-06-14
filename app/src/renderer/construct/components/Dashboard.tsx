import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCode2,
  Folder,
  Plus,
  Settings,
  Sparkles,
  TerminalSquare
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@opaline/ui/v2";
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
  const inProgressProjects = projects.filter((project) => project.progress > 0 && project.progress < 100);
  const mostRecent = [...projects].sort((a, b) => {
    const left = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
    const right = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
    return right - left;
  });
  const nextProject = inProgressProjects[0] ?? mostRecent[0] ?? null;
  const completedProjects = mostRecent
    .filter((project) => project.progress >= 100 || project.completedAt)
    .slice(0, 3);
  const activeCount = projects.filter((project) => project.progress > 0 && project.progress < 100).length;
  const savedConceptCount = projects.reduce((count, project) => count + (project.conceptCount ?? 0), 0);
  const verificationPassCount = projects.reduce((count, project) => count + (project.verificationPassCount ?? 0), 0);

  return (
    <div className="construct-dashboard">
      <header className="construct-dashboard__toolbar">
        <h1>Projects</h1>
        <div className="construct-dashboard__actions">
          <Button size="small" onClick={onCreateProject}>
            <Plus size={14} />
            New project
          </Button>
        </div>
      </header>

      {error ? <div className="dashboard__error">{error}</div> : null}

      <main className="construct-dashboard__grid">
        <section className="construct-dashboard__continue">
          <div className="construct-dashboard__panel-header">
            <h2>Continue now</h2>
            <button type="button" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing" : "Refresh"}</button>
          </div>
          {nextProject ? (
            <button
              className="construct-dashboard__continue-card"
              type="button"
              onClick={() => onOpenProject(nextProject.id)}
            >
              <span className="construct-dashboard__continue-icon">
                <Sparkles size={18} />
              </span>
              <span className="construct-dashboard__continue-copy">
                <strong>{nextProject.title}</strong>
                <small>{describeNextWork(nextProject)}</small>
              </span>
              <span className="construct-dashboard__continue-progress">
                <span style={{ width: `${nextProject.progress}%` }} />
              </span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <div className="construct-dashboard__empty construct-dashboard__empty--large">
              <BookOpen size={20} />
              <div>
                <strong>No local tapes yet.</strong>
                <span>Create a project from a `.construct` tape to start building.</span>
              </div>
            </div>
          )}
        </section>

        <section className="construct-dashboard__metrics" aria-label="Workspace summary">
          <Metric label="Active" value={activeCount} icon={<TerminalSquare size={15} />} />
          <Metric label="Knowledge" value={savedConceptCount} icon={<BookOpen size={15} />} />
          <Metric label="Verified" value={verificationPassCount} icon={<CheckCircle2 size={15} />} />
        </section>

        <section className="construct-dashboard__spotlight" aria-label="Project queue">
          {mostRecent.slice(0, 3).map((project) => (
            <MiniProject
              key={project.id}
              project={project}
              onOpenProject={onOpenProject}
            />
          ))}
          {mostRecent.length === 0 ? (
            <div className="construct-dashboard__empty">
              <Folder size={18} />
              <span>No recent project state yet.</span>
            </div>
          ) : null}
        </section>

        <section className="construct-dashboard__panel construct-dashboard__panel--projects">
          <div className="construct-dashboard__panel-header">
            <h2>Projects</h2>
            <span>{projects.length} local</span>
          </div>
          <div className="construct-dashboard__project-table">
            {mostRecent.map((project) => (
              <button
                className="construct-dashboard__project"
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="construct-dashboard__project-icon">
                  <Folder size={17} />
                </span>
                <span className="construct-dashboard__project-copy">
                  <strong>{project.title}</strong>
                  <small>{describeProjectRow(project)}</small>
                </span>
                <span className="construct-dashboard__progress" aria-hidden="true">
                  <span style={{ width: `${project.progress}%` }} />
                </span>
                <span className="construct-dashboard__percent">{project.progress}%</span>
                <span
                  className="construct-dashboard__project-settings"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenProjectSettings(project.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenProjectSettings(project.id);
                    }
                  }}
                  aria-label={`Open settings for ${project.title}`}
                >
                  <Settings size={15} />
                </span>
              </button>
            ))}
            {projects.length === 0 ? (
              <div className="construct-dashboard__empty">
                <Folder size={18} />
                <span>No local projects yet.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="construct-dashboard__side">
          <section className="construct-dashboard__panel">
            <div className="construct-dashboard__panel-header">
              <h2>Recently completed</h2>
              <span>{completedProjects.length ? "done" : "none yet"}</span>
            </div>
            {completedProjects.map((project) => (
              <ProjectSignal
                key={project.id}
                icon={<CheckCircle2 size={15} />}
                title={project.title}
                meta={formatDashboardSidebarTime(project.completedAt ?? project.lastOpenedAt)}
                onClick={() => onOpenProject(project.id)}
              />
            ))}
            {completedProjects.length === 0 ? (
              <div className="construct-dashboard__empty">
                <Sparkles size={18} />
                <span>Finished tapes will settle here.</span>
              </div>
            ) : null}
          </section>
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="construct-dashboard__metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniProject({
  project,
  onOpenProject
}: {
  project: ProjectSummary;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <button
      className="construct-dashboard__mini"
      type="button"
      onClick={() => onOpenProject(project.id)}
    >
      <span className="construct-dashboard__mini-icon">
        <FileCode2 size={15} />
      </span>
      <span>
        <strong>{project.currentStepTitle || project.title}</strong>
        <small>{describeNextWork(project)}</small>
      </span>
      <em>{project.progress}%</em>
    </button>
  );
}

function ProjectSignal({
  icon,
  title,
  meta,
  onClick
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button className="construct-dashboard__signal" type="button" onClick={onClick}>
      {icon}
      <span>{title}</span>
      <small>{meta}</small>
    </button>
  );
}

function describeProjectRow(project: ProjectSummary): string {
  const active = project.activeFilePath ? `Editing ${project.activeFilePath}` : project.workspacePath;
  return `${formatProjectPosition(project)} · ${active}`;
}

function describeNextWork(project: ProjectSummary): string {
  const step = project.currentStepTitle ? `Step: ${project.currentStepTitle}` : "Next tape step";
  const block = project.currentBlockKind ? `${project.currentBlockKind}${project.currentBlockLabel ? ` · ${project.currentBlockLabel}` : ""}` : null;
  return block ? `${step} — ${block}` : step;
}

function formatProjectPosition(project: ProjectSummary): string {
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
