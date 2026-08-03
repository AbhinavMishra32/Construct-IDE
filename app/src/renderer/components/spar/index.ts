/**
 * Spar's desktop primitives, vendored into Construct.
 *
 * These sit alongside `components/ui` rather than replacing it: the existing set
 * is built on Base UI and is what the auth and editor surfaces use, while these
 * are the Radix-and-glass set the shell, dashboard, chat and settings are drawn
 * from. The `Spar` prefix is deliberate — it keeps the two apart at the import
 * site, so nobody has to remember which `Button` a file is holding.
 *
 * The material they render on lives in `spar-shell.css`; the tokens they read
 * live in `index.css`.
 */
export { SparButton, buttonVariants } from "./button";
export {
  SparDialog,
  SparDialogClose,
  SparDialogContent,
  SparDialogDescription,
  SparDialogFooter,
  SparDialogHeader,
  SparDialogOverlay,
  SparDialogPortal,
  SparDialogTitle,
  SparDialogTrigger,
} from "./dialog";
export {
  SparMenu,
  SparMenuCheckItem,
  SparMenuContent,
  SparMenuItem,
  SparMenuLabel,
  SparMenuSeparator,
  SparMenuSub,
  SparMenuSubContent,
  SparMenuSubTrigger,
  SparMenuTrigger,
} from "./dropdown-menu";
export { SparEmptyState, SparMeter, SparSegmented, SparViewSwitch } from "./controls";
export type { SparMeterBand, SparViewOption } from "./controls";
export { SparScrollDrum } from "./scroll-drum";
export {
  SPAR_SIDEBAR_ROW,
  SparSectionLabel,
  SparSectionToggle,
  SparSidebarAction,
  SparSidebarHeaderButton,
  SparSidebarRow,
  SparStatusDot,
} from "./sidebar";
export type { SparRowMenuItem } from "./sidebar";
export { SparToolbar, SparToolbarButton, SparToolbarIconButton } from "./toolbar";
export { initials, relativeTime, shortTime } from "./format";
export { useControlledState, useScrollFade } from "./hooks";
export {
  modalContentVariants,
  modalOverlayVariants,
  overlayItemVariants,
  overlaySurfaceVariants,
  OVERLAY_CLOSE,
  OVERLAY_SPRING,
  OVERLAY_SPRING_SOFT,
} from "./overlay-motion";
export type { OverlaySide } from "./overlay-motion";
