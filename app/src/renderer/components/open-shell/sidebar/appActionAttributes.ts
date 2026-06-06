export const appActionAttributeNames = {
  sidebarProjectCollapsed: "data-app-action-sidebar-project-collapsed",
  sidebarProjectId: "data-app-action-sidebar-project-id",
  sidebarProjectLabel: "data-app-action-sidebar-project-label",
  sidebarProjectListId: "data-app-action-sidebar-project-list-id",
  sidebarProjectRow: "data-app-action-sidebar-project-row",
  sidebarProjectSelect: "data-app-action-sidebar-select-project",
  sidebarProjectShowAll: "data-app-action-sidebar-project-show-all",
  sidebarProjectShowAllToggle: "data-app-action-sidebar-project-show-all-toggle",
  sidebarScroll: "data-app-action-sidebar-scroll",
  sidebarSection: "data-app-action-sidebar-section",
  sidebarSectionCollapsed: "data-app-action-sidebar-section-collapsed",
  sidebarSectionHeading: "data-app-action-sidebar-section-heading",
  sidebarSectionToggle: "data-app-action-sidebar-section-toggle",
  sidebarThreadActive: "data-app-action-sidebar-thread-active",
  sidebarThreadHostId: "data-app-action-sidebar-thread-host-id",
  sidebarThreadId: "data-app-action-sidebar-thread-id",
  sidebarThreadKind: "data-app-action-sidebar-thread-kind",
  sidebarThreadPinned: "data-app-action-sidebar-thread-pinned",
  sidebarThreadRow: "data-app-action-sidebar-thread-row",
  sidebarThreadTitle: "data-app-action-sidebar-thread-title",
} as const;

type DataAttributes = Record<string, string>;

export const appActionAttributes = {
  sidebarProjectList({ projectId, showAll }: { projectId: string; showAll: boolean }): DataAttributes {
    return {
      [appActionAttributeNames.sidebarProjectListId]: projectId,
      [appActionAttributeNames.sidebarProjectShowAll]: String(showAll),
    };
  },
  sidebarProjectRow({
    collapsed,
    label,
    projectId,
  }: {
    collapsed: boolean;
    label: string;
    projectId: string;
  }): DataAttributes {
    return {
      [appActionAttributeNames.sidebarProjectCollapsed]: String(collapsed),
      [appActionAttributeNames.sidebarProjectId]: projectId,
      [appActionAttributeNames.sidebarProjectLabel]: label,
      [appActionAttributeNames.sidebarProjectRow]: "",
    };
  },
  sidebarProjectSelect: {
    [appActionAttributeNames.sidebarProjectSelect]: "",
  },
  sidebarProjectShowAllToggle: {
    [appActionAttributeNames.sidebarProjectShowAllToggle]: "",
  },
  sidebarScroll: {
    [appActionAttributeNames.sidebarScroll]: "",
  },
  sidebarSection({ collapsed, heading }: { collapsed: boolean; heading: string }): DataAttributes {
    return {
      [appActionAttributeNames.sidebarSection]: "",
      [appActionAttributeNames.sidebarSectionCollapsed]: String(collapsed),
      [appActionAttributeNames.sidebarSectionHeading]: heading,
    };
  },
  sidebarSectionToggle: {
    [appActionAttributeNames.sidebarSectionToggle]: "",
  },
  sidebarThreadRow({
    active,
    hostId,
    id,
    kind,
    pinned,
    title,
  }: {
    active: boolean;
    hostId?: string | null;
    id: string;
    kind: "local" | "remote";
    pinned: boolean;
    title: string;
  }): DataAttributes {
    return {
      [appActionAttributeNames.sidebarThreadActive]: String(active),
      [appActionAttributeNames.sidebarThreadHostId]: hostId ?? "",
      [appActionAttributeNames.sidebarThreadId]: id,
      [appActionAttributeNames.sidebarThreadKind]: kind,
      [appActionAttributeNames.sidebarThreadPinned]: String(pinned),
      [appActionAttributeNames.sidebarThreadRow]: "",
      [appActionAttributeNames.sidebarThreadTitle]: title,
    };
  },
};
