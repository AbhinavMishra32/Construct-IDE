import type { ReactNode } from "react";
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
            icon={<Folder size={16} weight="duotone" />}
            meta={formatDashboardProjectMeta(project)}
            onClick={() => onOpenProject(project.id)}
            onOpenSettings={() => onOpenProjectSettings(project.id)}
            subtitle={project.currentStepTitle || project.currentBlockLabel || formatDashboardSidebarTime(project.lastOpenedAt)}
            title={project.title}
            tone={project.progress >= 100 || project.completedAt ? "success" : "default"}
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
  icon,
  meta,
  onClick,
  onOpenSettings,
  subtitle,
  title,
  tone = "default"
}: {
  icon: ReactNode;
  meta: string;
  onClick: () => void;
  onOpenSettings: () => void;
  subtitle: string;
  title: string;
  tone?: "default" | "success";
}) {
  const iconClassName = tone === "success" ? "text-foreground" : "text-muted-foreground";

  return (
    <div className="group relative flex min-h-11 items-center rounded-lg transition-colors hover:bg-foreground/8 focus-within:bg-foreground/8">
      <button className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left" onClick={onClick} type="button">
        <span className={iconClassName}>{icon}</span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-medium text-foreground">{title}</strong>
          <small className="block truncate text-xs text-muted-foreground">{subtitle}</small>
        </span>
        <span className="mr-7 shrink-0 text-xs text-muted-foreground">{meta}</span>
      </button>
      <ShadcnDropdownMenu>
        <ShadcnDropdownMenuTrigger
          className="absolute right-1 grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/8 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
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
  return formatDashboardSidebarTime(project.lastOpenedAt);
}

function formatDashboardSidebarTime(value: string | null | undefined) {
  if (!value) {
    return "Recently opened";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Recently opened";
  }

  const diffMs = Date.now() - timestamp;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) {
    return "Opened less than an hour ago";
  }
  if (diffHours < 24) {
    return `Opened ${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `Opened ${diffDays}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}
