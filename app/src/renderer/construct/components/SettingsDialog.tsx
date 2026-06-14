import { useEffect, useState } from "react";
import { FolderOpen, GearSix } from "@phosphor-icons/react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader
          icon={<GearSix size={20} weight="duotone" />}
          title="Project settings"
          subtitle="Choose where Construct keeps project workspaces. Existing workspaces are copied into the new root."
        />
        <DialogBody className="settings-dialog">
          <DialogSection>
            <label className="construct-field">
              <span>Default workspace location</span>
              <div className="construct-path-input">
                <input
                  value={workspaceRoot}
                  onChange={(event) => setWorkspaceRootValue(event.target.value)}
                  placeholder="Choose a project folder"
                />
                <button type="button" onClick={() => void chooseRoot()}>
                  <FolderOpen size={16} weight="duotone" />
                  Browse
                </button>
              </div>
            </label>
          </DialogSection>
          <DialogSection>
            <label className="construct-field">
              <span>Color theme</span>
              <select
                value={theme}
                onChange={(event) => onThemeChange(event.target.value as any)}
                className="construct-select"
              >
                <option value="system">System default</option>
                <option value="dark">Dark theme</option>
                <option value="light">Light theme</option>
              </select>
            </label>
          </DialogSection>
          {error ? <div className="construct-dialog-error">{error}</div> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!workspaceRoot.trim() || busy} onClick={() => void save()}>
            Save location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
