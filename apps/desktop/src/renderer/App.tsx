import { useCallback, useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { AtlasConcept, BootstrapData, ConceptSummary, ConstructApi, LearnerProfile, ProjectPath, ProjectSummary, ThemePreference } from "../shared/api";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { Sidebar, type Page, type ProjectActions } from "./components/shell/Sidebar";
import { SIDEBAR_SLIDE, SIDEBAR_SLIDE_CSS } from "./components/shell/sidebarMotion";
import { Toolbar } from "./components/shell/Toolbar";
import { ConstructWordmark } from "./components/common/ConstructWordmark";
import { AuthPage } from "./components/pages/AuthPage";
import { OnboardingPage } from "./components/onboarding/OnboardingPage";
import { ConceptsPage } from "./components/pages/ConceptsPage";
import { AtlasTree } from "./components/concepts/AtlasTree";
import { ProjectsPage } from "./components/pages/ProjectsPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Workspace } from "./components/workspace/Workspace";
import { FileTree } from "./components/workspace/FileTree";
import { PathList } from "./components/workspace/PathList";
import { ConceptTree } from "./components/workspace/ConceptTree";
import { useSidebarWidth } from "./hooks/use-sidebar-width";
import { canGoBack, canGoForward, forget, step, visit, type History, type View } from "./hooks/navigation";
import { Button } from "@/components/ui/button";

const api: ConstructApi | undefined = window.construct;

/** Pages the shell puts a plain toolbar over. "workspace" draws its own, because
 *  it carries a back button and the project's own actions. */
const PAGE_TITLE: Record<Exclude<Page, "workspace">, string> = {
  projects: "Projects",
  concepts: "Atlas",
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
  /* Concepts live here rather than in the workspace, because the sidebar shows
     them and the workspace opens them — one owner, two consumers. */
  const [concepts, setConcepts] = useState<ConceptSummary[]>([]);
  const [path, setPath] = useState<ProjectPath | null>(null);
  const [openConcept, setOpenConcept] = useState<ConceptSummary | null>(null);
  /* Every concept in every project, and the one being read. Owned here because
     the Atlas is now two components — the sidebar lists them and the page reads
     them — and a fetch in each would be two answers to one question. */
  const [atlas, setAtlas] = useState<AtlasConcept[] | null>(null);
  const [atlasSelected, setAtlasSelected] = useState<string | null>(null);
  /* Where the window has been. Held here because every place it can be is
     assembled here — the page, the open project, the open file — so this is the
     only component that can both record a move and put one back. */
  const [history, setHistory] = useState<History>({ entries: [{ page: "projects" }], index: 0 });
  const [sidebar, setSidebar] = useState(() => localStorage.getItem("construct.sidebar") !== "hidden");
  /* The second half of the toolbar title while Settings is open. The page owns
     which section is showing, so it reports the label up here. */
  const [settingsSection, setSettingsSection] = useState("");
  /* The intake, reopened from Settings. Held as the profile it starts from
     rather than as a boolean, so "start over" begins from what is already known
     instead of from an empty form — nobody retyping their name is being asked
     anything Construct did not already have. */
  const [retaking, setRetaking] = useState<LearnerProfile | null>(null);
  const { width, dragging, handleProps } = useSidebarWidth();
  const load = useCallback(async () => {
    if (!api) throw new Error("Construct must run inside its Electron desktop shell.");
    setData(await api.bootstrap());
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) => setError(message(cause)));
  }, [load]);

  /* The window's size follows the screen, and the renderer is what knows which
     screen that is. Two fields, then an intake, then the workspace — see
     `fitWindowTo`. Nothing happens until bootstrap answers, because the main
     process already opened the window at the right size for the stage it
     computed; this is for the moves after that. */
  const stage = !data ? null : !data.signedIn ? "sign-in" : !data.onboarded || retaking ? "onboarding" : "app";
  useEffect(() => {
    if (!stage) return;
    void api?.setWindowStage(stage).catch(() => undefined);
  }, [stage]);

  /* Only the project list is re-read after a project write. Re-running the whole
     bootstrap would also re-read the provider inventory, which asks every
     connected subscription for its quota — a network round trip nobody asked for
     because a project was renamed. */
  const refreshProjects = useCallback(async () => {
    if (!api) return;
    const projects = await api.listProjects();
    setData((current) => (current ? { ...current, projects } : current));
  }, []);

  const openProject = useCallback(async (project: ProjectSummary, record = true) => {
    if (!api) return;
    try {
      const detail = await api.openProject({ projectId: project.id });
      setActiveProject(detail.summary);
      setOpenPath(null);
      setPage("workspace");
      if (record) setHistory((current) => visit(current, { page: "workspace", projectId: project.id, path: null }));
      await refreshProjects();
    } catch (cause) {
      setError(message(cause));
    }
  }, [refreshProjects]);

  /* Opening a file is a move, the same way it is in an editor: back after
     opening one should return to the file you were reading, not to the project
     with nothing open. */
  const openFile = useCallback(
    (path: string | null) => {
      setOpenPath(path);
      if (activeProject) {
        setHistory((current) => visit(current, { page: "workspace", projectId: activeProject.id, path }));
      }
    },
    [activeProject],
  );

  /* A page is a place. Recorded here rather than at each call site so a page
     reached from the sidebar and the same page reached from a menu are one
     entry with one meaning. */
  const goToPage = useCallback((next: Page) => {
    setPage(next);
    if (next !== "workspace") {
      setActiveProject(null);
      setHistory((current) => visit(current, { page: next }));
    }
  }, []);

  /**
   * Puts the window back where the history says, without recording the move.
   *
   * Re-entering a workspace goes through `openProject` so the main process
   * reopens it — the project's files, path and concepts are read on open, and
   * restoring the page alone would show a workspace the rest of the app does
   * not believe is open. A project deleted since is dropped rather than
   * reopened.
   */
  const applyView = useCallback(
    (view: View) => {
      if (view.page !== "workspace") {
        setActiveProject(null);
        setOpenConcept(null);
        setPage(view.page);
        return;
      }

      const project = data?.projects.find((entry) => entry.id === view.projectId);
      if (!project) return;

      if (activeProject?.id === project.id) {
        setOpenPath(view.path);
        setPage("workspace");
        return;
      }
      void openProject(project, false).then(() => setOpenPath(view.path));
    },
    [activeProject?.id, data?.projects, openProject],
  );

  /* Read outside the updater on purpose. Applying the view from inside one
     would put a side effect in a function React is free to call twice — which
     it does in development — and reopening a project twice per click is not
     something the second call makes harmless. */
  const navigate = useCallback(
    (direction: -1 | 1) => {
      const moved = step(history, direction);
      if (!moved) return;
      setHistory(moved.history);
      applyView(moved.view);
    },
    [applyView, history],
  );

  const nav = {
    canBack: canGoBack(history),
    canForward: canGoForward(history),
    onBack: () => navigate(-1),
    onForward: () => navigate(1),
  };

  /* The platform's own shortcuts for this. Bound on the window rather than in
     the menu because they have to work wherever focus is, including inside the
     editor — an editor that swallowed cmd-[ would make the buttons the only way
     back, which is the thing a shortcut exists to avoid. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key === "[") navigate(-1);
      else if (event.key === "]") navigate(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

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
      setHistory((current) => forget(current, project.id));
      if (activeProject?.id === project.id) {
        setActiveProject(null);
        setOpenPath(null);
        setPage("projects");
      }
      settle(api?.deleteProject({ projectId: project.id }));
    },
  };

  const loadConcepts = useCallback(async () => {
    if (!api || !activeProject) return;
    setConcepts(await api.listConcepts({ projectId: activeProject.id }).catch(() => []));
  }, [activeProject]);

  useEffect(() => {
    void loadConcepts();
  }, [loadConcepts]);

  /* The path the agent is teaching against. It has existed in the model since
     the agent could plan one, and nothing in the window ever showed it. */
  const loadPath = useCallback(async () => {
    if (!api || !activeProject) return;
    setPath(await api.readPath({ projectId: activeProject.id }).catch(() => null));
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject) setPath(null);
    void loadPath();
  }, [activeProject, loadPath]);

  /* A turn is exactly when mastery moves and when the path is revised, so both
     are re-read then rather than polled. */
  useEffect(() => {
    return api?.onAgentEvent((event) => {
      if (event.projectId !== activeProject?.id) return;
      /* The project named itself while the learner was already inside it. Both
         the open project and the sidebar's list hold a copy of the name, so
         both are told. */
      if (event.kind === "renamed") {
        setActiveProject((current) => (current && current.id === event.projectId ? { ...current, name: event.name } : current));
        void refreshProjects();
      }
      if (event.kind === "concepts" || event.kind === "done") void loadConcepts();
      if (event.kind === "path" || event.kind === "done") void loadPath();
    });
  }, [activeProject?.id, loadConcepts, loadPath, refreshProjects]);

  /**
   * Opens a concept the transcript named, by id.
   *
   * Re-reads before giving up. A concept card is drawn the instant
   * `record-concept` runs, and the refreshed list only arrives on the next
   * `concepts` event — so clicking the card the moment it appeared found
   * nothing in the loaded list and silently did nothing, which is
   * indistinguishable from a dead button.
   */
  const openConceptById = useCallback(
    async (conceptId: string) => {
      const known = concepts.find((entry) => entry.conceptId === conceptId);
      if (known) {
        setOpenConcept(known);
        return;
      }
      if (!api || !activeProject) return;
      const fresh = await api.listConcepts({ projectId: activeProject.id }).catch(() => []);
      setConcepts(fresh);
      const found = fresh.find((entry) => entry.conceptId === conceptId);
      if (found) setOpenConcept(found);
      else setError("Construct has not written that concept up yet.");
    },
    [activeProject, concepts],
  );

  /* Read when the Atlas is opened rather than at boot: it is a join across
     every project, and a learner who never opens the page should never pay for
     it. Re-read on demand after a delete. */
  const loadAtlas = useCallback(async () => {
    if (!api) return;
    setAtlas(await api.conceptAtlas().catch(() => []));
  }, []);

  useEffect(() => {
    if (page === "concepts") void loadAtlas();
  }, [loadAtlas, page]);

  const setTheme = useCallback(async (theme: ThemePreference) => {
    await api?.setTheme(theme);
    setData((current) => (current ? { ...current, theme } : current));
  }, []);

  /* Resolves the preference into the `dark` class every token in theme.css is
     keyed off, and keeps following the system while the preference is "system".
     
     This was missing entirely: main.tsx set the class once at boot from the
     system query and nothing ever changed it again, so choosing Light or Dark
     in Settings updated Electron's nativeTheme — the window material — while
     every colour in the interface stayed where it started. Half the app
     switched and half did not. */
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const resolvedDark = data?.theme === "dark" || (data?.theme !== "light" && query.matches);
      document.documentElement.classList.toggle("dark", resolvedDark);
    };
    sync();
    if (data?.theme === "system" || !data) query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [data?.theme]);

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

  /* Signed in but never met. The intake runs once, between the account and the
     first project — see `OnboardingPage` for why it is worth a screen of its
     own rather than five questions the agent asks in every project it ever
     opens. Anyone who was already using Construct before this existed is
     marked onboarded by the migration and never sees it. */
  if (!data.onboarded || retaking) {
    return (
      <OnboardingPage
        api={api}
        onError={setError}
        onFinished={async () => {
          setRetaking(null);
          await load();
        }}
        profile={retaking ?? data.learner}
      />
    );
  }

  return (
    <div className="app-vibrant relative flex h-dvh overflow-hidden">
      <AnimatePresence initial={false}>
        {sidebar && (
          /* The column, which is only ever a window onto the sidebar.
             
             It used to be the sidebar: one element whose width animated from
             zero, with `<Sidebar/>` filling whatever it was that frame. So
             every frame of the collapse re-laid-out the entire source list at a
             new width — labels rewrapping, names re-truncating, the project
             rows reflowing — which is the churn that made this read as a
             browser panel rather than a native one, and it was the most
             expensive animation in the window besides.
             
             Now nothing inside it changes size at all. The sidebar below is
             pinned to its full width and slides; this clips. The two run on the
             same curve, so the sidebar's right edge sits exactly on the clip
             edge for the whole travel: a pure slide, no stretch, no reflow, and
             the icons never move relative to the words beside them. */
          <motion.div
            initial={{ width: 0 }}
            animate={{ width }}
            exit={{ width: 0 }}
            /* No transition while the divider is being dragged: the width is
               animated so collapsing eases, and the same easing applied to a
               drag leaves the edge lagging a frame behind the cursor. */
            transition={dragging ? { duration: 0 } : SIDEBAR_SLIDE}
            className="relative shrink-0 overflow-hidden"
          >
          <motion.div
            /* Laid out once, at the width it will still be when the animation
               ends. `will-change` because this is the one element in the window
               that is worth a compositor layer of its own — a whole source list
               being moved, sixty times a second. */
            className="h-full will-change-transform"
            style={{ width }}
            initial={{ x: -width }}
            animate={{ x: 0 }}
            exit={{ x: -width }}
            transition={dragging ? { duration: 0 } : SIDEBAR_SLIDE}
          >
            <Sidebar
              page={page}
              api={api}
              email={data.email ?? "Signed in"}
              projects={data.projects}
              activeProjectId={activeProject?.id ?? undefined}
              projectActions={actions}
              nav={nav}
              atlasView={
                page === "concepts" ? (
                  <AtlasTree
                    concepts={atlas ?? []}
                    onSelect={(concept) => setAtlasSelected(`${concept.projectId}:${concept.conceptId}`)}
                    selectedKey={atlasSelected}
                  />
                ) : undefined
              }
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
                          onOpenFile={openFile}
                          onError={setError}
                        />
                      ),
                      path: <PathList activeStepId={path?.currentNodeId ?? null} path={path} />,
                      concepts: (
                        <ConceptTree
                          activeConceptId={openConcept?.conceptId ?? null}
                          concepts={concepts}
                          onOpen={setOpenConcept}
                        />
                      ),
                    }
                  : undefined
              }
              /* Offered from everywhere except the projects list itself. It
                 used to be workspace-only, because the wordmark that carried it
                 was decoration the rest of the time; a home button that does
                 nothing on Settings would just be a broken button. */
              onGoHome={
                page === "projects"
                  ? undefined
                  : () => {
                      setOpenPath(null);
                      setOpenConcept(null);
                      goToPage("projects");
                    }
              }
              onPage={goToPage}
              onOpenProject={(project) => void openProject(project)}
              onNewProject={() => {
                goToPage("projects");
                setCreating(true);
              }}
              onCollapse={() => {
                setSidebar(false);
                localStorage.setItem("construct.sidebar", "hidden");
              }}
            />
          </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The divider. Wider than it looks: the visible line is a hairline, but a
          hairline is not a target anyone can hit, so the grab area is eight
          pixels straddling it and the line inside is what lights up. */}
      {sidebar && (
        <div
          aria-label="Resize the sidebar"
          aria-orientation="vertical"
          className="group/divider app-no-drag relative z-20 -mx-1 w-2 shrink-0 cursor-col-resize"
          role="separator"
          {...handleProps}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150",
              dragging ? "bg-ring/60" : "bg-transparent group-hover/divider:bg-ring/30",
            )}
          />
        </div>
      )}

      <main
        className={cn(
          "relative flex min-w-0 flex-1 flex-col",
          /* The pane fill covers everything to the right of the sidebar,
             including the toolbar row. Excluding the workspace from it left the
             toolbar sitting on bare vibrancy: a band of wallpaper blue above
             near-opaque panels, which is the single ugliest thing in the window.
             The sidebar stays translucent — it is the one surface where the
             native material is the point. */
          "app-pane",
          /* The content pane's rounded leading corners and inset ring arrive
             with the sidebar rather than the instant it is asked for. */
          "transition-[border-radius,box-shadow]",
          SIDEBAR_SLIDE_CSS,
          sidebar && "app-content-pane",
        )}
      >
        {page !== "workspace" && (
          <Toolbar
            nav={sidebar ? undefined : nav}
            subtitle={page === "settings" ? settingsSection : undefined}
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

        {/* Pages that lay out their own panes scroll inside them; the rest are a
            single column and scroll here. */}
        <div className={cn("min-h-0 flex-1", page === "concepts" || page === "settings" ? "overflow-hidden" : "overflow-y-auto")}>
          {page === "projects" && (
            <ProjectsPage
              api={api}
              defaults={data.projectDefaults}
              projects={data.projects}
              creating={creating}
              onCreatingChange={setCreating}
              onOpen={(project) => void openProject(project)}
              onChanged={refreshProjects}
              onError={setError}
            />
          )}

          {page === "concepts" && (
            <ConceptsPage
              api={api}
              concepts={atlas}
              onChanged={loadAtlas}
              onError={setError}
              onSelect={setAtlasSelected}
              selectedKey={atlasSelected}
            />
          )}

          {page === "settings" && (
            <SettingsPage
              api={api}
            onRetakeIntake={setRetaking}
            onProjectDefaults={(projectDefaults) => setData((current) => (current ? { ...current, projectDefaults } : current))}
              onSection={setSettingsSection}
              onSignedOut={load}
              onThemeChange={setTheme}
              projectDefaults={data.projectDefaults}
              theme={data.theme}
            />
          )}

          {page === "workspace" && activeProject && (
            <Workspace
              /* Keyed, so switching projects builds a fresh workspace rather
                 than reusing one holding the previous project's open tabs,
                 editor buffers and terminal. */
              key={activeProject.id}
              api={api}
              nav={sidebar ? undefined : nav}
              concept={openConcept}
              concepts={concepts}
              onCloseConcept={() => setOpenConcept(null)}
              onError={setError}
              onExpandSidebar={
                sidebar
                  ? undefined
                  : () => {
                      setSidebar(true);
                      localStorage.setItem("construct.sidebar", "shown");
                    }
              }
              onOpenConcept={setOpenConcept}
              onOpenConceptId={(conceptId) => void openConceptById(conceptId)}
              onOpenSettings={() => setPage("settings")}
              openPath={openPath}
              project={activeProject}
            />
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
