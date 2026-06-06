import {
  GitBranch,
  Path,
  PlayCircle,
  Plus,
  ArrowsClockwise,
  TerminalWindow
} from "@phosphor-icons/react";

import { Button, StatusDot, ThreadSurface } from "@/components/open-shell";

import type { ProjectSummary } from "../types";

export function Dashboard({
  projects,
  busy,
  error,
  onRefresh,
  onCreateProject
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreateProject: () => void;
}) {
  const activeCount = projects.filter((project) => project.progress > 0 && project.progress < 100).length;
  const completedCount = projects.filter((project) => project.progress >= 100).length;

  return (
    <ThreadSurface
      title="Construct"
      subtitle="Project runtime"
      headerActions={
        <div className="dashboard__header-actions">
          <Button variant="secondary" size="small" onClick={onRefresh} disabled={busy}>
            <ArrowsClockwise size={15} weight="duotone" />
            Refresh
          </Button>
          <Button size="small" onClick={onCreateProject}>
            <Plus size={15} weight="bold" />
            New project
          </Button>
        </div>
      }
      messages={[
        {
          role: "user",
          body: "Open a .construct file from the sidebar and turn it into a real coding workspace."
        },
        {
          role: "assistant",
          body:
            "Projects are file-backed programs: initial files materialize into a chosen folder, guided edits save to disk, and terminal commands run in that same workspace."
        }
      ]}
      afterMessages={
        <div className="dashboard">
          <section className="dashboard-command-center" aria-label="Runtime status">
            <div className="dashboard-command-center__metric">
              <strong>{projects.length}</strong>
              <span>file-backed projects</span>
            </div>
            <div className="dashboard-command-center__metric">
              <strong>{activeCount}</strong>
              <span>in progress</span>
            </div>
            <div className="dashboard-command-center__metric">
              <strong>{completedCount}</strong>
              <span>complete</span>
            </div>
            <div className="dashboard-command-center__metric">
              <strong><StatusDot tone="green" /> local</strong>
              <span>workspace state</span>
            </div>
          </section>

          {error ? <div className="dashboard__error">{error}</div> : null}

          <section className="dashboard-runtime-table" aria-label="Runtime model">
            <div>
              <Path size={18} weight="duotone" />
              <span>Source</span>
              <strong>.construct file</strong>
            </div>
            <div>
              <GitBranch size={18} weight="duotone" />
              <span>Persistence</span>
              <strong>real folder + optional Git</strong>
            </div>
            <div>
              <TerminalWindow size={18} weight="duotone" />
              <span>Terminal</span>
              <strong>PTY in project cwd</strong>
            </div>
            <div>
              <PlayCircle size={18} weight="duotone" />
              <span>Flow</span>
              <strong>explain, edit, run, expect, checkpoint</strong>
            </div>
          </section>
        </div>
      }
    />
  );
}
