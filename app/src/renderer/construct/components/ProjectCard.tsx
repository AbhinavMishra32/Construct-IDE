import { ArrowRightIcon, Clock3Icon, FolderCodeIcon } from "lucide-react";

import { Button, Pill } from "@opaline/ui/v2";

import { formatLastOpened } from "../lib/projectStore";
import type { ProjectSummary } from "../types";

export function ProjectCard({
  project,
  onOpen
}: {
  project: ProjectSummary;
  onOpen: (projectId: string) => void;
}) {
  return (
    <article className="project-card">
      <div className="project-card__icon" aria-hidden="true">
        <FolderCodeIcon size={18} />
      </div>
      <div className="project-card__body">
        <div className="project-card__title-row">
          <h2>{project.title}</h2>
          <Pill>{project.progress}%</Pill>
        </div>
        <p>{project.description}</p>
        <div className="project-card__meta">
          <span>
            <Clock3Icon size={13} />
            {formatLastOpened(project.lastOpenedAt)}
          </span>
          <span>{project.workspacePath}</span>
        </div>
        <div className="project-card__progress" aria-label={`${project.progress}% complete`}>
          <span style={{ width: `${project.progress}%` }} />
        </div>
      </div>
      <Button className="project-card__open" size="small" variant="secondary" onClick={() => onOpen(project.id)}>
        Open
        <ArrowRightIcon size={15} />
      </Button>
    </article>
  );
}
