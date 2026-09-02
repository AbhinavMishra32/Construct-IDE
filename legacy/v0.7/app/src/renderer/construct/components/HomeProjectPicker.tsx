// Synara ProjectPicker transplant. The Base UI combobox structure, trigger,
// panel shell, option rows, grouping, and folder glyph are copied from Synara.
// Only the project/native data sources are adapted to Construct.
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { homeDir } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useDeferredValue, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ProjectSummary } from "../types";
import { selectWorkspaceDirectory } from "../lib/bridge";
import { SynaraButton as Button } from "./synara/SynaraComposerPrimitives";

type FolderOption = {
  absolutePath: string;
  label: string;
  projectId: string | null;
};

function FolderClosed({ className }: { className?: string }) {
  const mask = 'url("/central-icons-reversed/folder-2.svg") center / contain no-repeat';
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      data-slot="central-icon"
      style={{ WebkitMask: mask, mask }}
    />
  );
}

function PickerTriggerButton({
  label,
  className,
  ...buttonProps
}: {
  label: ReactNode;
} & Omit<ComponentProps<typeof Button>, "children" | "size" | "variant">) {
  return (
    <Button
      {...buttonProps}
      size="sm"
      variant="chrome"
      className={cn(
        "min-w-0 justify-start overflow-hidden whitespace-nowrap px-1.5 text-[var(--color-text-foreground)] [&_svg]:mx-0",
        "text-[length:var(--app-font-size-ui-sm,11px)] text-[var(--color-text-foreground-secondary)] sm:text-[length:var(--app-font-size-ui-sm,11px)] font-normal hover:text-[var(--color-text-foreground)] data-pressed:text-[var(--color-text-foreground)]",
        "max-w-56 shrink sm:max-w-64 sm:px-1.5",
      )}
    >
      <span className="flex min-w-0 w-full items-center gap-1.5 overflow-hidden">
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
          <FolderClosed className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
    </Button>
  );
}

