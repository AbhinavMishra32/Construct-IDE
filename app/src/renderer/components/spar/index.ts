/**
 * Spar's desktop primitives, vendored into Construct.
 *
 * Everything under `./ui` is copied verbatim from
 * `pracai/apps/desktop/src/renderer/components/ui`, with only the import
 * specifiers rewritten (`motion/react` → `framer-motion`, which has the same API
 * surface for what these use). Keeping the two in step is a re-copy, not a
 * re-derivation — so do not hand-edit those files.
 *
 * The `Spar` prefix is applied here, at the boundary, rather than inside the
 * copies. Construct already has a `components/ui` built on Base UI that the auth
 * and editor surfaces use, and two exports called `Button` in one file is how you
 * end up rendering the wrong one; prefixing at the re-export keeps the vendored
 * files byte-identical to their source while call sites stay unambiguous.
 *
 * The material these render on lives in `spar-shell.css`; the tokens they read
 * live in `index.css`.
 */

export { Button as SparButton, buttonVariants } from "./ui/button";
export { Input as SparInput } from "./ui/input";
export { Textarea as SparTextarea } from "./ui/textarea";
export { Label as SparLabel } from "./ui/label";
export { Separator as SparSeparator } from "./ui/separator";
export { Skeleton as SparSkeleton } from "./ui/skeleton";
export { Segmented as SparSegmented } from "./ui/segmented";
export { ViewSwitch as SparViewSwitch } from "./ui/view-switch";
export type { ViewOption as SparViewOption } from "./ui/view-switch";
export { Meter as SparMeter, MeterKey as SparMeterKey } from "./ui/meter";
export type { MeterBand as SparMeterBand } from "./ui/meter";

export {
  Collapsible as SparCollapsible,
  CollapsibleContent as SparCollapsibleContent,
  CollapsibleTrigger as SparCollapsibleTrigger,
} from "./ui/collapsible";

export {
  Dialog as SparDialog,
  DialogClose as SparDialogClose,
  DialogContent as SparDialogContent,
  DialogDescription as SparDialogDescription,
  DialogFooter as SparDialogFooter,
  DialogHeader as SparDialogHeader,
  DialogOverlay as SparDialogOverlay,
  DialogPortal as SparDialogPortal,
  DialogTitle as SparDialogTitle,
  DialogTrigger as SparDialogTrigger,
} from "./ui/dialog";

export {
  DropdownMenu as SparMenu,
  DropdownMenuCheckItem as SparMenuCheckItem,
  DropdownMenuContent as SparMenuContent,
  DropdownMenuItem as SparMenuItem,
  DropdownMenuLabel as SparMenuLabel,
  DropdownMenuSeparator as SparMenuSeparator,
  DropdownMenuSub as SparMenuSub,
  DropdownMenuSubContent as SparMenuSubContent,
  DropdownMenuSubTrigger as SparMenuSubTrigger,
  DropdownMenuTrigger as SparMenuTrigger,
} from "./ui/dropdown-menu";

export {
  Select as SparSelect,
  SelectContent as SparSelectContent,
  SelectGroup as SparSelectGroup,
  SelectItem as SparSelectItem,
  SelectLabel as SparSelectLabel,
  SelectSeparator as SparSelectSeparator,
  SelectTrigger as SparSelectTrigger,
  SelectValue as SparSelectValue,
} from "./ui/select";
export { ModelSelectField as SparModelSelectField } from "./ui/model-select";
export type { ModelOption as SparModelOption } from "./ui/model-select";

export {
  Tooltip as SparTooltip,
  TooltipContent as SparTooltipContent,
  TooltipProvider as SparTooltipProvider,
  TooltipTrigger as SparTooltipTrigger,
} from "./ui/tooltip";

export {
  HoverCard as SparHoverCard,
  HoverCardContent as SparHoverCardContent,
  HoverCardTrigger as SparHoverCardTrigger,
} from "./ui/hover-card";

export {
  modalContentVariants,
  modalOverlayVariants,
  overlaySurfaceVariants,
} from "./ui/overlay-motion";
export type { OverlaySide } from "./ui/overlay-motion";

/* Construct-owned compositions over the primitives above. */
export { SparEmptyState } from "./controls";
export { SparScrollDrum } from "./scroll-drum";
export {
  SparSettingsBoundary,
  SparSettingsCard,
  SparSettingsField,
  SparSettingsGroup,
  SparSettingsPage,
  SparSettingsRow,
  SparSettingsSection,
  SparSettingsToggle,
} from "./settings";
export {
  SPAR_SIDEBAR_ROW,
  SparRowTitle,
  SparSectionLabel,
  SparSectionToggle,
  SparSidebarAction,
  SparSidebarHeaderButton,
  SparSidebarRow,
  SparSidebarSearch,
  SparStatusDot,
} from "./sidebar";
export type { SparRowMenuItem, SparRowQuickAction } from "./sidebar";
export { SparToolbar, SparToolbarButton, SparToolbarIconButton } from "./toolbar";
export { initials, relativeTime, shortTime } from "./format";
export { useControlledState, useScrollFade } from "./hooks";
