"use client";

// Literal Synara Base UI Select transplant. Import paths and the legacy
// SelectContent export alias are the only Construct compatibility changes.
import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME =
  "relative overflow-hidden border border-border bg-popover/70 text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150";
const APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME =
  `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} rounded-2xl shadow-xl`;
const COMPOSER_SURFACE_SHADOW_CLASS_NAME =
  "shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]";
const COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME =
  `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} border border-border rounded-[0.65rem] ${COMPOSER_SURFACE_SHADOW_CLASS_NAME}`;
const COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME =
  "relative z-1 w-full min-w-0 overflow-y-auto overscroll-contain composer-picker-scroll";
const COMPOSER_PICKER_MENU_POPUP_VIEWPORT_CLASS_NAME =
  "relative min-w-(--anchor-width) max-h-[min(var(--available-height),28rem)]";
const COMPOSER_PICKER_MENU_OPTION_CLASS_NAME =
  "[&>svg,&>[data-slot=central-icon]]:-mx-0.5 flex cursor-default select-none items-center rounded-[0.5rem] text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 [&>svg:not([class*='opacity-']),&>[data-slot=central-icon]:not([class*='opacity-'])]:opacity-80 [&>svg,&>[data-slot=central-icon]]:pointer-events-none [&>svg,&>[data-slot=central-icon]]:shrink-0";
const COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME =
  `${COMPOSER_PICKER_MENU_OPTION_CLASS_NAME} grid in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)]`;

const Select = SelectPrimitive.Root;
type SelectPopupSurface = "default" | "composer" | "settings";
const SelectPopupSurfaceContext = React.createContext<SelectPopupSurface>("default");

const selectTriggerVariants = cva(
  "relative inline-flex cursor-pointer select-none items-center justify-between gap-2 border rounded-md text-left text-[length:var(--app-font-size-ui,12px)] outline-none transition-[color,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-[length:var(--app-font-size-ui,12px)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      variant: {
        default:
          "w-full min-w-36 border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] text-[var(--color-text-foreground)] ring-[color:var(--color-border-focus)]/16 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-[color:var(--color-border-focus)] focus-visible:ring-2 aria-invalid:border-destructive/30 focus-visible:aria-invalid:border-destructive/50 focus-visible:aria-invalid:ring-destructive/12 dark:aria-invalid:ring-destructive/20 [&_svg:not([class*='opacity-'])]:opacity-80",
        ghost:
          "border-transparent text-[var(--color-text-foreground-secondary)] focus-visible:ring-1 focus-visible:ring-[color:var(--color-border-focus)]/60 data-pressed:bg-[var(--color-background-elevated-secondary)] [:hover,[data-pressed]]:bg-[var(--color-background-elevated-secondary)] [:hover,[data-pressed]]:text-[var(--color-text-foreground)]",
      },
      size: {
        default: "min-h-9 px-[calc(--spacing(3)-1px)] sm:min-h-8",
        lg: "min-h-10 px-[calc(--spacing(3)-1px)] sm:min-h-9",
        sm: "min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7",
        xs: "h-7 gap-1 rounded-sm px-[calc(--spacing(2)-1px)] text-[length:var(--app-font-size-ui-sm,11px)] sm:h-6 sm:text-[length:var(--app-font-size-ui-xs,10px)]",
      },
    },
  },
);

interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  variant?: VariantProps<typeof selectTriggerVariants>["variant"];
}

