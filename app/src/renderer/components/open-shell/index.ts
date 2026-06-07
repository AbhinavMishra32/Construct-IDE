export {
  AppShell,
  AppShellBottomPanel,
  AppShellChromeButton,
  AppShellChromeControls,
  AppShellCollapsedSidebarTrigger,
  AppShellComposer,
  AppShellContent,
  AppShellHeader,
  AppShellHeaderActions,
  AppShellHeaderContextSurface,
  AppShellHeaderPillButton,
  AppShellHeaderToolButton,
  AppShellRightPanel,
  AppShellTab,
  AppShellTabActionButton,
  AppShellTabActions,
  AppShellTabController,
  AppShellTabStrip,
} from "./app-shell/AppShell";
export type { AppShellProps, AppShellState, AppShellTabItem } from "./app-shell/AppShell";
export { SlotPanel } from "./slot-panel/SlotPanel";
export type { SlotTab, SlotPanelHandle, SlotPanelProps, SlotLauncherItem } from "./slot-panel/SlotPanel";
export {
  ShellHistoryProvider,
  useShellHistory,
  useShellHistoryContext,
} from "./history/ShellHistory";
export type {
  ShellHistoryController,
  ShellHistoryEntry,
  ShellHistoryProviderProps,
  ShellHistoryState,
  UseShellHistoryOptions,
} from "./history/ShellHistory";
export { BottomPanel, TerminalSurface, clampBottomPanelHeight } from "./bottom-panel/BottomPanel";
export type { BottomPanelTab, BottomPanelHandle } from "./bottom-panel/BottomPanel";
export { Composer } from "./composer/Composer";
export { FileTree } from "./file-tree/FileTree";
export type { FileTreeItem } from "./file-tree/FileTree";
export { FileBrowserBreadcrumbs, FileBrowserPanel, FileBrowserTab } from "./file-browser/FileBrowserPanel";
export type { FileBrowserPanelProps } from "./file-browser/FileBrowserPanel";
export { CodexMark } from "./icons/CodexMark";
export {
  SettingsCard,
  SettingsOptionCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSidebar,
  SettingsToggle,
} from "./settings/Settings";
export type {
  SettingsCardProps,
  SettingsNavItem,
  SettingsNavSection,
  SettingsOptionCardProps,
  SettingsPanelProps,
  SettingsRowProps,
  SettingsSectionProps,
  SettingsSelectProps,
  SettingsSidebarProps,
  SettingsToggleProps,
} from "./settings/Settings";
export { Button, IconButton, Pill, StatusDot } from "./primitives/Button";
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./primitives/ContextMenu";
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogSection,
  DialogTitle,
  DialogTrigger,
} from "./primitives/Dialog";
export type { CodexDialogContentProps, DialogSize } from "./primitives/Dialog";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./primitives/DropdownMenu";
export {
  Sidebar,
  SidebarFooter,
  SidebarNavItemRow,
  SidebarPrimary,
  SidebarProjectRow,
  SidebarScroll,
  SidebarSection,
  SidebarThreadRow,
} from "./sidebar/Sidebar";
export type { SidebarItem, SidebarNavItem, SidebarProject, SidebarProps } from "./sidebar/Sidebar";
export { appActionAttributeNames, appActionAttributes } from "./sidebar/appActionAttributes";
export { ThreadMessageRow, ThreadSurface } from "./thread/ThreadSurface";
export type { ThreadMessage, ThreadSurfaceProps } from "./thread/ThreadSurface";
