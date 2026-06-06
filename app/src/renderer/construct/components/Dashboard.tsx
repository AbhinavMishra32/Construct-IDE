import {
  BookOpenCheckIcon,
  DatabaseIcon,
  FolderKanbanIcon,
  RefreshCwIcon,
  TerminalSquareIcon
} from "lucide-react";

import { Button, StatusDot } from "@/components/open-shell";

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
    <main className="dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow">Construct</p>
          <h1>Project workbench</h1>
          <p>
            Local `.construct` projects that open directly into files, editor,
            terminal, and checkpoints.
          </p>
        </div>
        <Button variant="secondary" size="small" onClick={onRefresh} disabled={busy}>
          <RefreshCwIcon size={15} />
          Refresh
        </Button>
      </header>

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
    </main>
  );
}
