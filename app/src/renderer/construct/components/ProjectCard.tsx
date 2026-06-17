import { ArrowRightIcon, Clock3Icon, FolderCodeIcon } from "lucide-react";

import { Button, Pill } from "@opaline/ui";

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
    <article className="flex items-center gap-3 rounded-[8px] border bg-card/70 p-3 text-card-foreground shadow-sm transition-colors hover:bg-muted/35">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground" aria-hidden="true">
        <FolderCodeIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{project.title}</h2>
          <Pill>{project.progress}%</Pill>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
        <div className="mt-2 flex min-w-0 items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1">
            <Clock3Icon size={13} />
            {formatLastOpened(project.lastOpenedAt)}
          </span>
          <span className="truncate">{project.workspacePath}</span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-label={`${project.progress}% complete`}>
          <span className="block h-full rounded-full bg-muted-foreground/55" style={{ width: `${project.progress}%` }} />
        </div>
      </div>
      <Button className="shrink-0" size="small" variant="secondary" onClick={() => onOpen(project.id)}>
        Open
        <ArrowRightIcon size={15} />
      </Button>
    </article>
  );
}
