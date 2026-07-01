import { DotsThree, Folder, GearSix } from "@phosphor-icons/react";

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
    });

  return (
    <SidebarSection heading="Projects">
      <div className="flex flex-col gap-0.5 px-1.5 pb-2">
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
          <div className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground/70">No projects yet.</div>
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
    <div className="group relative min-h-7">
      <button className="construct-sidebar-row flex" onClick={onClick} type="button">
        <span className="text-muted-foreground/80" data-sidebar-row-icon aria-hidden="true">
          <Folder size={14} />
        </span>
        <span className="block flex-1 pr-12" data-sidebar-row-label>{title}</span>
      </button>
      {meta ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12.5px] font-normal text-muted-foreground/65 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          {meta}
        </span>
      ) : null}
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          className="construct-sidebar-action absolute right-1 top-1/2 grid size-[22px] -translate-y-1/2 place-items-center rounded-[4px] text-muted-foreground/70 opacity-0 transition-opacity hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
          aria-label={`Project actions for ${title}`}
        >
          <DotsThree size={15} weight="bold" />
        </ShadcnDropdownMenuTrigger>
        <ShadcnDropdownMenuContent align="end" side="right" sideOffset={6}>
          <ShadcnDropdownMenuItem onClick={onClick}>
            <Folder size={14} />
            Open project
          </ShadcnDropdownMenuItem>
          <ShadcnDropdownMenuItem onClick={onOpenSettings}>
            <GearSix size={14} />
            Project settings
          </ShadcnDropdownMenuItem>
        </ShadcnDropdownMenuContent>
      </ShadcnDropdownMenu>
    </div>
  );
}

function formatDashboardProjectMeta(project: ProjectSummary) {
  if (!project.lastOpenedAt) return null;
  const elapsed = Date.now() - Date.parse(project.lastOpenedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}
