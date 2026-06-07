import {
  CaretDown,
  File,
  FileCode,
  FileCss,
  FileJs,
  FileMd,
  FileTs,
  FileTsx,
  MagnifyingGlass
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SlotPanel } from "@/components/open-shell";
import type { SlotPanelHandle, SlotTab, SlotLauncherItem } from "@/components/open-shell";
import { EditorPane } from "./EditorPane";
import { GuidePanel } from "./GuidePanel";
import { StepList } from "./StepList";
import {
  listFiles,
  readFile,
  updateProject,
  writeFile
} from "../lib/bridge";
import { currentBlock, nextPosition } from "../lib/runtime";
import type {
  EditBlock,
  ProjectRecord,
  WorkspaceTreeNode
} from "../types";

function iconForFile(filename: string) {
  const props = { size: 12, weight: "duotone" as const };

  if (/\.(tsx)$/.test(filename)) return <FileTsx {...props} />;
  if (/\.(ts|mts|cts)$/.test(filename)) return <FileTs {...props} />;
  if (/\.(js|jsx|mjs|cjs)$/.test(filename)) return <FileJs {...props} />;
  if (/\.css$/.test(filename)) return <FileCss {...props} />;
  if (/\.json$/.test(filename)) return <FileCode {...props} />;
  if (/\.mdx?$/.test(filename)) return <FileMd {...props} />;

  return <File {...props} />;
}

