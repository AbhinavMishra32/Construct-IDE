import { Folder, GearSix } from "@phosphor-icons/react";

import {
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuTrigger,
  SidebarSection
} from "@opaline/ui";
import type { ProjectSummary } from "../types";

export function DashboardSidebar({
  projects,
  onOpenProject,
  onOpenProjectSettings
}: {
  projects: ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
}) {
  const visibleProjects = [...projects]
    .sort((a, b) => {
      const left = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
      const right = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
      return right - left;
    })
    .slice(0, 8);

  return (
    <SidebarSection heading="Projects">
      <div className="flex flex-col gap-1 px-2 pb-2">
        {visibleProjects.map((project) => (
          <DashboardSidebarProjectRow
            key={project.id}
            meta={formatDashboardProjectMeta(project)}
            onClick={() => onOpenProject(project.id)}
            onOpenSettings={() => onOpenProjectSettings(project.id)}
            title={project.title}
          />
        ))}
        {visibleProjects.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No active project yet. Open a tape to start building.</div>
        ) : null}
      </div>
    </SidebarSection>
  );
}

function DashboardSidebarProjectRow({
  meta,
  onClick,
  onOpenSettings,
  title
}: {
  meta: string | null;
  onClick: () => void;
  onOpenSettings: () => void;
  title: string;
}) {
  return (
    <div className="group relative min-h-9 rounded-lg hover:bg-foreground/8 focus-within:bg-foreground/8">
      <button className="flex h-9 w-full min-w-0 items-center rounded-lg px-2 py-1.5 text-left" onClick={onClick} type="button">
        <span className="block min-w-0 flex-1 truncate pr-14 text-sm font-medium text-foreground">{title}</span>
      </button>
      {meta ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground group-hover:opacity-0 group-focus-within:opacity-0">
          {meta}
        </span>
      ) : null}
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          className="absolute right-1 grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-foreground/8 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Project actions for ${title}`}
        >
          <span aria-hidden="true">•••</span>
        </ShadcnDropdownMenuTrigger>
        <ShadcnDropdownMenuContent align="end" side="right" sideOffset={6}>
          <ShadcnDropdownMenuItem onClick={onClick}>
            <Folder size={14} weight="duotone" />
            Open project
          </ShadcnDropdownMenuItem>
          <ShadcnDropdownMenuItem onClick={onOpenSettings}>
            <GearSix size={14} weight="duotone" />
            Project settings
          </ShadcnDropdownMenuItem>
        </ShadcnDropdownMenuContent>
      </ShadcnDropdownMenu>
    </div>
  );
}

function formatDashboardProjectMeta(project: ProjectSummary) {
  if (project.progress >= 100 || project.completedAt) {
    return "Done";
  }
  if (project.progress > 0) {
    return `${project.progress}%`;
  }
  return null;
}
