import * as RadixContextMenu from "@radix-ui/react-context-menu";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import "./context-menu.css";

export const ContextMenu = RadixContextMenu.Root;
export const ContextMenuTrigger = RadixContextMenu.Trigger;
export const ContextMenuPortal = RadixContextMenu.Portal;
export const ContextMenuGroup = RadixContextMenu.Group;
export const ContextMenuSub = RadixContextMenu.Sub;
export const ContextMenuRadioGroup = RadixContextMenu.RadioGroup;

export const ContextMenuContent = forwardRef<
  ElementRef<typeof RadixContextMenu.Content>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Content>
>(function ContextMenuContent({ className, collisionPadding = 6, ...props }, ref) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        ref={ref}
        className={["codex-context-menu-content", className].filter(Boolean).join(" ")}
        collisionPadding={collisionPadding}
        {...props}
      />
    </RadixContextMenu.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  ElementRef<typeof RadixContextMenu.Item>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Item>
>(function ContextMenuItem({ className, ...props }, ref) {
  return (
    <RadixContextMenu.Item
      ref={ref}
      className={["codex-context-menu-item", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});

export const ContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof RadixContextMenu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.CheckboxItem>
>(function ContextMenuCheckboxItem({ children, className, ...props }, ref) {
  return (
    <RadixContextMenu.CheckboxItem
      ref={ref}
      className={["codex-context-menu-item codex-context-menu-checkbox-item", className].filter(Boolean).join(" ")}
      {...props}
    >
      <RadixContextMenu.ItemIndicator className="codex-context-menu-item-indicator">✓</RadixContextMenu.ItemIndicator>
      {children}
    </RadixContextMenu.CheckboxItem>
  );
});

export const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof RadixContextMenu.SubTrigger>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.SubTrigger>
>(function ContextMenuSubTrigger({ children, className, ...props }, ref) {
  return (
    <RadixContextMenu.SubTrigger
      ref={ref}
      className={["codex-context-menu-item codex-context-menu-sub-trigger", className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="codex-context-menu-item-label">{children}</span>
      <span className="codex-context-menu-chevron">›</span>
    </RadixContextMenu.SubTrigger>
  );
});

export const ContextMenuSubContent = forwardRef<
  ElementRef<typeof RadixContextMenu.SubContent>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.SubContent>
>(function ContextMenuSubContent({ className, collisionPadding = 6, ...props }, ref) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.SubContent
        ref={ref}
        className={["codex-context-menu-content", className].filter(Boolean).join(" ")}
        collisionPadding={collisionPadding}
        {...props}
      />
    </RadixContextMenu.Portal>
  );
});

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof RadixContextMenu.Separator>,
  ComponentPropsWithoutRef<typeof RadixContextMenu.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <RadixContextMenu.Separator
      ref={ref}
      className={["codex-context-menu-separator", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});

