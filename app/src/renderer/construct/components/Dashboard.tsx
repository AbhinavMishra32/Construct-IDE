import {
  BookOpenCheckIcon,
  DatabaseIcon,
  FolderKanbanIcon,
  RefreshCwIcon,
  TerminalSquareIcon
} from "lucide-react";

import { Button, StatusDot, ThreadSurface } from "@/components/open-shell";

import { ProjectCard } from "./ProjectCard";
import type { ProjectSummary } from "../types";

export function Dashboard({
  projects,
  busy,
  error,
  onRefresh,
  onOpenProject
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <ThreadSurface
      title="Project workbench"
      subtitle="Construct"
      headerActions={
        <Button variant="secondary" size="small" onClick={onRefresh} disabled={busy}>
          <RefreshCwIcon size={15} />
          Refresh
        </Button>
      }
      messages={[
        {
          role: "user",
          body: "Open a .construct project and guide me through the real workspace."
        },
        {
          role: "assistant",
          body:
            "Construct projects materialize files, focus the right editor target, guide each step, and run commands in the same workspace terminal."
        }
      ]}
      afterMessages={
        <div className="dashboard">
          <section className="dashboard__stats" aria-label="Project runtime summary">
            <div>
              <FolderKanbanIcon size={17} />
              <span>{projects.length}</span>
              <p>saved projects</p>
            </div>
            <div>
              <BookOpenCheckIcon size={17} />
              <span>linear</span>
              <p>project tape</p>
            </div>
            <div>
              <TerminalSquareIcon size={17} />
              <span>real</span>
              <p>workspace terminal</p>
            </div>
            <div>
              <DatabaseIcon size={17} />
              <span><StatusDot tone="green" /> local</span>
              <p>project state</p>
            </div>
          </section>

          {error ? <div className="dashboard__error">{error}</div> : null}

          <section className="dashboard__projects" aria-label="Saved projects">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
              />
            ))}
          </section>
        </div>
      }
    />
  );
}
