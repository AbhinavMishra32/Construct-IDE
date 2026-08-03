import { Archive, ArchiveRestore, ListFilter, MessageSquare, Pin, PinOff, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SparMenu,
  SparMenuCheckItem,
  SparMenuContent,
  SparMenuItem,
  SparMenuLabel,
  SparMenuSeparator,
  SparMenuTrigger,
  SparSectionLabel,
  SparSectionToggle,
  SparSidebarHeaderButton,
  SparSidebarRow,
  type SparRowMenuItem,
} from "../../components/spar";
import { getUiState, setUiState } from "../lib/bridge";
import type { ProjectSummary } from "../types";

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

/**
 * The projects list.
 *
 * Pinning, archiving and sort order are presentation state and live in the UI
 * store, never on the project itself — this component reads and writes that one
 * key and touches nothing about the projects it is listing.
 *
 * Everything you can do to a row is behind ⋮ or a right-click rather than a pair
 * of hover buttons. Two controls appearing in the gutter cost the title four
 * more characters and gave the row two things to aim at; one menu costs it none
 * and holds as many actions as the row ever grows.
 */
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

  /* Sorted once for the whole list rather than per section: pinned rows are the
     same rows in the same order, lifted to the top. */
  const ordered = useMemo(() => {
    return [...projects]
      .filter((project) => !archivedIds.has(project.id))
      .sort((left, right) => {
        const leftTime = sidebarState.sortOrder === "created_at" ? createdTime(left) : activityTime(left);
        const rightTime = sidebarState.sortOrder === "created_at" ? createdTime(right) : activityTime(right);
        return rightTime - leftTime;
      });
  }, [archivedIds, projects, sidebarState.sortOrder]);

  const pinned = useMemo(() => ordered.filter((project) => pinnedIds.has(project.id)), [ordered, pinnedIds]);
  const recent = useMemo(() => ordered.filter((project) => !pinnedIds.has(project.id)), [ordered, pinnedIds]);
  const archived = useMemo(
    () => projects.filter((project) => archivedIds.has(project.id)),
    [archivedIds, projects],
  );

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

  const row = (project: ProjectSummary) => {
    const isPinned = pinnedIds.has(project.id);
    const isArchived = archivedIds.has(project.id);
    const items: SparRowMenuItem[] = [
      ...(isArchived
        ? []
        : [{
            key: "p",
            label: isPinned ? "Unpin" : "Pin to top",
            icon: isPinned ? PinOff : Pin,
            run: () => togglePinned(project.id),
          }]),
      {
        key: "a",
        label: isArchived ? "Restore" : "Archive",
        icon: isArchived ? ArchiveRestore : Archive,
        run: () => toggleArchived(project.id),
      },
    ];

    return (
      <SparSidebarRow
        dimmed={isArchived}
        items={items}
        key={project.id}
        label={project.title}
        leading={
          <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground/70">
            <MessageSquare className="size-3.5" />
          </span>
        }
        onOpen={() => onOpenProject(project.id)}
      />
    );
  };

  return (
    <div className="text-ui">
      {/* The header's controls live in a hover gutter reserved by the label's own
          right padding, so revealing them never reflows the word "Projects". */}
      <div className="group/projects-header relative">
        <SparSectionLabel className="pr-14">Projects</SparSectionLabel>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pt-1 opacity-0 transition-opacity group-hover/projects-header:pointer-events-auto group-hover/projects-header:opacity-100 group-focus-within/projects-header:pointer-events-auto group-focus-within/projects-header:opacity-100">
          <SparSidebarHeaderButton aria-label="New project" onClick={onCreateProject} title="New project">
            <SquarePen />
          </SparSidebarHeaderButton>
          <SparMenu>
            <SparMenuTrigger asChild>
              <SparSidebarHeaderButton aria-label="Sort projects" title="Sort projects">
                <ListFilter />
              </SparSidebarHeaderButton>
            </SparMenuTrigger>
            <SparMenuContent align="end" className="min-w-[12rem]" side="bottom">
              <SparMenuLabel>Sort by</SparMenuLabel>
              <SparMenuCheckItem
                checked={sidebarState.sortOrder === "last_user_message"}
                onSelect={() => updateSidebarState((current) => ({ ...current, sortOrder: "last_user_message" }))}
              >
                <span className="min-w-0 flex-1 truncate">Last user message</span>
              </SparMenuCheckItem>
              <SparMenuCheckItem
                checked={sidebarState.sortOrder === "created_at"}
                onSelect={() => updateSidebarState((current) => ({ ...current, sortOrder: "created_at" }))}
              >
                <span className="min-w-0 flex-1 truncate">Created at</span>
              </SparMenuCheckItem>
              {archivedCount > 0 ? (
                <>
                  <SparMenuSeparator />
                  <SparMenuItem onSelect={() => setShowArchived((current) => !current)}>
                    {showArchived ? <MessageSquare /> : <Archive />}
                    <span className="min-w-0 flex-1 truncate">
                      {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                    </span>
                  </SparMenuItem>
                </>
              ) : null}
            </SparMenuContent>
          </SparMenu>
        </div>
      </div>

      {pinned.length > 0 ? (
        <>
          <SparSectionLabel>Pinned</SparSectionLabel>
          <div className="space-y-0.5">{pinned.map(row)}</div>
        </>
      ) : null}

      {recent.length > 0 ? (
        <>
          {/* Only worth naming once there is a group above it to be distinct
              from — a lone "Recent" over the only list is a label for nothing. */}
          {pinned.length > 0 ? <SparSectionLabel>Recent</SparSectionLabel> : null}
          <div className="space-y-0.5">{recent.map(row)}</div>
        </>
      ) : null}

      {/* Collapsed by default: the point of archiving was to get these out of the
          way, and a permanent list of them would put them back. */}
      {archived.length > 0 ? (
        <>
          <SparSectionToggle count={archived.length} onToggle={() => setShowArchived((current) => !current)} open={showArchived}>
            Archived
          </SparSectionToggle>
          {showArchived ? <div className="space-y-0.5">{archived.map(row)}</div> : null}
        </>
      ) : null}

      {ordered.length === 0 && archived.length === 0 ? (
        <p className="px-2 pt-4 text-center text-ui text-muted-foreground/60">No projects yet</p>
      ) : null}
    </div>
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
