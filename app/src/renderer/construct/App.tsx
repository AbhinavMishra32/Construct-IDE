import "@/components/open-shell/tokens/codex-theme.css";
import "./styles/construct.css";

import { PanelBottomIcon, PanelLeftIcon, PanelRightIcon, TerminalIcon, HouseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AppShell,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  BottomPanel,
  Composer,
  Sidebar
} from "@/components/open-shell";

import { Dashboard } from "./components/Dashboard";
import { FileTree } from "./components/FileTree";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import type { ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";

export default function ConstructApp() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const [treeData, setTreeData] = useState<{
    tree: WorkspaceTreeNode[];
    activePath: string | null;
    relevantPath: string | null;
    openFile: ((path: string) => void) | null;
  }>({
    tree: [],
    activePath: null,
    relevantPath: null,
    openFile: null
  });

  const runCommand = useCallback((command: string, cwd: string) => {
    terminalRef.current?.runCommand(command, cwd);
  }, []);

  const handleBack = useCallback(() => {
    setRightPanel(null);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null });
    void refresh();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.codexWindowType = "electron";
    document.documentElement.dataset.windowType = "electron";
    document.documentElement.dataset.codexOs = window.construct.getRuntimeInfo().platform;
    void refresh();
  }, []);

  async function refresh() {
    try {
      setBusy(true);
      setError(null);
      setProjects(await bootstrapProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string) {
    try {
      setBusy(true);
      setError(null);
      setActiveProject(await openSavedProject(projectId));
      setProjects(await bootstrapProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const sidebarProjects = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: "construct",
        active: activeProject?.id === project.id,
        threads: [
          {
            id: `${project.id}:progress`,
            title: project.title,
            meta: `${project.progress}%`,
            active: activeProject?.id === project.id
          }
        ]
      })),
    [activeProject?.id, projects]
  );

  const main = activeProject ? (
      <Workspace
        project={activeProject}
        onBack={handleBack}
        onGuidePanelChange={setRightPanel}
        onProjectChange={setActiveProject}
        onRunCommand={runCommand}
        onTreeChange={(tree, activePath, relevantPath, openFile) => {
          setTreeData({ tree, activePath, relevantPath, openFile });
        }}
    />
  ) : (
    <Dashboard
      projects={projects}
      busy={busy}
      error={error}
      onRefresh={() => void refresh()}
      onOpenProject={(projectId) => void openProject(projectId)}
    />
  );

  return (
    <AppShell
      showSidebarChrome={false}
      headerTabs={[
        {
          id: activeProject?.id ?? "dashboard",
          title: activeProject?.title ?? "Projects",
          active: true
        }
      ]}
      collapsedSidebarTrigger={(state) => (
        <AppShellCollapsedSidebarTrigger onClick={state.toggleSidebar} aria-label="Open sidebar">
          <PanelLeftIcon size={15} />
        </AppShellCollapsedSidebarTrigger>
      )}
      headerActions={
        activeProject
          ? (state) => (
              <>
                <AppShellHeaderToolButton onClick={state.toggleSidebar} aria-label="Toggle sidebar">
                  <PanelLeftIcon size={15} />
                </AppShellHeaderToolButton>
                <AppShellHeaderToolButton onClick={state.toggleRightPanel} aria-label="Toggle guide panel">
                  <PanelRightIcon size={15} />
                </AppShellHeaderToolButton>
                <AppShellHeaderToolButton onClick={state.toggleBottomPanel} aria-label="Toggle terminal">
                  <PanelBottomIcon size={15} />
                </AppShellHeaderToolButton>
              </>
            )
          : undefined
      }
      sidebar={
        activeProject ? (
          <Sidebar projects={[]} items={[]}>
            <div className="construct-sidebar-active">
              <div className="construct-sidebar-header">
                <button
                  className="construct-sidebar-home-btn"
                  onClick={handleBack}
                  title="Go back to projects"
                  aria-label="Go home"
                >
                  <HouseIcon size={16} />
                </button>
                <span className="construct-sidebar-project-title" title={activeProject.title}>
                  {activeProject.title}
                </span>
              </div>
              <div className="construct-sidebar-tree-container">
                {treeData.openFile && (
                  <FileTree
                    nodes={treeData.tree}
                    activePath={treeData.activePath}
                    relevantPath={treeData.relevantPath}
                    onOpenFile={treeData.openFile}
                  />
                )}
              </div>
            </div>
          </Sidebar>
        ) : (
          <Sidebar
            projects={sidebarProjects}
            items={[]}
            onProjectSelect={(projectId) => void openProject(projectId)}
          />
        )
      }
      main={main}
      rightPanel={activeProject ? rightPanel : null}

      bottomPanel={
        activeProject ? (
          <BottomPanel
            tabs={[
              {
                id: "terminal",
                title: "Terminal",
                active: true,
                icon: <TerminalIcon size={14} />,
                content: (
                  <TerminalPanel
                    ref={terminalRef}
                    projectId={activeProject.id}
                    cwd={activeProject.workspacePath}
                  />
                )
              }
            ]}
          />
        ) : null
      }
    />
  );
}
