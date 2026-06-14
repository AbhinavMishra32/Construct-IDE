import { useEffect, useState } from "react";
import { FolderOpen, GearSix } from "@phosphor-icons/react";

import {
  Button,
  Input,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle
} from "@opaline/ui/v2";

import {
  getSettings,
  selectWorkspaceDirectory,
  setWorkspaceRoot
} from "../lib/bridge";
import type { ProjectSummary } from "../types";

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  onProjectsChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  onProjectsChange: (projects: ProjectSummary[]) => void;
}) {
  const [workspaceRoot, setWorkspaceRootValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    void getSettings()
      .then((settings) => setWorkspaceRootValue(settings.workspaceRoot))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [open]);

  async function chooseRoot() {
    const directory = await selectWorkspaceDirectory({
      defaultPath: workspaceRoot
    });

    if (directory) {
      setWorkspaceRootValue(directory);
    }
  }

  async function save() {
    if (!workspaceRoot.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const result = await setWorkspaceRoot({
        workspaceRoot: workspaceRoot.trim()
      });
      onProjectsChange(result.projects);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <ShadcnDialogContent className="sm:max-w-lg">
        <ShadcnDialogHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground"><GearSix size={20} weight="duotone" /></div>
          <ShadcnDialogTitle>Project settings</ShadcnDialogTitle>
          <ShadcnDialogDescription>Choose where Construct keeps project workspaces. Existing workspaces are copied into the new root.</ShadcnDialogDescription>
        </ShadcnDialogHeader>
        <div className="space-y-5 py-2">
          <label className="space-y-2">
              <span className="text-sm font-medium">Default workspace location</span>
              <div className="flex gap-2">
                <Input className="min-w-0 flex-1"
                  value={workspaceRoot}
                  onChange={(event) => setWorkspaceRootValue(event.target.value)}
                  placeholder="Choose a project folder"
                />
                <Button variant="secondary" type="button" onClick={() => void chooseRoot()}>
                  <FolderOpen size={16} weight="duotone" />
                  Browse
                </Button>
              </div>
          </label>
          <label className="space-y-2">
              <span className="text-sm font-medium">Color theme</span>
              <select
                value={theme}
                onChange={(event) => onThemeChange(event.target.value as any)}
                className="flex h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="system">System default</option>
                <option value="dark">Dark theme</option>
                <option value="light">Light theme</option>
              </select>
          </label>
          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
        </div>
        <ShadcnDialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!workspaceRoot.trim() || busy} onClick={() => void save()}>
            Save location
          </Button>
        </ShadcnDialogFooter>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}