function SelectButton({ className, size, variant, render, children, ...props }: SelectButtonProps) {
  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">{children}</span>
        {variant === "ghost" ? (
          <IconChevronDown className="size-3 opacity-50" />
        ) : (
          <IconSelector className="-me-1 size-4.5 opacity-80 sm:size-4" />
        )}
      </>
    ),
    className: cn(selectTriggerVariants({ size, variant }), "min-w-0", className),
    "data-slot": "select-button",
    type: render ? undefined : "button",
  } as useRender.ComponentProps<"button">;
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ size, variant }), className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <IconChevronDown className="size-3 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate data-placeholder:text-muted-foreground", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectPopup({
  className,
  shellClassName,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  surface = "default",
  ...props
}: SelectPrimitive.Popup.Props & {
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
  surface?: SelectPopupSurface;
  shellClassName?: string;
}) {
  const isComposerLikeSurface = surface === "composer" || surface === "settings";
  const viewportClassName = isComposerLikeSurface
    ? cn(
        COMPOSER_PICKER_MENU_POPUP_VIEWPORT_CLASS_NAME,
        surface === "settings"
          ? cn(APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME, "rounded-lg", COMPOSER_SURFACE_SHADOW_CLASS_NAME)
          : COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME,
        shellClassName,
      )
    : cn(
        APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME,
        "relative min-w-(--anchor-width) max-h-[min(var(--available-height),28rem)]",
      );
  const listClassName = isComposerLikeSurface
    ? cn(COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME, "max-h-[min(var(--available-height),28rem)]", className)
    : cn("max-h-[min(var(--available-height),28rem)] overflow-y-auto overscroll-contain p-1", className);
  return (
    <SelectPopupSurfaceContext.Provider value={surface}>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align={align}
          alignItemWithTrigger={alignItemWithTrigger}
          alignOffset={alignOffset}
          anchor={anchor}
          className="z-50 select-none"
          data-slot="select-positioner"
          side={side}
          sideOffset={sideOffset}
        >
          <SelectPrimitive.Popup
            className={cn("origin-(--transform-origin)", isComposerLikeSurface ? "text-[var(--color-text-foreground)]" : "text-foreground")}
            data-slot="select-popup"
            {...props}
          >
            <SelectPrimitive.ScrollUpArrow className="top-0 z-50 flex h-6 w-full cursor-default items-center justify-center" data-slot="select-scroll-up-arrow">
              <IconChevronUp className="relative size-4.5 sm:size-4" />
            </SelectPrimitive.ScrollUpArrow>
            <div className={viewportClassName}>
              <SelectPrimitive.List
                className={cn(listClassName, isComposerLikeSurface ? "relative z-1" : null)}
                data-slot={isComposerLikeSurface ? "menu-popup-body" : "select-list"}
              >
                {children}
              </SelectPrimitive.List>
            </div>
            <SelectPrimitive.ScrollDownArrow className="bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center" data-slot="select-scroll-down-arrow">
              <IconChevronDown className="relative size-4.5 sm:size-4" />
            </SelectPrimitive.ScrollDownArrow>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPopupSurfaceContext.Provider>
  );
}

const selectItemDefaultClassName =
  "grid min-h-[1.625rem] in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center gap-2 rounded-lg py-px text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 sm:min-h-6 [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0";

function SelectItem({
  className,
  children,
  hideIndicator = false,
  ...props
}: SelectPrimitive.Item.Props & { hideIndicator?: boolean }) {
  const popupSurface = React.useContext(SelectPopupSurfaceContext);
  const optionBaseClassName =
    popupSurface === "composer" ? COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME : selectItemDefaultClassName;
  return (
    <SelectPrimitive.Item
      className={cn(
        optionBaseClassName,
        hideIndicator ? "grid-cols-[1fr] ps-3 pe-3" : "grid-cols-[1fr_auto] gap-3 px-2.5",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="col-start-1 min-w-0" data-slot="select-item-text">
        {children}
      </SelectPrimitive.ItemText>
      {hideIndicator ? null : (
        <SelectPrimitive.ItemIndicator className="col-start-2 justify-self-end" data-slot="select-item-indicator">
          <svg className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
          </svg>
        </SelectPrimitive.ItemIndicator>
      )}
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator className={cn("mx-2 my-1 h-px bg-border", className)} data-slot="select-separator" {...props} />;
}
function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}
function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel className="px-2 py-1.5 font-medium text-muted-foreground text-[length:var(--app-font-size-ui-xs,10px)]" data-slot="select-group-label" {...props} />;
}

export {
  Select,
  SelectTrigger,
  SelectButton,
  selectTriggerVariants,
  SelectValue,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectItem,
  SelectSeparator,
  SelectGroup,
  SelectGroupLabel,
};
