import {
  ArrowClockwise,
  Folder,
  GearSix,
  GitBranch,
  Plus,
  TerminalWindow
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@opaline/ui";
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
  const activeProjects = projects.filter((project) => project.progress > 0 && project.progress < 100);
  const completedProjects = projects.filter((project) => project.progress >= 100);
  const mostRecent = [...projects].sort((a, b) => {
    const left = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
    const right = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
    return right - left;
  });

  return (
    <div className="construct-dashboard">
      <header className="construct-dashboard__topbar">
        <div>
          <p className="construct-dashboard__eyebrow">Local workspace</p>
          <h1>Projects</h1>
        </div>
        <div className="construct-dashboard__actions">
          <Button variant="secondary" size="small" onClick={onRefresh} disabled={busy}>
            <ArrowClockwise size={14} className={busy ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="small" onClick={onCreateProject}>
            <Plus size={14} weight="bold" />
            New project
          </Button>
        </div>
      </header>

      {error ? <div className="dashboard__error">{error}</div> : null}

      <section className="construct-dashboard__metrics" aria-label="Project status">
        <Metric icon={<Folder size={18} weight="duotone" />} label="Projects" value={projects.length} />
        <Metric icon={<GearSix size={18} weight="duotone" />} label="In progress" value={activeProjects.length} />
        <Metric icon={<GitBranch size={18} weight="duotone" />} label="Completed" value={completedProjects.length} />
        <Metric icon={<TerminalWindow size={18} weight="duotone" />} label="Runtime" value="PTY" />
      </section>

      <main className="construct-dashboard__grid">
        <section className="construct-dashboard__panel construct-dashboard__panel--projects">
          <div className="construct-dashboard__panel-header">
            <h2>Recent projects</h2>
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
                  <Folder size={18} weight="duotone" />
                </span>
                <span className="construct-dashboard__project-copy">
                  <strong>{project.title}</strong>
                  <small>{project.workspacePath}</small>
                </span>
                <span className="construct-dashboard__progress">
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
                  <GearSix size={16} weight="duotone" />
                </span>
              </button>
            ))}
            {projects.length === 0 ? (
              <div className="construct-dashboard__empty">
                <Folder size={22} weight="duotone" />
                <span>No local projects yet.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="construct-dashboard__side">
          <section className="construct-dashboard__panel">
            <div className="construct-dashboard__panel-header">
              <h2>Project feed</h2>
              <span>local</span>
            </div>
            <FeedItem title="Metal systems track" meta="3 local lessons" />
            <FeedItem title="LaunchBoard full stack" meta="workspace ready" />
            <FeedItem title="Agent browser helper" meta="coming from cloud feed" muted />
          </section>

          <section className="construct-dashboard__panel">
            <div className="construct-dashboard__panel-header">
              <h2>Runtime lanes</h2>
            </div>
            <FeedItem title="File materializer" meta="ready" />
            <FeedItem title="Guided editor" meta="ghost typing active" />
            <FeedItem title="Terminal PTY" meta="persistent tabs" />
          </section>
        </aside>
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="construct-dashboard__metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FeedItem({
  title,
  meta,
  muted = false
}: {
  title: string;
  meta: string;
  muted?: boolean;
}) {
  return (
    <div className="construct-dashboard__feed-item" data-muted={muted ? "true" : undefined}>
      <span>{title}</span>
      <small>{meta}</small>
    </div>
  );
}