/* ------------------------------------------------------------------ */
/*  File Chooser (shown when user clicks + → Open file)               */
/* ------------------------------------------------------------------ */
function FileChooserContent({
  files,
  onSelectFile
}: {
  files: string[];
  onSelectFile: (path: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, search]);

  return (
    <div className="construct-file-chooser">
      <div className="construct-file-chooser-search">
        <MagnifyingGlass size={14} weight="bold" className="construct-file-chooser-search-icon" />
        <input
          ref={inputRef}
          className="construct-file-chooser-input"
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="construct-file-chooser-list">
        {filtered.map((filePath) => {
          const filename = filePath.split("/").pop() || "";
          return (
            <button
              key={filePath}
              className="construct-file-chooser-item"
              type="button"
              onClick={() => onSelectFile(filePath)}
            >
              <span className="construct-file-chooser-item-icon">{iconForFile(filename)}</span>
              <span className="construct-file-chooser-item-name">{filename}</span>
              <span className="construct-file-chooser-item-path">{filePath}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="construct-file-chooser-empty">No matching files</div>
        )}
      </div>
    </div>
  );
}

export function Workspace({
  project,
  theme,
  onGuidePanelChange,
  onProjectChange,
  onRunCommand,
  onTreeChange,
  onSavingChange,
  activeRightSlotId,
  onRightSlotChange,
  onFileOpened
}: {
  project: ProjectRecord;
  theme: "light" | "dark" | "system";
  onGuidePanelChange: (panel: ReactNode | null) => void;
  onProjectChange: (project: ProjectRecord) => void;
  onRunCommand: (command: string, cwd: string) => void;
  onTreeChange: (tree: WorkspaceTreeNode[], activePath: string | null, relevantPath: string | null, openFile: (path: string) => void) => void;
  onSavingChange?: (saving: boolean) => void;
  activeRightSlotId: string;
  onRightSlotChange: (slotId: string) => void;
  onFileOpened?: (path: string) => void;
}) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [activeFileContent, setActiveFileContent] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [isStepsCollapsed, setIsStepsCollapsed] = useState(false);
  const [pendingJump, setPendingJump] = useState<{ line: number; column: number } | null>(null);
  const editorPanelRef = useRef<SlotPanelHandle>(null);

  const block = currentBlock(project);
  const activeEdit = block?.kind === "edit" ? block : null;
  const relevantPath = activeEdit?.path ?? null;
  const activeFilePath = project.activeFilePath ?? relevantPath ?? project.program.files[0]?.path ?? null;
  const editProgress = activeEdit ? project.typingProgress[activeEdit.id] ?? 0 : 0;
  const editComplete = activeEdit ? editProgress >= activeEdit.content.length : false;
  const editAnchor = activeEdit ? project.editAnchors[activeEdit.id] ?? "" : "";

  // Reset tabs when project changes
  useEffect(() => {
    setOpenTabs(activeFilePath ? [activeFilePath] : []);
    setPendingJump(null);
  }, [project.id]);

  // Sync open tabs with active file
  useEffect(() => {
    if (activeFilePath && !openTabs.includes(activeFilePath)) {
      setOpenTabs((prev) => [...prev, activeFilePath]);
    }
  }, [activeFilePath]);

  // Handle closing a tab
  async function closeTab(tabPath: string) {
    const nextTabs = openTabs.filter((t) => t !== tabPath);
    setOpenTabs(nextTabs);

    if (activeFilePath === tabPath) {
      if (nextTabs.length > 0) {
        const nextActive = nextTabs[nextTabs.length - 1];
        await openFile(nextActive);
      } else {
        setActiveFileContent("");
        await persistProject({ activeFilePath: null });
      }
    }
  }

  const handleReadFileContent = useCallback(async (path: string) => {
    return await readMaybeFile(path);
  }, [project.id]);

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

  // Expose tree data to parent for sidebar rendering.
  useEffect(() => {
    onTreeChange(tree, activeFilePath, relevantPath, (path: string) => {
      void openFileAndRecord(path);
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

  async function openFileAndRecord(path: string) {
    await openFile(path);
    onFileOpened?.(path);
  }

  async function prepareEdit(edit: EditBlock) {
    onSavingChange?.(true);
    try {
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
    } finally {
      onSavingChange?.(false);
    }
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

    onSavingChange?.(true);
    try {
      setActiveFileContent(content);
      await writeFile({ projectId: project.id, path: activeFilePath, content });
      await refreshTree();
    } finally {
      onSavingChange?.(false);
    }
  }

  async function handleGuidedProgress(progress: number) {
    if (!activeEdit) {
      return;
    }

    onSavingChange?.(true);
    try {
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
    } finally {
      onSavingChange?.(false);
    }
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

  // Build SlotPanel tabs from openTabs state
  const guideTabContent = useMemo(() => (
    <GuidePanel
      project={project}
      block={block}
      theme={theme}
      editComplete={editComplete}
      onNext={() => void handleNext()}
      onRunCommand={onRunCommand}
    />
  ), [block, editComplete, onRunCommand, project, theme]);

  const stepsTabContent = useMemo(() => (
    <div className={`workspace-right-panel-steps ${isStepsCollapsed ? "is-collapsed" : ""}`}>
      <button
        className="workspace-panel__header"
        onClick={() => setIsStepsCollapsed(prev => !prev)}
        aria-expanded={!isStepsCollapsed}
        aria-label="Toggle steps timeline"
      >
        <span>Steps</span>
        <CaretDown size={11} weight="bold" className="workspace-panel__header-chevron" />
      </button>
      <div className="workspace-right-panel-steps-timeline-container">
        <StepList project={project} />
      </div>
    </div>
  ), [isStepsCollapsed, project]);

  useEffect(() => {
    const panelTabs: SlotTab[] = [
      {
        id: "guide",
        title: "Guide",
        icon: <FileCode size={13} weight="duotone" />,
        active: activeRightSlotId === "guide",
        content: guideTabContent
      },
      {
        id: "steps",
        title: "Steps",
        icon: <File size={13} weight="duotone" />,
        active: activeRightSlotId === "steps",
        content: stepsTabContent
      }
    ];

    onGuidePanelChange(
      <SlotPanel
        activeTabId={activeRightSlotId}
        tabs={panelTabs}
        syncTabs
        launcherItems={panelTabs.map((tab) => ({
          type: tab.id,
          title: tab.title,
          description: tab.id === "guide" ? "Current block explainer" : "Project step timeline",
          icon: tab.icon ?? <File size={13} weight="duotone" />,
          createTab: () => tab
        }))}
        className="construct-guide-slot-panel"
        ariaLabel="Guide and steps tabs"
        onActiveTabChange={(tabId) => onRightSlotChange(tabId ?? "guide")}
      />
    );

    return () => onGuidePanelChange(null);
  }, [activeRightSlotId, guideTabContent, onGuidePanelChange, onRightSlotChange, stepsTabContent]);

  // Build SlotPanel tabs from openTabs state
  const editorSlotTabs: SlotTab[] = useMemo(() => {
    return openTabs.map((tabPath) => {
      const filename = tabPath.split("/").pop() || "";
      return {
        id: tabPath,
        title: filename,
        icon: iconForFile(filename),
        closable: true,
        active: tabPath === activeFilePath,
        content: (
          <EditorPane
            path={tabPath}
            content={tabPath === activeFilePath ? activeFileContent : ""}
            activeEdit={tabPath === activeFilePath ? activeEdit : null}
            editAnchor={tabPath === activeFilePath ? editAnchor : ""}
            editProgress={tabPath === activeFilePath ? editProgress : 0}
            onFreeEdit={(content) => void handleFreeEdit(content)}
            onGuidedProgress={(progress) => void handleGuidedProgress(progress)}
            fileList={flattenTree(tree)}
            theme={theme}
            pendingJump={tabPath === activeFilePath ? pendingJump : null}
            onJumpComplete={() => setPendingJump(null)}
            onOpenFileAndJump={async (path, line, col) => {
              setPendingJump({ line, column: col });
              await openFileAndRecord(path);
            }}
            readFileContent={handleReadFileContent}
          />
        ),
      };
    });
  }, [openTabs, activeFilePath, activeFileContent, activeEdit, editAnchor, editProgress, tree, pendingJump, handleReadFileContent, theme]);

  // Launcher items for the editor + button
  const fileList = useMemo(() => flattenTree(tree), [tree]);
  const editorLauncherItems: SlotLauncherItem[] = useMemo(() => [
    {
      type: "open-file",
      title: "Open file",
      description: "Browse and open a project file",
      icon: <File size={16} weight="duotone" />,
      shortcut: "⌘P",
      createTab: () => ({
        id: `__file-chooser-${Date.now()}`,
        title: "Open file",
        icon: <MagnifyingGlass size={12} weight="bold" />,
        closable: true,
        content: (
          <FileChooserContent
            files={fileList}
            onSelectFile={(path) => {
              void openFileAndRecord(path);
            }}
          />
        ),
      }),
    },
  ], [fileList]);

  // When the user switches tabs in the SlotPanel, load that file's content
  const handleTabChange = useCallback((tabId: string) => {
    // Don't switch to file-chooser tabs
    if (tabId.startsWith("__file-chooser-")) return;
    if (tabId !== activeFilePath) {
      void openFileAndRecord(tabId);
    }
  }, [activeFilePath]);

  // When the user closes a tab in SlotPanel, propagate to Workspace state
  const handleTabClose = useCallback((tabId: string) => {
    void closeTab(tabId);
  }, [openTabs, activeFilePath]);

  return (
    <div className="workspace workspace--editor-only">
      <SlotPanel
        ref={editorPanelRef}
        activeTabId={activeFilePath}
        tabs={editorSlotTabs}
        syncTabs
        launcherItems={editorLauncherItems}
        className="construct-editor-slot-panel"
        ariaLabel="Editor file tabs"
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
      />
    </div>
  );
}

function flattenTree(nodes: WorkspaceTreeNode[]): string[] {
  const result: string[] = [];
  function visit(node: WorkspaceTreeNode) {
    if (node.type === "file") {
      result.push(node.path);
    } else if (node.children) {
      node.children.forEach(visit);
    }
  }
  nodes.forEach(visit);
  return result;
}
