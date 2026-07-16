import { FolderClosedIcon, FolderPlusIcon } from "lucide-react";

import {
  Button,
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuGroup,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuLabel,
  ShadcnDropdownMenuTrigger,
} from "@opaline/ui";
import type { ProjectSummary } from "../types";

export function HomeProjectPicker({
  onOpenChange,
  onOpenProject,
  open,
  projects,
}: {
  onOpenChange: (open: boolean) => void;
  onOpenProject: (projectId: string) => void;
  open: boolean;
  projects: ProjectSummary[];
}) {
  const visibleProjects = [...projects].sort((left, right) => {
    const leftOpened = left.lastOpenedAt ? Date.parse(left.lastOpenedAt) : 0;
    const rightOpened = right.lastOpenedAt ? Date.parse(right.lastOpenedAt) : 0;
    return rightOpened - leftOpened;
  });

  return (
    <ShadcnDropdownMenu onOpenChange={onOpenChange} open={open}>
      <ShadcnDropdownMenuTrigger
        render={
          <Button
            className="h-7 min-w-0 justify-start gap-1.5 overflow-hidden px-1.5 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)] hover:text-[var(--color-text-foreground)]"
            size="sm"
            type="button"
            variant="chrome"
          />
        }
      >
        <FolderClosedIcon className="shrink-0" data-icon="inline-start" />
        <span className="truncate">Work in a project</span>
      </ShadcnDropdownMenuTrigger>
      <ShadcnDropdownMenuContent align="start" className="w-64" side="top">
        <ShadcnDropdownMenuGroup>
          <ShadcnDropdownMenuLabel>Projects</ShadcnDropdownMenuLabel>
          {visibleProjects.map((project) => (
            <ShadcnDropdownMenuItem
              key={project.id}
              onClick={() => {
                onOpenProject(project.id);
                onOpenChange(false);
              }}
            >
              <FolderClosedIcon className="size-3.5" />
              <span className="truncate">{project.title}</span>
            </ShadcnDropdownMenuItem>
          ))}
          {visibleProjects.length === 0 ? (
            <ShadcnDropdownMenuItem disabled>
              <FolderPlusIcon className="size-3.5" />
              No projects yet
            </ShadcnDropdownMenuItem>
          ) : null}
        </ShadcnDropdownMenuGroup>
      </ShadcnDropdownMenuContent>
    </ShadcnDropdownMenu>
  );
}
