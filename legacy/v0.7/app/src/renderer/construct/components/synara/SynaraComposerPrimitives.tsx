"use client";

// Literal Synara composer primitives, copied from:
// apps/web/src/components/ui/button.tsx
// apps/web/src/components/ui/menu.tsx
// apps/web/src/components/chat/ComposerPickerMenuPopup.tsx
// Only import paths are adapted to Construct's vendored boundary.

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { IconChevronRight } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const SWITCH_TRACK_CLASS_NAME =
  "inline-flex h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2)] shrink-0 cursor-pointer items-center rounded-full border p-px outline-none transition-[background-color,box-shadow,border-color] duration-200 [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-[color:var(--color-text-accent)] data-checked:bg-[var(--color-text-accent)] data-unchecked:border-[color:color-mix(in_srgb,var(--color-text-foreground)_14%,transparent)] data-unchecked:bg-[color-mix(in_srgb,var(--color-text-foreground)_20%,var(--color-background-control-opaque))] data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]";
const SWITCH_THUMB_CLASS_NAME =
  "pointer-events-none block aspect-square h-full origin-left translate-x-0 rounded-full bg-white shadow-sm ring-1 ring-black/5 will-change-transform [transition:translate_.2s_ease-out,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]";

const APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME =
  "relative overflow-hidden border border-border bg-popover/70 text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150";
const APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME =
  `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} rounded-2xl shadow-xl`;
const COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME =
  `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} border border-border rounded-[0.65rem] shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]`;
const COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME =
  "relative z-1 w-full min-w-0 overflow-y-auto overscroll-contain composer-picker-scroll";
const COMPOSER_PICKER_MENU_OPTION_CLASS_NAME =
  "[&>svg,&>[data-slot=central-icon]]:-mx-0.5 flex cursor-default select-none items-center rounded-[0.5rem] text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 [&>svg:not([class*='opacity-']),&>[data-slot=central-icon]:not([class*='opacity-'])]:opacity-80 [&>svg,&>[data-slot=central-icon]]:pointer-events-none [&>svg,&>[data-slot=central-icon]]:shrink-0";

