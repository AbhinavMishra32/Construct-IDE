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
    });

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
          <div className="px-2 py-1.5 text-[13px] text-muted-foreground">No projects yet.</div>
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
    <div className="group relative min-h-8 rounded-lg hover:bg-muted focus-within:bg-muted">
      <button className="flex h-8 w-full min-w-0 items-center rounded-lg px-2 py-1 text-left" onClick={onClick} type="button">
        <span className="grid size-[18px] shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
          <Folder size={15} weight="duotone" />
        </span>
        <span className="ml-2 block min-w-0 flex-1 truncate pr-14 text-[13px] font-medium text-foreground">{title}</span>
      </button>
      {meta ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground group-hover:opacity-0 group-focus-within:opacity-0">
          {meta}
        </span>
      ) : null}
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          className="absolute right-1 top-0 grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
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
  if (!project.lastOpenedAt) return null;
  const elapsed = Date.now() - Date.parse(project.lastOpenedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
