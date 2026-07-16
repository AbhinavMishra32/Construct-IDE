import { Archive, ArchiveRestore, Check, Folder, ListFilter, MessageSquare, Pin, PinOff, SquarePen } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";

import {
  ShadcnDropdownMenu,
  ShadcnDropdownMenuContent,
  ShadcnDropdownMenuGroup,
  ShadcnDropdownMenuItem,
  ShadcnDropdownMenuLabel,
  ShadcnDropdownMenuSeparator,
  ShadcnDropdownMenuTrigger,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProjectButton,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "@opaline/ui";
import { getUiState, setUiState } from "../lib/bridge";
import type { ProjectSummary } from "../types";
import { cn } from "../../lib/utils";

const STUDIO_SIDEBAR_STATE_KEY = "construct.sidebar.studio";

type StudioSortOrder = "last_user_message" | "created_at";

type StudioSidebarState = {
  archivedProjectIds: string[];
  pinnedProjectIds: string[];
  sortOrder: StudioSortOrder;
};

const DEFAULT_STUDIO_SIDEBAR_STATE: StudioSidebarState = {
  archivedProjectIds: [],
  pinnedProjectIds: [],
  sortOrder: "last_user_message",
};

export function DashboardSidebar({
  onCreateProject,
  onOpenProject,
  projects,
}: {
  onCreateProject: () => void;
  onOpenProject: (projectId: string) => void;
  projects: ProjectSummary[];
}) {
  const [sidebarState, setSidebarState] = useState<StudioSidebarState>(DEFAULT_STUDIO_SIDEBAR_STATE);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getUiState<StudioSidebarState>({
      key: STUDIO_SIDEBAR_STATE_KEY,
      fallback: DEFAULT_STUDIO_SIDEBAR_STATE,
    }).then((saved) => {
      if (!cancelled) setSidebarState(normalizeStudioSidebarState(saved));
    }).catch(() => {
      // Sidebar presentation state should never prevent projects from opening.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSidebarState = useCallback((update: (current: StudioSidebarState) => StudioSidebarState) => {
    setSidebarState((current) => {
      const next = update(current);
      void setUiState({ key: STUDIO_SIDEBAR_STATE_KEY, value: next }).catch(() => {
        // Keep the interaction responsive if the best-effort UI-state write fails.
      });
      return next;
    });
  }, []);

  const pinnedIds = useMemo(() => new Set(sidebarState.pinnedProjectIds), [sidebarState.pinnedProjectIds]);
  const archivedIds = useMemo(() => new Set(sidebarState.archivedProjectIds), [sidebarState.archivedProjectIds]);
  const archivedCount = projects.reduce((count, project) => count + Number(archivedIds.has(project.id)), 0);
  const visibleProjects = useMemo(() => {
    return [...projects]
      .filter((project) => showArchived ? archivedIds.has(project.id) : !archivedIds.has(project.id))
      .sort((left, right) => {
        const pinDelta = Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id));
        if (pinDelta !== 0) return pinDelta;
        const leftTime = sidebarState.sortOrder === "created_at" ? createdTime(left) : activityTime(left);
        const rightTime = sidebarState.sortOrder === "created_at" ? createdTime(right) : activityTime(right);
        return rightTime - leftTime;
      });
  }, [archivedIds, pinnedIds, projects, showArchived, sidebarState.sortOrder]);

  const togglePinned = useCallback((projectId: string) => {
    updateSidebarState((current) => ({
      ...current,
      pinnedProjectIds: current.pinnedProjectIds.includes(projectId)
        ? current.pinnedProjectIds.filter((id) => id !== projectId)
        : [...current.pinnedProjectIds, projectId],
    }));
  }, [updateSidebarState]);

  const toggleArchived = useCallback((projectId: string) => {
    updateSidebarState((current) => ({
      ...current,
      archivedProjectIds: current.archivedProjectIds.includes(projectId)
        ? current.archivedProjectIds.filter((id) => id !== projectId)
        : [...current.archivedProjectIds, projectId],
      pinnedProjectIds: current.pinnedProjectIds.filter((id) => id !== projectId),
    }));
  }, [updateSidebarState]);

  return (
    <SidebarGroup className="px-1.5 py-1.5 font-system-ui text-[length:var(--app-font-size-ui,12px)]">
      <div className="group/studio-header relative my-1">
        <div className={cn("flex h-7 w-full min-w-0 items-center px-2 py-0.5 pr-16", SIDEBAR_SECTION_LABEL_CLASS_NAME)}>
          <span className="truncate">Studio</span>
        </div>
        <div className="absolute inset-y-0 right-1.5 flex items-center gap-1">
          <StudioHeaderButton aria-label="New project" onClick={onCreateProject} title="New project">
            <SquarePen />
          </StudioHeaderButton>
          <ShadcnDropdownMenu>
            <ShadcnDropdownMenuTrigger
              aria-label="Sort projects"
              render={<StudioHeaderButton title="Sort projects" />}
            >
              <ListFilter />
            </ShadcnDropdownMenuTrigger>
            <ShadcnDropdownMenuContent
              align="end"
              className="w-44 rounded-lg bg-popover text-[length:var(--app-font-size-ui,12px)] shadow-lg"
              side="bottom"
              sideOffset={6}
            >
              <ShadcnDropdownMenuGroup>
                <ShadcnDropdownMenuLabel className="px-2 py-1 font-medium">Sort chats</ShadcnDropdownMenuLabel>
                <SortMenuItem
                  active={sidebarState.sortOrder === "last_user_message"}
                  label="Last user message"
                  onClick={() => updateSidebarState((current) => ({ ...current, sortOrder: "last_user_message" }))}
                />
                <SortMenuItem
                  active={sidebarState.sortOrder === "created_at"}
                  label="Created at"
                  onClick={() => updateSidebarState((current) => ({ ...current, sortOrder: "created_at" }))}
                />
              </ShadcnDropdownMenuGroup>
              {archivedCount > 0 ? (
                <>
                  <ShadcnDropdownMenuSeparator />
                  <ShadcnDropdownMenuItem onClick={() => setShowArchived((current) => !current)}>
                    {showArchived ? <MessageSquare /> : <Archive />}
                    {showArchived ? "Show active" : `Archived (${archivedCount})`}
                  </ShadcnDropdownMenuItem>
                </>
              ) : null}
            </ShadcnDropdownMenuContent>
          </ShadcnDropdownMenu>
        </div>
      </div>

      <SidebarMenu className="gap-1">
        {visibleProjects.map((project) => {
          const pinned = pinnedIds.has(project.id);
          const archived = archivedIds.has(project.id);
          return (
            <TooltipPrimitive.Root key={project.id}>
              <TooltipPrimitive.Trigger
                render={<SidebarMenuItem className="group/studio-row relative rounded-md" />}
              >
                <SidebarProjectButton
                  className="pr-[4.25rem] group-hover/studio-row:bg-[var(--sidebar-accent)] group-focus-within/studio-row:bg-[var(--sidebar-accent)]"
                  icon={<MessageSquare />}
                  label={project.title}
                  onClick={() => onOpenProject(project.id)}
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[length:var(--app-font-size-ui-sm,11px)] tabular-nums text-muted-foreground/58 transition-opacity group-hover/studio-row:opacity-0 group-focus-within/studio-row:opacity-0">
                  {formatDashboardProjectMeta(project)}
                </span>
                <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/studio-row:pointer-events-auto group-hover/studio-row:opacity-100 group-focus-within/studio-row:pointer-events-auto group-focus-within/studio-row:opacity-100">
                  <StudioRowButton
                    aria-label={pinned ? `Unpin ${project.title}` : `Pin ${project.title}`}
                    onClick={() => togglePinned(project.id)}
                    title={pinned ? "Unpin project" : "Pin project"}
                  >
                    {pinned ? <PinOff /> : <Pin />}
                  </StudioRowButton>
                  <StudioRowButton
                    aria-label={archived ? `Unarchive ${project.title}` : `Archive ${project.title}`}
                    onClick={() => toggleArchived(project.id)}
                    title={archived ? "Unarchive project" : "Archive project"}
                  >
                    {archived ? <ArchiveRestore /> : <Archive />}
                  </StudioRowButton>
                </div>
              </TooltipPrimitive.Trigger>
              <TooltipPrimitive.Portal>
                <TooltipPrimitive.Positioner align="start" className="z-50" side="right" sideOffset={8}>
                  <TooltipPrimitive.Popup className="w-64 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover/95 px-3 py-2 text-[length:var(--app-font-size-ui,12px)] text-popover-foreground shadow-xl backdrop-blur-xl transition-[opacity,transform] data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="truncate font-medium text-foreground">{project.title}</span>
                      <span className="shrink-0 text-muted-foreground/58">{formatDashboardProjectMeta(project)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground/79">
                      <Folder className="size-3.5" />
                      <span>Studio</span>
                    </div>
                  </TooltipPrimitive.Popup>
                </TooltipPrimitive.Positioner>
              </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
          );
        })}
        {visibleProjects.length === 0 ? (
          <SidebarMenuItem className="px-2 pt-4 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
            {showArchived ? "No archived projects" : "No projects yet"}
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function StudioHeaderButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn("inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-[15px]", className)}
      type="button"
      {...props}
    />
  );
}

function StudioRowButton({ className, onClick, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn("inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-[15px]", className)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      type="button"
      {...props}
    />
  );
}

function SortMenuItem({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <ShadcnDropdownMenuItem className="pr-2" onClick={onClick}>
      <span>{label}</span>
      {active ? <Check className="ml-auto size-3.5" /> : null}
    </ShadcnDropdownMenuItem>
  );
}

function normalizeStudioSidebarState(value: Partial<StudioSidebarState> | null | undefined): StudioSidebarState {
  return {
    archivedProjectIds: uniqueStrings(value?.archivedProjectIds),
    pinnedProjectIds: uniqueStrings(value?.pinnedProjectIds),
    sortOrder: value?.sortOrder === "created_at" ? "created_at" : "last_user_message",
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

function activityTime(project: ProjectSummary): number {
  return parseTime(project.flowLastActivityAt ?? project.lastOpenedAt ?? project.completedAt);
}

function createdTime(project: ProjectSummary): number {
  return parseTime(project.createdAt ?? project.lastOpenedAt);
}

function parseTime(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDashboardProjectMeta(project: ProjectSummary) {
  const timestamp = project.flowLastActivityAt ?? project.lastOpenedAt;
  if (!timestamp) return "";
  const elapsed = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
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
