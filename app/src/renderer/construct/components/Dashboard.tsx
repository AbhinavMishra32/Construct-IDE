import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCode2,
  Folder,
  Plus,
  RefreshCcw,
  Settings,
  Sparkles
} from "lucide-react";
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
  const inProgressProjects = projects.filter((project) => project.progress > 0 && project.progress < 100);
  const mostRecent = [...projects].sort((a, b) => {
    const left = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
    const right = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
    return right - left;
  });
  const nextProject = inProgressProjects[0] ?? mostRecent[0] ?? null;
  const attentionProjects = mostRecent
    .filter((project) => (project.verificationFailCount ?? 0) > 0 || (project.authoringFixCount ?? 0) > 0)
    .slice(0, 4);
  const knowledgeProjects = mostRecent
    .filter((project) => (project.conceptCount ?? 0) > 0 || (project.referenceCount ?? 0) > 0 || (project.fileCount ?? 0) > 0)
    .slice(0, 4);

  return (
    <div className="construct-dashboard">
      <header className="construct-dashboard__hero">
        <div className="construct-dashboard__hero-copy">
          <span className="construct-dashboard__eyebrow">Construct workspace</span>
          <h1>Build projects that teach you back.</h1>
          <p>
            Open a local tape, continue the next code step, and keep verification close to the work.
          </p>
        </div>
        <div className="construct-dashboard__actions">
          <Button variant="secondary" size="small" onClick={onRefresh} disabled={busy}>
            <RefreshCcw size={14} className={busy ? "animate-spin" : ""} />
            Refresh
          </Button>
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
            <h2>Continue</h2>
            <span>{nextProject ? formatProjectPosition(nextProject) : "ready"}</span>
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

        <section className="construct-dashboard__protocol">
          <div className="construct-dashboard__panel-header">
            <h2>Supported protocols</h2>
            <span>project-safe</span>
          </div>
          <div className="construct-dashboard__protocol-list">
            {["tape-0.1", "tape-0.2", "tape-0.3", "tape-0.3.1"].map((protocol) => (
              <span key={protocol}>
                <CheckCircle2 size={14} />
                {protocol}
              </span>
            ))}
          </div>
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
              <h2>Needs attention</h2>
              <span>{attentionProjects.length ? "from projects" : "clear"}</span>
            </div>
            {attentionProjects.map((project) => (
              <ProjectSignal
                key={project.id}
                icon={<AlertCircle size={15} />}
                title={project.title}
                meta={describeAttention(project)}
                onClick={() => onOpenProject(project.id)}
              />
            ))}
            {attentionProjects.length === 0 ? (
              <div className="construct-dashboard__empty">
                <CheckCircle2 size={18} />
                <span>No failed verifications or tape fixes.</span>
              </div>
            ) : null}
          </section>

          <section className="construct-dashboard__panel">
            <div className="construct-dashboard__panel-header">
              <h2>Project inventory</h2>
              <span>real tape data</span>
            </div>
            {knowledgeProjects.map((project) => (
              <ProjectSignal
                key={project.id}
                icon={<BookOpen size={15} />}
                title={project.title}
                meta={`${project.fileCount ?? 0} files · ${project.conceptCount ?? 0} concepts · ${project.referenceCount ?? 0} refs`}
                onClick={() => onOpenProject(project.id)}
              />
            ))}
          </section>
        </aside>
      </main>
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

function describeAttention(project: ProjectSummary): string {
  const parts = [];
  if ((project.verificationFailCount ?? 0) > 0) {
    parts.push(`${project.verificationFailCount} failed verify`);
  }
  if ((project.authoringFixCount ?? 0) > 0) {
    parts.push(`${project.authoringFixCount} tape fix${project.authoringFixCount === 1 ? "" : "es"}`);
  }
  return parts.join(" · ");
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
