// Literal component bodies copied from Synara's ComposerExtrasMenu and
// RuntimeUsageControls. Construct adapters supply state through props only.

import { memo, useId, useRef, type ChangeEvent } from "react";
import { GoTasklist } from "react-icons/go";
import { HiOutlineHandRaised } from "react-icons/hi2";
import { IconChevronDown, IconPaperclip, IconPlus } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
  SynaraButton as Button,
} from "./SynaraComposerPrimitives";

export type SynaraInteractionMode = "default" | "plan";
export type SynaraRuntimeMode = "full-access" | "approval-required";

export const ComposerExtrasMenu = memo(function ComposerExtrasMenu(props: {
  interactionMode: SynaraInteractionMode;
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
  onAddPhotos: (files: File[]) => void;
  onToggleFastMode: () => void;
  onSetPlanMode: (enabled: boolean) => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same image twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddPhotos(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-photo-input"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="chrome"
              className="shrink-0 rounded-md"
              aria-label="Composer extras"
            />
          }
        >
          <IconPlus aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="start">
          <MenuItem onClick={() => fileInputRef.current?.click()}>
            <IconPaperclip className="size-4 shrink-0" />
            Add image
          </MenuItem>

          <MenuSeparator />
          <MenuCheckboxItem
            checked={props.interactionMode === "plan"}
            variant="switch"
            onCheckedChange={(checked) => {
              props.onSetPlanMode(checked === true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <GoTasklist className="size-4 shrink-0" />
              Plan mode
            </span>
          </MenuCheckboxItem>

          {props.supportsFastMode ? (
            <>
              <MenuSeparator />
              <MenuSub>
                <MenuSubTrigger>Fast</MenuSubTrigger>
                <ComposerPickerMenuSubPopup>
                  <MenuRadioGroup
                    value={props.fastModeEnabled ? "fast" : "normal"}
                    onValueChange={(value) => {
                      const shouldEnableFast = value === "fast";
                      if (shouldEnableFast === props.fastModeEnabled) return;
                      props.onToggleFastMode();
                    }}
                  >
                    <MenuRadioItem value="normal">Default</MenuRadioItem>
                    <MenuRadioItem value="fast">Fast</MenuRadioItem>
                  </MenuRadioGroup>
                </ComposerPickerMenuSubPopup>
              </MenuSub>
            </>
          ) : null}
        </ComposerPickerMenuPopup>
      </Menu>
    </>
  );
});

function CentralShieldIcon({ className }: { className?: string }) {
  const mask = 'url("/central-icons-reversed/shield-access.svg") center / contain no-repeat';
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      data-slot="central-icon"
      style={{ WebkitMask: mask, mask }}
    />
  );
}

export function RuntimeUsageControls({
  runtimeMode,
  onRuntimeModeChange,
  className,
  hideLabel = false,
}: {
  runtimeMode?: SynaraRuntimeMode;
  onRuntimeModeChange?: (mode: SynaraRuntimeMode) => void;
  className?: string;
  hideLabel?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[var(--color-text-foreground-secondary)]",
        className,
      )}
    >
      {runtimeMode && onRuntimeModeChange ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="chrome"
                className={cn(
                  "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 [&_svg]:mx-0 sm:px-2.5",
                  "text-[length:var(--app-font-size-ui-sm,11px)] text-[var(--color-text-foreground-secondary)] sm:text-[length:var(--app-font-size-ui-sm,11px)] font-normal hover:text-[var(--color-text-foreground)] data-pressed:text-[var(--color-text-foreground)]",
                  runtimeMode === "full-access" &&
                    "text-[var(--runtime-full-access-accent)] hover:opacity-85",
                )}
                title={
                  runtimeMode === "full-access"
                    ? "Unrestricted workspace — click to change"
                    : "Learning guardrails — click to change"
                }
              />
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {runtimeMode === "full-access" ? (
                <HiOutlineHandRaised className="size-3.5 shrink-0" />
              ) : (
                <CentralShieldIcon className="size-3.5 shrink-0" />
              )}
              <span className={cn("truncate", hideLabel ? "sr-only" : "@max-[480px]:sr-only")}>
                {runtimeMode === "full-access" ? "Unrestricted workspace" : "Learning guardrails"}
              </span>
              <IconChevronDown
                className={cn(
                  "size-3 shrink-0 opacity-70",
                  hideLabel ? "hidden" : "@max-[480px]:hidden",
                )}
              />
            </span>
          </MenuTrigger>
          <MenuPopup align="start" side="top" className="min-w-44">
            <MenuRadioGroup
              value={runtimeMode}
              onValueChange={(value) => {
                if (
                  !value ||
                  (value !== "full-access" && value !== "approval-required") ||
                  value === runtimeMode
                ) {
                  return;
                }
                onRuntimeModeChange(value);
              }}
            >
              <MenuRadioItem
                value="approval-required"
                className="data-checked:text-[var(--runtime-full-access-accent)]"
              >
                <span className="inline-flex items-center gap-2">
                  <CentralShieldIcon className="size-4 shrink-0" />
                  Learning guardrails
                </span>
              </MenuRadioItem>
              <MenuRadioItem value="full-access">
                <span className="inline-flex items-center gap-2">
                  <HiOutlineHandRaised className="size-4 shrink-0" />
                  Unrestricted workspace
                </span>
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}
