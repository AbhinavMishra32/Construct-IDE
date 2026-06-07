import "@/components/open-shell/tokens/codex-theme.css";
import "./styles/construct.css";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelLeft, PanelRight, PanelBottom } from "lucide-react";
import {
  ArrowLeft,
  Folder,
  GearSix,
  Plus,
  TerminalWindow
} from "@phosphor-icons/react";

import {
  AppShell,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  BottomPanel,
  Button,
  Sidebar,
  SidebarSection,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSidebar,
  SettingsToggle,
  useShellHistory
} from "@/components/open-shell";
import type { SettingsNavItem, SettingsNavSection, ShellHistoryEntry } from "@/components/open-shell";

import { Dashboard } from "./components/Dashboard";
import { FileTree } from "./components/FileTree";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import {
  getSettings,
  selectWorkspaceDirectory,
  setThemeSource,
  setWorkspaceRoot,
  updateProject
} from "./lib/bridge";
import type { ProjectRecord, ProjectSummary, WorkspaceTreeNode } from "./types";

type ThemeMode = "light" | "dark" | "system";
type ConstructHistoryEntry = ShellHistoryEntry<
  "bottom-tab" | "dashboard" | "file" | "project" | "project-settings" | "right-slot" | "settings",
  {
    filePath?: string;
    projectId?: string;
    settingsItemId?: string;
    slotId?: string;
    tabId?: string;
  }
>;

type SettingsSurfaceState = {
  itemId: string;
  projectId?: string;
};

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("construct.theme") as ThemeMode | null;
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

function resolveActiveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export default function ConstructApp() {
  const history = useShellHistory<ConstructHistoryEntry>(
    () => [{ id: "dashboard", title: "Projects", type: "dashboard" }],
    { maxEntries: 120 }
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [settingsSurface, setSettingsSurface] = useState<SettingsSurfaceState | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeRightSlotId, setActiveRightSlotId] = useState("guide");
  const [activeBottomTabId, setActiveBottomTabId] = useState("terminal");
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);
  const applyingHistoryRef = useRef(false);
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

  const pushHistory = useCallback((entry: ConstructHistoryEntry) => {
    if (!applyingHistoryRef.current) {
      history.push(entry);
    }
  }, [history]);

  const runCommand = useCallback((command: string, cwd: string) => {
    terminalRef.current?.runCommand(command, cwd);
  }, []);

  const handleBack = useCallback(() => {
    setSettingsSurface(null);
    setRightPanel(null);
    setActiveProject(null);
    setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null });
    pushHistory({ id: "dashboard", title: "Projects", type: "dashboard" });
    void refresh();
  }, [pushHistory]);

  const openSettingsSurface = useCallback((itemId: string, projectId?: string) => {
    setSettingsSurface({ itemId, projectId });
    setSettingsQuery("");
    pushHistory({
      id: projectId ? `project-settings:${projectId}:${itemId}` : `settings:${itemId}`,
      payload: { projectId, settingsItemId: itemId },
      title: projectId ? "Project settings" : "Settings",
      type: projectId ? "project-settings" : "settings"
    });
  }, [pushHistory]);

  useEffect(() => {
    const active = resolveActiveTheme(theme);
    document.documentElement.dataset.constructTheme = active;
    document.documentElement.dataset.codexTheme = active;
    document.documentElement.classList.toggle("dark", active === "dark");
    localStorage.setItem("construct.theme", theme);
    void setThemeSource(theme);
  }, [theme]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const active = mql.matches ? "dark" : "light";
        document.documentElement.dataset.constructTheme = active;
        document.documentElement.dataset.codexTheme = active;
        document.documentElement.classList.toggle("dark", active === "dark");
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

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

  async function openProject(projectId: string, options: { filePath?: string; recordHistory?: boolean } = {}) {
    try {
      setBusy(true);
      setError(null);
      const project = await openSavedProject(projectId);
      const nextProject = options.filePath ? { ...project, activeFilePath: options.filePath } : project;
      setSettingsSurface(null);
      setActiveProject(nextProject);
      setProjects(await bootstrapProjects());
      if (options.recordHistory !== false) {
        pushHistory({
          id: options.filePath ? `file:${projectId}:${options.filePath}` : `project:${projectId}`,
          payload: { filePath: options.filePath, projectId },
          title: options.filePath ?? project.title,
          type: options.filePath ? "file" : "project"
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const entry = history.current;
    if (!entry) {
      return;
    }

    applyingHistoryRef.current = true;

    const finish = () => {
      window.setTimeout(() => {
        applyingHistoryRef.current = false;
      }, 0);
    };

    if (entry.type === "dashboard") {
      setSettingsSurface(null);
      setRightPanel(null);
      setActiveProject(null);
      setTreeData({ tree: [], activePath: null, relevantPath: null, openFile: null });
      finish();
      return;
    }

    if (entry.type === "settings" || entry.type === "project-settings") {
      setSettingsSurface({
        itemId: entry.payload?.settingsItemId ?? "workspace",
        projectId: entry.payload?.projectId
      });
      finish();
      return;
    }

    if (entry.type === "right-slot" && entry.payload?.slotId) {
      setActiveRightSlotId(entry.payload.slotId);
      finish();
      return;
    }

    if (entry.type === "bottom-tab" && entry.payload?.tabId) {
      setActiveBottomTabId(entry.payload.tabId);
      finish();
      return;
    }

    if ((entry.type === "project" || entry.type === "file") && entry.payload?.projectId) {
      void openProject(entry.payload.projectId, {
        filePath: entry.payload.filePath,
        recordHistory: false
      }).finally(finish);
      return;
    }

    finish();
  }, [history.current?.id]);

  const main = settingsSurface ? (
    <ConstructSettingsSurface
      activeItemId={settingsSurface.itemId}
      projectId={settingsSurface.projectId}
      projects={projects}
      theme={theme}
      onThemeChange={setTheme}
      onProjectsChange={setProjects}
      onActiveProjectChange={setActiveProject}
    />
  ) : activeProject ? (
      <Workspace
        project={activeProject}
        onGuidePanelChange={setRightPanel}
        onProjectChange={setActiveProject}
        onRunCommand={runCommand}
        activeRightSlotId={activeRightSlotId}
        onRightSlotChange={(slotId) => {
          setActiveRightSlotId(slotId);
          pushHistory({
            id: `right-slot:${activeProject.id}:${slotId}`,
            payload: { projectId: activeProject.id, slotId },
            title: slotId === "steps" ? "Steps" : "Guide",
            type: "right-slot"
          });
        }}
        onFileOpened={(filePath) => {
          pushHistory({
            id: `file:${activeProject.id}:${filePath}`,
            payload: { filePath, projectId: activeProject.id },
            title: filePath,
            type: "file"
          });
        }}
        onTreeChange={(tree, activePath, relevantPath, openFile) => {
          setTreeData({ tree, activePath, relevantPath, openFile });
        }}
        onSavingChange={setIsSaving}
    />
  ) : (
    <Dashboard
      projects={projects}
      busy={busy}
      error={error}
      onRefresh={() => void refresh()}
      onCreateProject={() => setIsNewProjectOpen(true)}
      onOpenProject={(projectId) => void openProject(projectId)}
      onOpenProjectSettings={(projectId) => openSettingsSurface("project-overview", projectId)}
    />
  );

  const settingsSections = useMemo(
    () => buildSettingsSections(projects, settingsSurface?.projectId),
    [projects, settingsSurface?.projectId]
  );

  function closeSettingsSurface() {
    const projectId = settingsSurface?.projectId;
    setSettingsSurface(null);
    if (projectId) {
      void openProject(projectId);
      return;
    }

    handleBack();
  }

  return (
    <>
      <AppShell
        key={activeProject?.id ?? "dashboard"}
        history={history}
        showSidebarChrome
        defaultBottomPanelOpen={Boolean(activeProject && !settingsSurface)}
        defaultRightPanelOpen={Boolean(activeProject && !settingsSurface)}
        headerTabs={[
          {
            id: settingsSurface
              ? `settings-${settingsSurface.itemId}`
              : activeProject?.id ?? "dashboard",
            title: settingsSurface
              ? settingsTitle(settingsSurface.itemId, settingsSurface.projectId, projects)
              : activeProject?.title ?? "Projects",
            active: true
          }
        ]}
        renderHeaderTab={(tab) => (
          <button className="construct-header-title-tab" type="button" title={String(tab.title)}>
            <span>{tab.title}</span>
          </button>
        )}
        collapsedSidebarTrigger={(state) => (
          <AppShellCollapsedSidebarTrigger onClick={state.toggleSidebar} aria-label="Open sidebar">
            <PanelLeft size={16} />
          </AppShellCollapsedSidebarTrigger>
        )}
        headerActions={
          activeProject && !settingsSurface
            ? (state) => (
                <>
                  <SavingIndicator isSaving={isSaving} />
                  <AppShellHeaderToolButton onClick={state.toggleRightPanel} aria-label="Toggle guide panel">
                    <PanelRight size={16} />
                  </AppShellHeaderToolButton>
                  <AppShellHeaderToolButton onClick={state.toggleBottomPanel} aria-label="Toggle terminal">
                    <PanelBottom size={16} />
                  </AppShellHeaderToolButton>
                </>
              )
            : undefined
        }
        sidebar={
          settingsSurface ? (
            <SettingsSidebar
              activeItemId={settingsSurface.itemId}
              backLabel={settingsSurface.projectId ? "Back to project" : "Back to projects"}
              footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}
              onBack={closeSettingsSurface}
              onItemSelect={(item: SettingsNavItem) => {
                const projectId = item.id.startsWith("project-") ? settingsSurface.projectId : undefined;
                if (item.id.startsWith("project-") && !projectId) {
                  return;
                }
                openSettingsSurface(item.id, projectId);
              }}
              onSearchChange={setSettingsQuery}
              query={settingsQuery}
              sections={settingsSections}
            />
          ) : activeProject ? (
            <Sidebar projects={[]} items={[]} footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}>
              <div className="construct-sidebar-active">
                <div className="construct-sidebar-header">
                  <button
                    className="construct-sidebar-home-btn"
                    onClick={handleBack}
                    title="Projects"
                    aria-label="Projects"
                  >
                    <ArrowLeft size={16} weight="bold" />
                  </button>
                  <span className="construct-sidebar-project-title">
                    Explorer
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
              footer={<SidebarSettingsButton onClick={() => openSettingsSurface("workspace")} />}
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
                      <span className="construct-sidebar-project-row__icon">
                        <Folder size={16} weight="duotone" />
                      </span>
                      <span className="construct-sidebar-project-row__title">{project.title}</span>
                      <span
                        className="construct-sidebar-project-row__settings"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          openSettingsSurface("project-overview", project.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            openSettingsSurface("project-overview", project.id);
                          }
                        }}
                        aria-label={`Open settings for ${project.title}`}
                      >
                        <GearSix size={15} weight="duotone" />
                      </span>
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
        rightPanel={activeProject && !settingsSurface ? rightPanel : null}
        bottomPanel={
          activeProject && !settingsSurface ? (
            <BottomPanel
              activeTabId={activeBottomTabId}
              onActiveTabChange={(tabId) => {
                if (!tabId) {
                  return;
                }
                setActiveBottomTabId(tabId);
                pushHistory({
                  id: `bottom-tab:${activeProject.id}:${tabId}`,
                  payload: { projectId: activeProject.id, tabId },
                  title: tabId,
                  type: "bottom-tab"
                });
              }}
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
              launcherItems={[
                {
                  type: "terminal",
                  title: "Terminal",
                  description: "Open a new terminal session",
                  icon: <TerminalWindow size={16} weight="duotone" />,
                  shortcut: "⌃`",
                  createTab: () => ({
                    id: `terminal-${Date.now()}`,
                    title: "Terminal",
                    icon: <TerminalWindow size={14} weight="duotone" />,
                    closable: true,
                    content: (
                      <TerminalPanel
                        projectId={activeProject.id}
                        cwd={activeProject.workspacePath}
                      />
                    )
                  })
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
          pushHistory({
            id: `project:${project.id}`,
            payload: { projectId: project.id },
            title: project.title,
            type: "project"
          });
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
    </>
  );
}

function ConstructSettingsSurface({
  activeItemId,
  projectId,
  projects,
  theme,
  onThemeChange,
  onProjectsChange,
  onActiveProjectChange
}: {
  activeItemId: string;
  projectId?: string;
  projects: ProjectSummary[];
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onProjectsChange: (projects: ProjectSummary[]) => void;
  onActiveProjectChange: (project: ProjectRecord | null | ((current: ProjectRecord | null) => ProjectRecord | null)) => void;
}) {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const [workspaceRoot, setWorkspaceRootValue] = useState("");
  const [projectTitle, setProjectTitle] = useState(project?.title ?? "");
  const [projectDescription, setProjectDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings()
      .then((settings) => setWorkspaceRootValue(settings.workspaceRoot))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    setProjectTitle(project?.title ?? "");
    setProjectDescription(project?.description ?? "");
  }, [project?.description, project?.title]);

  async function chooseRoot() {
    const directory = await selectWorkspaceDirectory({ defaultPath: workspaceRoot });
    if (directory) {
      setWorkspaceRootValue(directory);
    }
  }

  async function saveWorkspaceRoot() {
    if (!workspaceRoot.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const result = await setWorkspaceRoot({ workspaceRoot: workspaceRoot.trim() });
      onProjectsChange(result.projects);
      onActiveProjectChange((current) => {
        if (!current) {
          return current;
        }

        const summary = result.projects.find((item) => item.id === current.id);
        return summary ? { ...current, workspacePath: summary.workspacePath } : current;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveProjectDetails() {
    if (!projectId || !projectTitle.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await updateProject({
        id: projectId,
        patch: {
          title: projectTitle.trim(),
          description: projectDescription.trim()
        }
      });
      onActiveProjectChange((current) => current && current.id === updated.id ? updated : current);
      onProjectsChange(projects.map((item) => (
        item.id === updated.id
          ? {
              ...item,
              title: updated.title,
              description: updated.description,
              progress: updated.progress,
              workspacePath: updated.workspacePath
            }
          : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (activeItemId === "appearance") {
    return (
      <SettingsPanel title="Appearance" subtitle="Theme source for Construct and the embedded editor shell.">
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              title="Color theme"
              description="Match the system appearance or keep Construct fixed to one mode."
              control={
                <SettingsSelect value={theme} onChange={(event) => onThemeChange(event.currentTarget.value as ThemeMode)}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </SettingsSelect>
              }
            />
          </SettingsCard>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  if (activeItemId.startsWith("project-") && project) {
    return (
      <SettingsPanel title={project.title} subtitle={project.workspacePath}>
        {activeItemId === "project-overview" ? (
          <SettingsSection title="Project details">
            <SettingsCard>
              <SettingsRow title="Title" description="Shown in the sidebar, dashboard, and shell history.">
                <input
                  className="construct-settings-input"
                  value={projectTitle}
                  onChange={(event) => setProjectTitle(event.currentTarget.value)}
                />
              </SettingsRow>
              <SettingsRow title="Description" description="Used for local project summaries.">
                <textarea
                  className="construct-settings-input construct-settings-input--textarea"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.currentTarget.value)}
                />
              </SettingsRow>
              <SettingsRow
                title="Save project metadata"
                control={
                  <Button size="small" disabled={busy || !projectTitle.trim()} onClick={() => void saveProjectDetails()}>
                    Save
                  </Button>
                }
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-runtime" ? (
          <SettingsSection title="Runtime">
            <SettingsCard>
              <SettingsRow title="Workspace path" description={project.workspacePath} />
              <SettingsRow title="Source file" description={project.sourcePath ?? "Local generated project"} />
              <SettingsRow title="Progress" description={`${project.progress}% complete`} />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-slots" ? (
          <SettingsSection title="Slots">
            <SettingsCard>
              <SettingsRow
                title="Guide and steps"
                description="Available in the right slot through the plus menu."
                control={<SettingsToggle checked disabled />}
              />
              <SettingsRow
                title="Persistent terminals"
                description="Terminal tabs keep their PTY until the tab is closed."
                control={<SettingsToggle checked disabled />}
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {error ? <div className="construct-dialog-error">{error}</div> : null}
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="Workspace" subtitle="Local project storage and app-wide Construct defaults.">
      <SettingsSection title="Storage">
        <SettingsCard>
          <SettingsRow title="Workspace root" description="New and imported projects are kept under this folder.">
            <div className="construct-settings-path-row">
              <input
                className="construct-settings-input"
                value={workspaceRoot}
                onChange={(event) => setWorkspaceRootValue(event.currentTarget.value)}
              />
              <Button variant="secondary" size="small" onClick={() => void chooseRoot()}>
                Browse
              </Button>
              <Button size="small" disabled={busy || !workspaceRoot.trim()} onClick={() => void saveWorkspaceRoot()}>
                Save
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {error ? <div className="construct-dialog-error">{error}</div> : null}
    </SettingsPanel>
  );
}

function buildSettingsSections(projects: ProjectSummary[], projectId?: string): SettingsNavSection[] {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  return [
    {
      id: "app",
      label: "Construct",
      items: [
        { id: "workspace", label: "Workspace", icon: <Folder size={18} weight="duotone" /> },
        { id: "appearance", label: "Appearance", icon: <GearSix size={18} weight="duotone" /> }
      ]
    },
    {
      id: "project",
      label: "Project",
      items: [
        {
          id: "project-overview",
          label: project?.title ?? "Project overview",
          icon: <Folder size={18} weight="duotone" />,
          muted: !project
        },
        {
          id: "project-runtime",
          label: "Runtime",
          icon: <TerminalWindow size={18} weight="duotone" />,
          muted: !project
        },
        {
          id: "project-slots",
          label: "Slots",
          icon: <PanelRight size={18} />,
          badge: project ? `${project.progress}%` : undefined,
          muted: !project
        }
      ]
    }
  ];
}

function settingsTitle(itemId: string, projectId: string | undefined, projects: ProjectSummary[]) {
  if (itemId === "appearance") {
    return "Appearance";
  }
  if (itemId.startsWith("project-") && projectId) {
    return projects.find((project) => project.id === projectId)?.title ?? "Project settings";
  }
  return "Settings";
}

function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="construct-sidebar-settings" onClick={onClick} type="button">
      <GearSix size={19} weight="duotone" />
      <span>Settings</span>
    </button>
  );
}

function SavingIndicator({ isSaving }: { isSaving: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const saveStartRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isSaving) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      if (!isVisible) {
        saveStartRef.current = Date.now();
        setIsVisible(true);
      }
    } else {
      if (isVisible && saveStartRef.current) {
        const elapsed = Date.now() - saveStartRef.current;
        const remainingTime = Math.max(0, 1000 - elapsed);

        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }

        hideTimeoutRef.current = setTimeout(() => {
          setIsVisible(false);
          hideTimeoutRef.current = null;
        }, remainingTime);
      }
    }
  }, [isSaving, isVisible]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`construct-saving-indicator ${isVisible ? "is-visible" : ""}`}>
      <div className="construct-saving-spinner" />
      <span>Saving...</span>
    </div>
  );
}
