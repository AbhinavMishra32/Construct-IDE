import { useState } from "react";
import {
  FilePlus,
  FolderOpen,
  GitBranch,
  MagicWand,
  ProjectorScreenChart
} from "@phosphor-icons/react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogSection
} from "@opaline/ui";

import { getSettings, openConstructFile, selectWorkspaceDirectory } from "../lib/bridge";
import { parseConstructSource } from "../lib/parser";
import { createProjectFromConstructFile } from "../lib/projectStore";
import type { ConstructProgram, ProjectRecord } from "../types";

type SelectedConstructFile = {
  path: string;
  source: string;
  program: ConstructProgram;
};

export function NewProjectDialog({
  open,
  onOpenChange,
  onProjectCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: (project: ProjectRecord) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<SelectedConstructFile | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [initializeGit, setInitializeGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseConstructFile() {
    try {
      setBusy(true);
      setError(null);
      const file = await openConstructFile();
      if (!file) {
        return;
      }

      const program = parseConstructSource(file.source);
      setSelectedFile({
        path: file.path,
        source: file.source,
        program
      });
      const settings = await getSettings().catch(() => null);
      setWorkspacePath(suggestWorkspacePath(file.path, program.id, settings?.workspaceRoot));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chooseWorkspaceDirectory() {
    const directory = await selectWorkspaceDirectory({
      defaultPath: workspacePath || (selectedFile ? suggestWorkspacePath(selectedFile.path, selectedFile.program.id) : undefined)
    });

    if (directory) {
      setWorkspacePath(directory);
    }
  }

  async function createProject() {
    if (!selectedFile || !workspacePath.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const project = await createProjectFromConstructFile({
        initializeGit,
        source: selectedFile.source,
        sourcePath: selectedFile.path,
        workspacePath: workspacePath.trim()
      });
      onProjectCreated(project);
      onOpenChange(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSelectedFile(null);
    setWorkspacePath("");
    setInitializeGit(true);
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          reset();
        }
      }}
    >
      <DialogContent size="wide">
        <DialogHeader
          icon={<ProjectorScreenChart size={20} weight="duotone" />}
          title="New project"
          subtitle="Start from a human-readable .construct file and materialize it into a real local workspace."
        />
        <DialogBody className="new-project-dialog">
          <DialogSection className="new-project-dialog__choices">
            <button className="new-project-choice is-disabled" type="button" disabled>
              <span><MagicWand size={20} weight="duotone" /></span>
              <strong>Agent project</strong>
              <small>Coming later. The runtime comes first.</small>
            </button>
            <button className="new-project-choice" type="button" disabled={busy} onClick={() => void chooseConstructFile()}>
              <span><FilePlus size={20} weight="duotone" /></span>
              <strong>Open .construct file</strong>
              <small>Use a local project program as the source of truth.</small>
            </button>
          </DialogSection>

          {selectedFile ? (
            <DialogSection className="new-project-dialog__settings">
              <div className="new-project-summary">
                <span className="new-project-summary__icon"><FilePlus size={18} weight="duotone" /></span>
                <div>
                  <strong>{selectedFile.program.title}</strong>
                  <small>{selectedFile.path}</small>
                </div>
              </div>

              <label className="construct-field">
                <span>Workspace folder</span>
                <div className="construct-path-input">
                  <input
                    value={workspacePath}
                    onChange={(event) => setWorkspacePath(event.target.value)}
                    placeholder="Choose where project files will be saved"
                  />
                  <button type="button" onClick={() => void chooseWorkspaceDirectory()}>
                    <FolderOpen size={16} weight="duotone" />
                    Browse
                  </button>
                </div>
              </label>

              <label className="construct-checkbox">
                <input
                  type="checkbox"
                  checked={initializeGit}
                  onChange={(event) => setInitializeGit(event.target.checked)}
                />
                <span><GitBranch size={16} weight="duotone" /> Initialize a Git repository in this workspace</span>
              </label>
            </DialogSection>
          ) : null}

          {error ? <div className="construct-dialog-error">{error}</div> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selectedFile || !workspacePath.trim() || busy} onClick={() => void createProject()}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function suggestWorkspacePath(sourcePath: string, projectId: string, workspaceRoot?: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  if (workspaceRoot && normalized.includes("/app/src/")) {
    return `${workspaceRoot.replace(/\/+$/, "")}/${projectId}`;
  }

  const lastSlash = normalized.lastIndexOf("/");
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
  return directory ? `${directory}/${projectId}` : projectId;
}