export function HomeProjectPicker({
  onOpenChange,
  onClearWorkspace,
  onSelectWorkspace,
  open,
  projects,
  selectedWorkspaceLabel,
  selectedWorkspacePath,
}: {
  onOpenChange: (open: boolean) => void;
  onClearWorkspace: () => void;
  onSelectWorkspace: (workspacePath: string, label: string) => void;
  open: boolean;
  projects: ProjectSummary[];
  selectedWorkspaceLabel?: string;
  selectedWorkspacePath?: string;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [isPicking, setIsPicking] = useState(false);
  const [isLoadingDirectories, setIsLoadingDirectories] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localFolders, setLocalFolders] = useState<FolderOption[]>([]);

  const activeFolders = useMemo<FolderOption[]>(
    () =>
      [...projects]
        .sort((left, right) => {
          const leftOpened = left.lastOpenedAt ? Date.parse(left.lastOpenedAt) : 0;
          const rightOpened = right.lastOpenedAt ? Date.parse(right.lastOpenedAt) : 0;
          return rightOpened - leftOpened;
        })
        .map((project) => ({
          absolutePath: project.workspacePath,
          label: project.title,
          projectId: project.id,
        })),
    [projects],
  );

  useEffect(() => {
    if (!open || localFolders.length > 0 || isLoadingDirectories) return;
    setIsLoadingDirectories(true);
    void homeDir()
      .then(async (root) => {
        const entries = await readDir(root);
        const activePaths = new Set(activeFolders.map((folder) => folder.absolutePath));
        setLocalFolders(
          entries
            .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
            .map((entry) => ({
              absolutePath: `${root.replace(/\/$/, "")}/${entry.name}`,
              label: entry.name,
              projectId: null,
            }))
            .filter((entry) => !activePaths.has(entry.absolutePath)),
        );
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load folders.");
      })
      .finally(() => setIsLoadingDirectories(false));
  }, [activeFolders, isLoadingDirectories, localFolders.length, open]);

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredActiveFolders = activeFolders.filter((folder) =>
    `${folder.label} ${folder.absolutePath}`.toLowerCase().includes(normalizedQuery),
  );
  const filteredLocalFolders = localFolders.filter((folder) =>
    `${folder.label} ${folder.absolutePath}`.toLowerCase().includes(normalizedQuery),
  );
  const selectablePaths = [...activeFolders, ...localFolders].map((folder) => folder.absolutePath);
  const filteredPaths = [...filteredActiveFolders, ...filteredLocalFolders].map(
    (folder) => folder.absolutePath,
  );

  async function handleAddNewProject() {
    if (isPicking) return;
    setIsPicking(true);
    setErrorMessage(null);
    try {
      const workspacePath = await selectWorkspaceDirectory();
      if (!workspacePath) return;
      onSelectWorkspace(workspacePath, workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Selected project");
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to open the folder picker.");
    } finally {
      setIsPicking(false);
    }
  }

  function selectFolder(folder: FolderOption) {
    onSelectWorkspace(folder.absolutePath, folder.label);
    onOpenChange(false);
  }

  const renderFolder = (folder: FolderOption, index: number) => (
    <ComboboxPrimitive.Item
      key={folder.absolutePath}
      index={index}
      value={folder.absolutePath}
      onClick={() => selectFolder(folder)}
      className={cn(
        "grid min-h-[1.625rem] in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-2.5 py-px text-base text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 sm:min-h-6 sm:text-sm",
        folder.absolutePath === selectedWorkspacePath &&
          "bg-[var(--color-background-elevated-secondary)]",
      )}
      data-slot="combobox-item"
    >
      <div className="col-start-1 col-span-full flex min-w-0 items-center gap-2">
        <FolderClosed className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{folder.label}</span>
      </div>
    </ComboboxPrimitive.Item>
  );

  return (
    <ComboboxPrimitive.Root
      items={selectablePaths}
      filteredItems={filteredPaths}
      autoHighlight
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setErrorMessage(null);
        }
      }}
      open={open}
    >
      <ComboboxPrimitive.Trigger
        render={<PickerTriggerButton label={selectedWorkspaceLabel ?? "Work in a project"} />}
        data-slot="combobox-trigger"
      />
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          className="z-50 select-none"
          data-slot="combobox-positioner"
          side="top"
          sideOffset={4}
        >
          <span className="relative flex max-h-full min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover/70 text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150">
            <ComboboxPrimitive.Popup
              className="flex max-h-[min(var(--available-height),23rem)] flex-1 flex-col text-foreground"
              data-slot="combobox-popup"
            >
              <div className="flex min-h-0 w-72 flex-col">
                <div className="sticky top-0 z-20 shrink-0 border-b border-border bg-[var(--composer-surface)] p-1">
                  <input
                    autoFocus
                    className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/55 focus:border-neutral-500/15"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search projects"
                    type="search"
                    value={query}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-0.5">
                  <ComboboxPrimitive.Empty className="not-empty:p-2 text-center text-base text-muted-foreground sm:text-sm">
                    {isLoadingDirectories
                      ? "Loading folders…"
                      : activeFolders.length === 0 && localFolders.length === 0
                        ? "No folders found"
                        : "No matches"}
                  </ComboboxPrimitive.Empty>
                  <ComboboxPrimitive.List className="not-empty:scroll-py-1 not-empty:px-1 not-empty:py-1">
                    {filteredActiveFolders.length > 0 ? (
                      <ComboboxPrimitive.Group className="[[role=group]+&]:mt-1.5">
                        <ComboboxPrimitive.GroupLabel className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                          Active folders
                        </ComboboxPrimitive.GroupLabel>
                        {filteredActiveFolders.map(renderFolder)}
                      </ComboboxPrimitive.Group>
                    ) : null}
                    {filteredActiveFolders.length > 0 && filteredLocalFolders.length > 0 ? (
                      <ComboboxPrimitive.Separator className="mx-2 my-1 h-px bg-border last:hidden" />
                    ) : null}
                    {filteredLocalFolders.length > 0 ? (
                      <ComboboxPrimitive.Group className="[[role=group]+&]:mt-1.5">
                        <ComboboxPrimitive.GroupLabel className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                          Folders on this Mac
                        </ComboboxPrimitive.GroupLabel>
                        {filteredLocalFolders.map((folder, index) =>
                          renderFolder(folder, filteredActiveFolders.length + index),
                        )}
                      </ComboboxPrimitive.Group>
                    ) : null}
                  </ComboboxPrimitive.List>
                </div>
                <div className="border-t p-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleAddNewProject()}
                    disabled={isPicking}
                  >
                    <IconPlus className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="truncate">
                      {isPicking ? "Opening folder picker..." : "Add new project"}
                    </span>
                  </button>
                  {selectedWorkspacePath ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
                      onClick={() => {
                        onClearWorkspace();
                        onOpenChange(false);
                      }}
                    >
                      <IconX className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span className="truncate">Don&apos;t work in a project</span>
                    </button>
                  ) : null}
                  {errorMessage ? (
                    <div className="px-2 pb-1 text-destructive text-xs">{errorMessage}</div>
                  ) : null}
                </div>
              </div>
            </ComboboxPrimitive.Popup>
          </span>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
