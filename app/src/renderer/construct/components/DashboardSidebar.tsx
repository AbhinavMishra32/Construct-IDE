import { DotsThree, GearSix } from "@phosphor-icons/react";
import { Folder } from "lucide-react";

import {
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuTrigger,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarProjectButton,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
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
    <SidebarGroup className="px-1.5 pt-1 pb-2">
      <div className="mb-1.5 flex items-center px-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>Projects</span>
      </div>
      <SidebarMenu className="gap-0.5">
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
          <SidebarMenuItem className="px-2 pt-4 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
            No projects yet
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
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
    <SidebarMenuItem className="rounded-md">
      <SidebarProjectButton icon={<Folder />} label={title} onClick={onClick} />
      {meta ? (
        <SidebarMenuBadge className="right-2 text-[11px] font-normal text-muted-foreground/65 transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0">
          {meta}
        </SidebarMenuBadge>
      ) : null}
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          render={<SidebarMenuAction showOnHover />}
          aria-label={`Project actions for ${title}`}
        >
          <DotsThree size={15} weight="bold" />
        </ShadcnDropdownMenuTrigger>
        <ShadcnDropdownMenuContent align="end" className="w-40" side="right" sideOffset={6}>
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
    </SidebarMenuItem>
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
