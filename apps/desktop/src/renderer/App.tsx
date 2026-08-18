import { useCallback, useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { BootstrapData, ConstructApi, ProjectSummary, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Sidebar, type Page, type ProjectActions } from "./components/shell/Sidebar";
import { Toolbar } from "./components/shell/Toolbar";
import { ConstructWordmark } from "./components/common/ConstructWordmark";
import { ConstructDots } from "@/components/common/ConstructDots";
import { AuthPage } from "./components/pages/AuthPage";
import { ProjectsPage } from "./components/pages/ProjectsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
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
      setPage("workspace");
      await refreshProjects();
    } catch (cause) {
      setError(message(cause));
    }
  }, [refreshProjects]);

  const actions: ProjectActions = {
    open: (project) => void openProject(project),
    rename: (project, name) => {
      void api?.renameProject({ projectId: project.id, name }).then(refreshProjects).catch((cause: unknown) => setError(message(cause)));
    },
    remove: (project) => {
      void api
        ?.deleteProject({ projectId: project.id })
        .then(async () => {
          if (activeProject?.id === project.id) {
            setActiveProject(null);
            setPage("projects");
          }
          await refreshProjects();
        })
        .catch((cause: unknown) => setError(message(cause)));
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
      <div className="flex h-dvh items-center justify-center">
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
    <div className="flex h-dvh overflow-hidden">
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
              projects={data.projects}
              activeProjectId={activeProject?.id ?? null}
              actions={actions}
              onNavigate={(next) => {
                setPage(next);
                if (next !== "workspace") setActiveProject(null);
              }}
              onNewProject={() => {
                setPage("projects");
                setCreating(true);
              }}
              onCollapse={() => {
                setSidebar(false);
                localStorage.setItem("construct.sidebar", "hidden");
              }}
              width={width}
              controlsInset={controlsInset}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col">
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
            /* The workspace itself — editor, file tree, terminal and the agent —
               lands in M2 and M3. Until then opening a project confirms which one
               is open rather than pretending to be an IDE. */
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <ConstructDots pattern="wave" size={20} />
              <p className="text-content font-medium">{activeProject.name}</p>
              <p className="max-w-sm text-ui text-muted-foreground">{activeProject.directory}</p>
            </div>
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