function extendButtonIconChildSelectors(className: string): string {
  let result = className;
  result = result.replace(
    /\[&_svg:not\(\[class\*='opacity-'\]\)\]:([^\s"']+)/g,
    (match, util) =>
      `${match} [&_[data-slot=central-icon]:not([class*='opacity-'])]:${util}`,
  );
  result = result.replace(
    /((?:sm:|not-in-data-\[slot=input-group\]:)?\[&_svg:not\(\[class\*='size-'\]\)\]:[^\s"']+)/g,
    (match) => {
      const central = match.replace("[&_svg:not", "[&_[data-slot=central-icon]:not");
      return `${match} ${central}`;
    },
  );
  result = result.replace(
    /\[&_svg\]:([a-z0-9\-/[\].]+)/g,
    (_match, util) => `[&_svg,&_[data-slot=central-icon]]:${util}`,
  );
  return result;
}

const headerButtonDarkBorderClassName =
  "dark:border-[color:color-mix(in_srgb,var(--color-border)_80%,transparent)]";
const buttonVariants = cva(
  extendButtonIconChildSelectors(
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-[length:var(--app-font-size-ui,12px)] outline-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 sm:text-[length:var(--app-font-size-ui,12px)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        "icon-sm": "size-8 sm:size-7",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
      },
      variant: {
        chrome:
          "border-transparent bg-transparent text-[var(--color-text-foreground-secondary)] focus-visible:ring-[color:var(--color-border-focus)]/60 focus-visible:ring-offset-0 [:hover,[data-pressed]]:bg-[var(--color-background-elevated-secondary)] [:hover,[data-pressed]]:text-[var(--color-text-foreground)] data-pressed:bg-[var(--color-background-elevated-secondary)] data-pressed:text-[var(--color-text-foreground)]",
        default:
          "border-transparent bg-primary text-primary-foreground [:hover,[data-pressed]]:bg-primary/90",
        "chrome-outline": extendButtonIconChildSelectors(
          `border-[color:var(--color-border)] bg-transparent text-[var(--color-text-foreground)] focus-visible:ring-[color:var(--color-border-focus)]/60 [:hover,[data-pressed]]:bg-secondary ${headerButtonDarkBorderClassName} dark:[:hover,[data-pressed]]:bg-secondary [&_svg]:mx-0`,
        ),
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

export const SynaraButton = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, render, ...props },
  ref,
) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";
  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    ref,
    type: typeValue,
  } as useRender.ComponentProps<"button">;
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
});

export const Menu = MenuPrimitive.Root;

export function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  surface = "default",
  pickerSize,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  surface?: "default" | "composer";
  pickerSize?: "small" | "normal" | undefined;
}) {
  const popupSurfaceClassName =
    surface === "composer"
      ? COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME
      : APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME;
  const isComposerSurface = surface === "composer";
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className={cn("z-50 min-w-32", isComposerSurface ? undefined : className)}
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "relative flex origin-(--transform-origin) text-[var(--color-text-foreground)] outline-none focus:outline-none",
            isComposerSurface ? "min-w-0 max-w-[92vw]" : "w-full min-w-full",
            isComposerSurface ? className : null,
            popupSurfaceClassName,
          )}
          data-slot="menu-popup"
          {...props}
        >
          {surface === "composer" ? (
            <div
              className={cn(
                COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME,
                "relative z-1 max-h-(--available-height)",
              )}
              data-picker-size={pickerSize}
              data-slot="menu-popup-body"
            >
              {children}
            </div>
          ) : (
            <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
          )}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem(props: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      className={cn(
        COMPOSER_PICKER_MENU_OPTION_CLASS_NAME,
        "data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground",
        props.className,
      )}
      {...props}
      data-slot="menu-item"
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & { variant?: "default" | "switch" }) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        COMPOSER_PICKER_MENU_OPTION_CLASS_NAME,
        "grid in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] py-1 ps-2",
        variant === "switch"
          ? "grid-cols-[1fr_auto] gap-4 pe-1.5"
          : "grid-cols-[1fr_auto] gap-3 px-2.5",
        className,
      )}
      {...props}
      data-slot="menu-checkbox-item"
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className={cn(
              SWITCH_TRACK_CLASS_NAME,
              "inset-shadow-[0_1px_--theme(--color-black/4%)] [--thumb-size:--spacing(4)] focus-visible:ring-1 sm:[--thumb-size:--spacing(3)]",
            )}
            keepMounted
          >
            <span
              className={cn(
                SWITCH_THUMB_CLASS_NAME,
                "in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)]",
              )}
            />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <span className="col-start-1 min-w-0">{children}</span>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(COMPOSER_PICKER_MENU_OPTION_CLASS_NAME, "w-full min-w-0 px-2.5", className)}
      {...props}
      data-slot="menu-radio-item"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        {children}
        <MenuPrimitive.RadioItemIndicator className="ml-auto shrink-0">
          <svg className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
          </svg>
        </MenuPrimitive.RadioItemIndicator>
      </span>
    </MenuPrimitive.RadioItem>
  );
}

export function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        COMPOSER_PICKER_MENU_OPTION_CLASS_NAME,
        "data-popup-open:bg-[var(--color-background-button-secondary-hover)] data-popup-open:text-[var(--color-text-foreground)]",
        className,
      )}
      {...props}
      data-slot="menu-sub-trigger"
    >
      {children}
      <IconChevronRight className="-me-0.5 shrink-0" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function ComposerPickerMenuPopup({
  className,
  fixedWidth = false,
  ...props
}: React.ComponentProps<typeof MenuPopup> & { fixedWidth?: boolean }) {
  return (
    <MenuPopup
      surface="composer"
      pickerSize="normal"
      className={cn(
        fixedWidth
          ? "composer-picker-menu composer-picker-menu--normal composer-picker-menu-fixed"
          : "composer-picker-menu composer-picker-menu--normal",
        className,
      )}
      {...props}
    />
  );
}

export function ComposerPickerMenuSubPopup(props: React.ComponentProps<typeof MenuPopup>) {
  return (
    <MenuPopup
      surface="composer"
      pickerSize="normal"
      side="right"
      align="start"
      alignOffset={-5}
      className={cn("composer-picker-menu composer-picker-menu--normal", props.className)}
      {...props}
    />
  );
}
