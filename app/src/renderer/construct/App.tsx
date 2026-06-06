import "@/components/open-shell/tokens/codex-theme.css";
import "./styles/construct.css";

import {
  GearSix,
  House,
  Plus,
  Rows,
  Sidebar as SidebarIcon,
  Columns,
  TerminalWindow
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AppShell,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  BottomPanel,
  Sidebar,
  SidebarSection
} from "@/components/open-shell";

import { Dashboard } from "./components/Dashboard";
import { FileTree } from "./components/FileTree";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { SettingsDialog } from "./components/SettingsDialog";
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
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
      onCreateProject={() => setIsNewProjectOpen(true)}
    />
  );

  return (
    <>
      <AppShell
        key={activeProject?.id ?? "dashboard"}
        showSidebarChrome={false}
        defaultBottomPanelOpen={Boolean(activeProject)}
        defaultRightPanelOpen={Boolean(activeProject)}
        headerTabs={[
          {
            id: activeProject?.id ?? "dashboard",
            title: activeProject?.title ?? "Projects",
            active: true
          }
        ]}
        collapsedSidebarTrigger={(state) => (
          <AppShellCollapsedSidebarTrigger onClick={state.toggleSidebar} aria-label="Open sidebar">
            <SidebarIcon size={15} weight="duotone" />
          </AppShellCollapsedSidebarTrigger>
        )}
        headerActions={
          activeProject
            ? (state) => (
                <>
                  <AppShellHeaderToolButton onClick={state.toggleSidebar} aria-label="Toggle sidebar">
                    <SidebarIcon size={15} weight="duotone" />
                  </AppShellHeaderToolButton>
                  <AppShellHeaderToolButton onClick={state.toggleRightPanel} aria-label="Toggle guide panel">
                    <Columns size={15} weight="duotone" />
                  </AppShellHeaderToolButton>
                  <AppShellHeaderToolButton onClick={state.toggleBottomPanel} aria-label="Toggle terminal">
                    <Rows size={15} weight="duotone" />
                  </AppShellHeaderToolButton>
                </>
              )
            : undefined
        }
        sidebar={
          activeProject ? (
            <Sidebar projects={[]} items={[]} footer={<SidebarSettingsButton onClick={() => setIsSettingsOpen(true)} />}>
              <div className="construct-sidebar-active">
                <div className="construct-sidebar-header">
                  <button
                    className="construct-sidebar-home-btn"
                    onClick={handleBack}
                    title="Projects"
                    aria-label="Projects"
                  >
                    <House size={16} weight="duotone" />
                  </button>
                  <span className="construct-sidebar-project-title" title={activeProject.title}>
                    {activeProject.title}
                  </span>
                </div>
                <div className="construct-sidebar-tree-container">
                  {treeData.openFile ? (
                    <FileTree
                      nodes={treeData.tree}
                      activePath={treeData.activePath}
                      relevantPath={treeData.relevantPath}
                      onOpenFile={treeData.openFile}
                    />
                  ) : null}
                </div>
              </div>
            </Sidebar>
          ) : (
            <Sidebar
              projects={[]}
              items={[]}
              primaryItems={[
                {
                  id: "new-project",
                  icon: <Plus size={18} weight="bold" />,
                  label: "New project",
                  onClick: () => setIsNewProjectOpen(true)
                }
              ]}
              footer={<SidebarSettingsButton onClick={() => setIsSettingsOpen(true)} />}
            >
              <SidebarSection heading="Projects">
                <div className="construct-sidebar-project-list">
                  {projects.map((project) => (
                    <button
                      className="construct-sidebar-project-row"
                      key={project.id}
                      onClick={() => void openProject(project.id)}
                      type="button"
                    >
                      <span className="construct-sidebar-project-row__title">{project.title}</span>
                      <span className="construct-sidebar-project-row__meta">{project.progress}%</span>
                    </button>
                  ))}
                  {projects.length === 0 ? (
                    <div className="construct-sidebar-empty">
                      Open a .construct file to start.
                    </div>
                  ) : null}
                </div>
              </SidebarSection>
            </Sidebar>
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
                  icon: <TerminalWindow size={14} weight="duotone" />,
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
      <NewProjectDialog
        open={isNewProjectOpen}
        onOpenChange={setIsNewProjectOpen}
        onProjectCreated={(project) => {
          setActiveProject(project);
          setProjects((current) => {
            const withoutProject = current.filter((item) => item.id !== project.id);
            return [
              {
                id: project.id,
                title: project.title,
                description: project.description,
                progress: project.progress,
                lastOpenedAt: project.lastOpenedAt,
                sourcePath: project.sourcePath,
                workspacePath: project.workspacePath
              },
              ...withoutProject
            ];
          });
        }}
      />
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onProjectsChange={(nextProjects) => {
          setProjects(nextProjects);
          setActiveProject((current) => {
            if (!current) {
              return current;
            }

            const summary = nextProjects.find((project) => project.id === current.id);
            return summary ? { ...current, workspacePath: summary.workspacePath } : current;
          });
        }}
      />
    </>
  );
}

function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="construct-sidebar-settings" onClick={onClick} type="button">
      <GearSix size={19} weight="duotone" />
      <span>Settings</span>
    </button>
  );
}
