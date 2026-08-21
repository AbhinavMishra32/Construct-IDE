import { useCallback, useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { BootstrapData, ConstructApi, ProjectSummary, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Sidebar, type Page, type ProjectActions } from "./components/shell/Sidebar";
import { Toolbar } from "./components/shell/Toolbar";
import { ConstructWordmark } from "./components/common/ConstructWordmark";
import { AuthPage } from "./components/pages/AuthPage";
import { ProjectsPage } from "./components/pages/ProjectsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Workspace } from "./components/workspace/Workspace";
import { FileTree } from "./components/workspace/FileTree";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { Button } from "@/components/ui/button";

const api: ConstructApi | undefined = window.construct;

/** Pages the shell puts a plain toolbar over. "workspace" draws its own, because
 *  it carries a back button and the project's own actions. */
const PAGE_TITLE: Record<Exclude<Page, "workspace">, string> = {
  projects: "Projects",
  settings: "Settings",
};

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("projects");
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);
  const [creating, setCreating] = useState(false);
  /* Which file the sidebar's tree last asked to open. Lifted here because the
     tree lives in the shell now, while the editor that answers it lives in the
     workspace. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("construct.sidebar") !== "hidden");
  const { width } = useSidebarWidth();
  /* Room for the OS window buttons when they sit on the sidebar's edge. The
     preload reports which edge before first paint, so the inset is known
     without measuring anything. */
  const controlsInset = api?.chrome.controls === "left" ? 28 : 0;

  const load = useCallback(async () => {
    if (!api) throw new Error("Construct must run inside its Electron desktop shell.");
    setData(await api.bootstrap());
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) => setError(message(cause)));
  }, [load]);

  /* Only the project list is re-read after a project write. Re-running the whole
     bootstrap would also re-read the provider inventory, which asks every
     connected subscription for its quota — a network round trip nobody asked for
     because a project was renamed. */
  const refreshProjects = useCallback(async () => {
    if (!api) return;
    const projects = await api.listProjects();
    setData((current) => (current ? { ...current, projects } : current));
  }, []);

  const openProject = useCallback(async (project: ProjectSummary) => {
    if (!api) return;
    try {
      const detail = await api.openProject({ projectId: project.id });
      setActiveProject(detail.summary);
      setOpenPath(null);
      setPage("workspace");
      await refreshProjects();
    } catch (cause) {
      setError(message(cause));
    }
  }, [refreshProjects]);

  /* Every action reports intent and re-reads the list rather than editing its
     own copy: the main process owns the write, so the sidebar showing something
     it decided for itself is how the two drift apart. */
  const settle = (work: Promise<void> | undefined) =>
    void work?.then(refreshProjects).catch((cause: unknown) => setError(message(cause)));

  const actions: ProjectActions = {
    rename: (project, name) => settle(api?.renameProject({ projectId: project.id, name })),
    setPinned: (project, pinned) => settle(api?.setProjectPinned({ projectId: project.id, value: pinned })),
    setArchived: (project, archived) => settle(api?.setProjectArchived({ projectId: project.id, value: archived })),
    remove: (project) => {
      if (activeProject?.id === project.id) {
        setActiveProject(null);
        setOpenPath(null);
        setPage("projects");
      }
      settle(api?.deleteProject({ projectId: project.id }));
    },
  };

  const setTheme = useCallback(async (theme: ThemePreference) => {
    await api?.setTheme(theme);
    setData((current) => (current ? { ...current, theme } : current));
  }, []);

  useEffect(() => {
    return api?.onMenuCommand((command) => {
      if (command === "new-project") setCreating(true);
      if (command === "settings") setPage("settings");
      if (command === "toggle-sidebar") setSidebar((value) => !value);
    });
  }, []);

  /* Held until bootstrap answers. The window is already open and painted at the
     right size by the main process, so this is a short beat rather than a
     loading screen — showing an empty shell first would read as an application
     that lost the learner's projects. */
  if (!data && !error) {
    return (
      <div className="app-drag app-pane flex h-dvh items-center justify-center">
        <ConstructWordmark className="boot-wordmark text-[3.5rem] leading-none" />
      </div>
    );
  }

  if (!data?.signedIn) {
    return (
      <AuthPage
        api={api}
        error={error}
        serverConfigured
        onAuthenticated={load}
        onError={setError}
      />
    );
  }

  return (
    <div className="app-vibrant relative flex h-dvh overflow-hidden">
      <AnimatePresence initial={false}>
        {sidebar && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <Sidebar
              page={page}
              email={data.email ?? "Signed in"}
              projects={data.projects}
              activeProjectId={activeProject?.id ?? undefined}
              projectActions={actions}
              /* Inside a project the sidebar becomes the file tree: it is the
                 one column that persists, so a second tree beside it would be
                 two navigators for one thing. */
              projectView={
                page === "workspace" && activeProject
                  ? {
                      name: activeProject.name,
                      tree: (
                        <FileTree
                          api={api}
                          projectId={activeProject.id}
                          activePath={openPath}
                          onOpenFile={setOpenPath}
                          onError={setError}
                        />
                      ),
                    }
                  : undefined
              }
              onGoHome={
                page === "workspace"
                  ? () => {
                      setActiveProject(null);
                      setOpenPath(null);
                      setPage("projects");
                    }
                  : undefined
              }
              onPage={(next) => {
                setPage(next);
                if (next !== "workspace") setActiveProject(null);
              }}
              onOpenProject={(project) => void openProject(project)}
              onNewProject={() => {
                setPage("projects");
                setCreating(true);
              }}
              onCollapse={() => {
                setSidebar(false);
                localStorage.setItem("construct.sidebar", "hidden");
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <main
        className={cn(
          "relative flex min-w-0 flex-1 flex-col",
          /* Pages other than the workspace sit on the standard pane fill. The
             workspace paints its own surfaces, because its editor wants a solid
             ground while the agent beside it wants glass. */
          page !== "workspace" && "app-pane",
          sidebar && "app-content-pane",
        )}
      >
        {page !== "workspace" && (
          <Toolbar
            title={PAGE_TITLE[page]}
            onExpandSidebar={
              sidebar
                ? undefined
                : () => {
                    setSidebar(true);
                    localStorage.setItem("construct.sidebar", "shown");
                  }
            }
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {page === "projects" && (
            <ProjectsPage
              api={api}
              projects={data.projects}
              creating={creating}
              onCreatingChange={setCreating}
              onOpen={(project) => void openProject(project)}
              onChanged={refreshProjects}
              onError={setError}
            />
          )}

          {page === "settings" && (
            <SettingsPage api={api} theme={data.theme} onThemeChange={setTheme} onSignedOut={load} />
          )}

          {page === "workspace" && activeProject && (
            <Workspace api={api} project={activeProject} openPath={openPath} onError={setError} />
          )}
        </div>
      </main>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn(
              "fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg",
              "border border-destructive/30 bg-card px-3 py-2 shadow-lg",
            )}
            role="alert"
          >
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <span className="text-ui">{error}</span>
            <Button variant="ghost" size="icon" className="size-5" aria-label="Dismiss" onClick={() => setError(null)}>
              <X className="size-3.5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
