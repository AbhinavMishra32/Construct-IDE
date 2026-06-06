import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EditorPane } from "./EditorPane";
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
  onRunCommand,
  onTreeChange
}: {
  project: ProjectRecord;
  onBack: () => void;
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onProjectChange: (project: ProjectRecord) => void;
  onRunCommand: (command: string, cwd: string) => void;
  onTreeChange: (tree: WorkspaceTreeNode[], activePath: string | null, relevantPath: string | null, openFile: (path: string) => void) => void;
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

  // Push guide + steps into the right panel.
  useEffect(() => {
    onGuidePanelChange(
      <div className="workspace-right-panel-content">
        <GuidePanel
          project={project}
          block={block}
          editComplete={editComplete}
          onNext={() => void handleNext()}
          onRunCommand={onRunCommand}
        />
        <div className="workspace-right-panel-steps">
          <div className="workspace-panel__header">Steps</div>
          <StepList project={project} />
        </div>
      </div>
    );

    return () => onGuidePanelChange(null);
  }, [block, editComplete, onGuidePanelChange, onRunCommand, project]);

  // Expose tree data to parent for sidebar rendering.
  useEffect(() => {
    onTreeChange(tree, activeFilePath, relevantPath, (path: string) => {
      void openFile(path);
    });
  }, [tree, activeFilePath, relevantPath]);

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
    <div className="workspace workspace--editor-only">
      <EditorPane
        path={activeFilePath}
        content={activeFileContent}
        activeEdit={activeEdit}
        editAnchor={editAnchor}
        editProgress={editProgress}
        onFreeEdit={(content) => void handleFreeEdit(content)}
        onGuidedProgress={(progress) => void handleGuidedProgress(progress)}
      />
    </div>
  );
}
