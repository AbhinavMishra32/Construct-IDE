import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, FileBrowserPanel, Pill, StatusDot } from "@/components/open-shell";

import { EditorPane } from "./EditorPane";
import { FileTree } from "./FileTree";
import { GuidePanel } from "./GuidePanel";
import { StepList } from "./StepList";
import {
  listFiles,
  readFile,
  updateProject,
  writeFile
} from "../lib/bridge";
import { currentBlock, nextPosition, totalBlocks } from "../lib/runtime";
import type {
  EditBlock,
  ProjectRecord,
  WorkspaceTreeNode
} from "../types";

export function Workspace({
  project,
  onBack,
  onGuidePanelChange,
  onProjectChange,
  onRunCommand
}: {
  project: ProjectRecord;
  onBack: () => void;
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onProjectChange: (project: ProjectRecord) => void;
  onRunCommand: (command: string, cwd: string) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [activeFileContent, setActiveFileContent] = useState("");
  const block = currentBlock(project);
  const activeEdit = block?.kind === "edit" ? block : null;
  const relevantPath = activeEdit?.path ?? null;
  const activeFilePath = project.activeFilePath ?? relevantPath ?? project.program.files[0]?.path ?? null;
  const editProgress = activeEdit ? project.typingProgress[activeEdit.id] ?? 0 : 0;
  const editComplete = activeEdit ? editProgress >= activeEdit.content.length : false;
  const editAnchor = activeEdit ? project.editAnchors[activeEdit.id] ?? "" : "";

  const projectProgressLabel = useMemo(() => {
    const completed = Object.values(project.completedBlocks).filter(Boolean).length;
    return `${completed}/${totalBlocks(project.program)} blocks`;
  }, [project.completedBlocks, project.program]);

  useEffect(() => {
    void refreshTree();
  }, [project.id]);

  useEffect(() => {
    if (!activeFilePath) {
      setActiveFileContent("");
      return;
    }

    void openFile(activeFilePath);
  }, [activeFilePath, project.id]);

  useEffect(() => {
    if (!activeEdit) {
      return;
    }

    void prepareEdit(activeEdit);
  }, [activeEdit?.id, project.id]);

  useEffect(() => {
    onGuidePanelChange(
      <GuidePanel
        project={project}
        block={block}
        editComplete={editComplete}
        onNext={() => void handleNext()}
        onRunCommand={onRunCommand}
      />
    );

    return () => onGuidePanelChange(null);
  }, [block, editComplete, onGuidePanelChange, onRunCommand, project]);

  async function refreshTree() {
    setTree(await listFiles(project.id));
  }

  async function persistProject(patch: Parameters<typeof updateProject>[0]["patch"]) {
    onProjectChange(await updateProject({ id: project.id, patch }));
  }

  async function openFile(path: string) {
    const file = await readMaybeFile(path);
    setActiveFileContent(file);
    await persistProject({ activeFilePath: path });
  }

  async function prepareEdit(edit: EditBlock) {
    const existing = await readMaybeFile(edit.path);
    const anchor =
      project.editAnchors[edit.id] ??
      (edit.mode === "append" && existing ? `${existing}${existing.endsWith("\n") ? "" : "\n"}` : "");

    if (!project.editAnchors[edit.id]) {
      await persistProject({
        activeFilePath: edit.path,
        editAnchors: {
          ...project.editAnchors,
          [edit.id]: anchor
        }
      });
    } else if (project.activeFilePath !== edit.path) {
      await persistProject({ activeFilePath: edit.path });
    }

    await writeFile({
      projectId: project.id,
      path: edit.path,
      content: `${anchor}${edit.content.slice(0, project.typingProgress[edit.id] ?? 0)}`
    });
    setActiveFileContent(`${anchor}${edit.content.slice(0, project.typingProgress[edit.id] ?? 0)}`);
    await refreshTree();
  }

  async function readMaybeFile(path: string): Promise<string> {
    try {
      return (await readFile({ projectId: project.id, path })).content;
    } catch {
      return "";
    }
  }

  async function handleFreeEdit(content: string) {
    if (!activeFilePath) {
      return;
    }

    setActiveFileContent(content);
    await writeFile({ projectId: project.id, path: activeFilePath, content });
    await refreshTree();
  }

  async function handleGuidedProgress(progress: number) {
    if (!activeEdit) {
      return;
    }

    const nextContent = `${editAnchor}${activeEdit.content.slice(0, progress)}`;
    setActiveFileContent(nextContent);
    await writeFile({
      projectId: project.id,
      path: activeEdit.path,
      content: nextContent
    });
    await persistProject({
      typingProgress: {
        ...project.typingProgress,
        [activeEdit.id]: progress
      }
    });
    await refreshTree();
  }

  async function handleNext() {
    if (!block) {
      return;
    }

    const position = nextPosition(project);
    await persistProject({
      ...position,
      completedBlocks: {
        ...project.completedBlocks,
        [block.id]: true
      }
    });
  }

  return (
    <div className="workspace workspace--shell">
      <FileBrowserPanel
        fileName={activeFilePath ?? "Select a file"}
        breadcrumbs={activeFilePath ? activeFilePath.split("/") : [project.title]}
        headerActions={
          <div className="workspace__browser-actions">
            <Pill>{project.progress}% complete</Pill>
            {project.completedAt ? (
              <span>
                <CheckCircle2Icon size={15} />
                Finished
              </span>
            ) : (
              <span>
                <StatusDot tone="green" />
                Active project
              </span>
            )}
          </div>
        }
        pathActions={
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to dashboard">
            <ArrowLeftIcon size={15} />
          </Button>
        }
        toolbar={
          <div className="workspace__browser-toolbar">
            <div>
              <h1>{project.title}</h1>
              <p>{projectProgressLabel}</p>
            </div>
          </div>
        }
        sidePanel={
          <aside className="workspace__file-rail">
            <div className="workspace-panel">
              <div className="workspace-panel__header">Files</div>
              <FileTree
                nodes={tree}
                activePath={activeFilePath}
                relevantPath={relevantPath}
                onOpenFile={(path) => void openFile(path)}
              />
            </div>
            <div className="workspace-panel">
              <div className="workspace-panel__header">Steps</div>
              <StepList project={project} />
            </div>
          </aside>
        }
        sidePanelPosition="left"
        editor={
          <EditorPane
            path={activeFilePath}
            content={activeFileContent}
            activeEdit={activeEdit}
            editAnchor={editAnchor}
            editProgress={editProgress}
            onFreeEdit={(content) => void handleFreeEdit(content)}
            onGuidedProgress={(progress) => void handleGuidedProgress(progress)}
          />
        }
      />
    </div>
  );
}
