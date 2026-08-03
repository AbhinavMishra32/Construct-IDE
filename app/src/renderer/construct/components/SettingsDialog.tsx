import { useEffect, useState } from "react";
import { FolderOpen, GearSix } from "@phosphor-icons/react";

import { Button, Input } from "@opaline/ui";

import {
  SparButton,
  SparDialog,
  SparDialogContent,
  SparDialogDescription,
  SparDialogFooter,
  SparDialogHeader,
  SparDialogTitle,
} from "../../components/spar";

import {
  getSettings,
  selectWorkspaceDirectory,
  setWorkspaceRoot
} from "../lib/bridge";
import type { ProjectSummary } from "../types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

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
    <SparDialog open={open} onOpenChange={onOpenChange}>
      <SparDialogContent className="sm:max-w-[30rem]">
        <SparDialogHeader>
          {/* 28px tile at the control radius, sized to the title beside it rather
              than standing over it — a 36px icon above a 16px heading is an
              illustration, and this is a label. */}
          <div className="mb-0.5 grid size-7 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
            <GearSix size={16} weight="duotone" />
          </div>
          <SparDialogTitle>Project settings</SparDialogTitle>
          <SparDialogDescription>
            Choose where Construct keeps project workspaces. Existing workspaces are copied into the new root.
          </SparDialogDescription>
        </SparDialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-ui font-medium">Default workspace location</span>
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1"
                value={workspaceRoot}
                onChange={(event) => setWorkspaceRootValue(event.target.value)}
                placeholder="Choose a project folder"
              />
              <Button variant="secondary" type="button" onClick={() => void chooseRoot()}>
                <FolderOpen size={14} weight="duotone" />
                Browse
              </Button>
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-ui font-medium">Color theme</span>
            <Select value={theme} onValueChange={(value) => onThemeChange(value as "light" | "dark" | "system")}>
              <SelectTrigger className="h-8 w-full text-ui"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System default</SelectItem>
                <SelectItem value="dark">Dark theme</SelectItem>
                <SelectItem value="light">Light theme</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {error ? (
            <p className="rounded-[var(--radius-xl)] border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui leading-[1.6] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <SparDialogFooter>
          <SparButton onClick={() => onOpenChange(false)} size="sm" variant="secondary">
            Cancel
          </SparButton>
          <SparButton disabled={!workspaceRoot.trim() || busy} onClick={() => void save()} size="sm">
            Save location
          </SparButton>
        </SparDialogFooter>
      </SparDialogContent>
    </SparDialog>
  );
}
