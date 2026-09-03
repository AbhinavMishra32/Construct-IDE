import { useCallback, useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { FileCode2, MessageSquare, RotateCcw, SquareTerminal, Trash2, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AnimatePresence } from "motion/react";
import { languageForPath } from "@construct/domain";
import type { ConceptSummary, ConstructApi, ProjectSummary, TaskSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { useWorkspaceMemory } from "@/hooks/use-workspace-memory";
import { usePanelReveal } from "@/hooks/use-panel-reveal";
import { LanguageClient } from "@/lib/lsp/client";
import { serverForPath } from "../../../shared/languageServers";
import { WorkspaceBar } from "./WorkspaceBar";
import { ConceptPip } from "./ConceptPip";
import { Editor } from "./Editor";
import { FilePath } from "./FilePath";
import { TerminalPanel } from "./TerminalPanel";
import { AgentPanel } from "./AgentPanel";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { activeTask } from "../agent/taskInput";

type OpenFile = {
  /** Project-relative for the learner's own files. Absolute for a file outside
   *  the project, which is only ever reached by following a definition. */
  path: string;
  content: string;
  dirty: boolean;
  /** Set on files outside the project. They are shown and never saved — see
   *  `openSource`. */
  external?: boolean;
};

type Props = {
  api: ConstructApi | undefined;
  project: ProjectSummary;
  /** Concepts and the one being read are owned by the shell, since the sidebar
   *  lists them and this panel opens them. */
  concepts: ConceptSummary[];
  concept: ConceptSummary | null;
  onOpenConcept(concept: ConceptSummary): void;
  /** Opens a concept the transcript named by id. Separate from `onOpenConcept`
   *  because the id may be one the shell has not loaded yet — a concept card is
   *  drawn the moment `record-concept` runs, which is before the refreshed list
   *  comes back. */
  onOpenConceptId(conceptId: string): void;
  onCloseConcept(): void;
  onOpenSettings(): void;
  /** The file the tree asked to open, lifted to the shell because the tree now
   *  lives in the sidebar rather than inside this component. */
  openPath: string | null;
  /** Supplied only while the shell's sidebar is hidden, so the workspace can
   *  offer the way back — see WorkspaceBar. */
  onExpandSidebar?: (() => void) | undefined;
  /** Passed straight to the bar. Supplied only while the sidebar is hidden — it
   *  carries back and forward the rest of the time. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  onError(message: string): void;
};

/** How long after the last keystroke a file is written. Long enough that
 *  typing a word is one write, short enough that nothing is lost by closing
 *  the window a second after stopping. */
const SAVE_DEBOUNCE_MS = 600;
/** How much of the editor column the terminal takes when open, and the value the
 *  opening animation runs to. */
const TERMINAL_SIZE = 30;
/** The same, for the conversation's share of the window. */
const AGENT_SIZE = 38;

export function Workspace({ api, project, openPath, onError, onExpandSidebar, nav, onOpenSettings, concepts, concept, onOpenConcept, onOpenConceptId, onCloseConcept }: Props) {
  /* What this project looked like last time. Read before the first render so
     the tabs are up on the first frame — see the hook. */
  const { restored, remember } = useWorkspaceMemory(project.id);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  /* The tab the pointer is resting on, which is not the same question as which
     file is open: the path readout answers for whichever tab you are looking
     at, so the strip can be read without opening anything. */
  const [peek, setPeek] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* One terminal id per project visit, so closing and reopening the panel
     returns to the same shell rather than leaving the old one running. */
  const [terminalId, setTerminalId] = useState(() => crypto.randomUUID());
  const [terminalOpen, setTerminalOpen] = useState(restored.terminalOpen);
  const [agentOpen, setAgentOpen] = useState(restored.agentOpen);
  /* Both panes grow and shrink rather than appearing and vanishing — see
     `usePanelReveal`. The terminal already did on the way in; the conversation
     did neither, and closing either one was a single-frame jump that made the
     editor look like it had been re-laid-out rather than resized. */
  /* The size each pane reopens at, kept live rather than read from `restored`:
     that snapshot is taken once per project, so a pane dragged wider and then
     closed would come back at the width it had when the project was opened. */
  const [terminalSize, setTerminalSize] = useState(restored.rows?.[1] ?? TERMINAL_SIZE);
  const [agentSize, setAgentSize] = useState(restored.columns?.[1] ?? AGENT_SIZE);
  const terminal = usePanelReveal(terminalOpen, terminalSize, {
    onCollapse: (rows) => {
      setTerminalSize(rows);
      remember({ rows: [100 - rows, rows] });
    },
  });
  /* `onCollapse` is what makes the conversation come back the width you left it
     at. The group reports a layout on every frame, so what it reports is
     filtered down to the ones that have settled — and a collapse that starts
     from a drag the learner never released settles at nothing. Asking the pane
     itself, at the instant it starts closing, is the one reading that is always
     the width they were looking at.

     `pin` is the other half of the same feeling: the conversation is prose, and
     prose rewraps. See the hook. */
  const agent = usePanelReveal(agentOpen, agentSize, {
    onCollapse: (columns) => {
      setAgentSize(columns);
      remember({ columns: [100 - columns, columns] });
    },
    pin: true,
  });
  /* One client per language, started when a file of that language is first
     opened. Starting every server up front would spawn a TypeScript server for
     a project with no TypeScript in it. */
  const clients = useRef(new Map<string, LanguageClient>());

  /* Reopens the concept this project was last reading.
     
     Waits for `concepts` to arrive rather than firing on mount: the list is
     fetched, so on the first frame it is empty and the id would find nothing.
     Guarded by the project id so it runs once per visit — otherwise closing the
     card would immediately be undone by the next concepts refresh. */
  const reopened = useRef<string | null>(null);
  useEffect(() => {
    const remembered = restored.concept;
    if (!remembered || reopened.current === project.id || concepts.length === 0) return;
    reopened.current = project.id;
    const found = concepts.find((entry) => entry.conceptId === remembered.conceptId);
    /* A concept that has since been forgotten leaves nothing to restore, and the
       stale id is dropped rather than retried on every visit. */
    if (found) onOpenConcept(found);
    else remember({ concept: null });
  }, [concepts, onOpenConcept, project.id, remember, restored.concept]);

  /* Practice tasks, owned here because two surfaces read them: the workspace
     bar shows the one outstanding, and the conversation references any of them
     by id. Two fetches would let the two disagree about a status that changes
     under both of them. */
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  /* Which task the bar's panel is showing, and whether it is open. A chip in
     the transcript can name an older task, so this is an id rather than a
     boolean — clicking a finished task from three turns ago should show that
     task, not the current one. */
  const [shownTask, setShownTask] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    void api?.listTasks({ projectId: project.id }).then(setTasks).catch(() => setTasks([]));
  }, [api, project.id]);

  useEffect(loadTasks, [loadTasks]);

  useEffect(() => {
    return api?.onAgentEvent((event) => {
      if (event.projectId === project.id && event.kind === "tasks") loadTasks();
    });
  }, [api, loadTasks, project.id]);

  /**
   * The learner says a task is done.
   *
   * Flipped locally before the round trip: the status moves in the main process
   * and the review is asked for there too, so without this the button looks
   * unpressed for the seconds until the agent's first token — which is long
   * enough to press again.
   */
  /* What the bar offers: the task the transcript asked to show, or the one
     still outstanding. Falling back rather than requiring a click is what makes
     the bar useful without anybody discovering it first. */
  const outstanding = activeTask(tasks);
  const shown = (shownTask ? tasks.find((task) => task.taskId === shownTask) : null) ?? outstanding ?? undefined;

  const submitTask = useCallback(
    (taskId: string) => {
      if (!api) return;
      setTasks((current) => current.map((task) => (task.taskId === taskId ? { ...task, status: "submitted" as const } : task)));
      void api.submitTask({ projectId: project.id, taskId }).catch((cause: unknown) => {
        loadTasks();
        onError(cause instanceof Error ? cause.message : "Construct could not send that for review.");
      });
    },
    [api, loadTasks, onError, project.id],
  );

  const clientFor = useCallback(
    async (filePath: string) => {
      /* The catalog decides, on the file's extension. One entry can claim
         several languages — TypeScript and JavaScript are the same server, and
         two of them on one project would each index it — so the entry's id is
         the key, and a second file it claims reuses the running server. */
      const entry = api ? serverForPath(filePath) : null;
      if (!api || !entry) return null;

      const key = entry.id;
      const existing = clients.current.get(key);
      if (existing) return existing;

      const client = new LanguageClient(api, `${project.id}:${key}`, project.id, project.directory, entry);
      clients.current.set(key, client);
      try {
        await client.start();
        return client;
      } catch (cause) {
        clients.current.delete(key);
        /* Language intelligence failing is not the editor failing. The file is
           still open and editable, so this is reported and moved past. */
        console.error("Language server did not start:", cause);
        return null;
      }
    },
    [api, project.id, project.directory],
  );

  /**
   * Which paths have a tab, or are about to.
   *
   * A ref rather than derived from `files`, because the guard has to hold
   * across an await. `openFile` read `files` from its closure and checked it
   * *before* reading from disk, so two calls for the same path — the restore
   * loop and the sidebar's `openPath` both asking for the file you left open —
   * each saw an empty list, each read the file, and each appended a tab. That
   * is the duplicate `main.ts` four times over.
   *
   * Claiming the path before the read is what closes the window. Keeping it in
   * a ref also makes `openFile` stable, which matters: it was rebuilt on every
   * `files` change, and the effect that depends on it re-ran each time.
   */
  const claimed = useRef(new Set<string>());

  const openFile = useCallback(
    async (path: string) => {
      setActive(path);
      /* Already open, or already being opened: switch to it and keep the
         buffer. Re-reading from disk would discard unsaved edits every time the
         file was clicked. */
      if (claimed.current.has(path)) return;
      claimed.current.add(path);

      try {
        const content = await api!.readFile({ projectId: project.id, path });
        /* Checked again inside the updater, which is the only place that can
           see the real current list. */
        setFiles((current) =>
          current.some((file) => file.path === path) ? current : [...current, { path, content, dirty: false }],
        );
        /* Started, not fed. The document is a text model the language client
           already watches, so opening a file it claims is enough. */
        void clientFor(path);
      } catch (cause) {
        claimed.current.delete(path);
        onError(cause instanceof Error ? cause.message : "Construct could not open that file.");
        setActive((current) => (current === path ? null : current));
      }
    },
    [api, project.id, onError, clientFor],
  );

  /** Where the editor should put the cursor next, and in which file.
   *
   *  A new object each time rather than a boolean: following the same symbol
   *  twice has to scroll twice, and two identical values would not re-run the
   *  effect that does the scrolling. */
  const [reveal, setReveal] = useState<{ path: string; selection: monaco.IRange } | null>(null);

  /**
   * Opens whatever a definition pointed at, by absolute path.
   *
   * Inside the project this is an ordinary tab. Outside it — `console.log` in a
   * `.d.ts` under node_modules, a Python function in the interpreter's own
   * standard library — the file is read directly from disk and shown read-only.
   * Refusing to open those is what made control-click feel broken: the
   * definition had been found, and then nothing happened.
   */
  const openSource = useCallback(
    async (absolute: string, selection: monaco.IRange | null) => {
      const root = project.directory;
      const inside = absolute === root || absolute.startsWith(`${root}/`) || absolute.startsWith(`${root}\\`);
      /* POSIX separators on the way in, because that is what every other path
         in the workspace is written with — including the tab list and the
         restore snapshot. */
      const path = inside ? absolute.slice(root.length + 1).split(/[\\/]/).join("/") : absolute;

      if (inside) await openFile(path);
      else if (!claimed.current.has(path)) {
        claimed.current.add(path);
        try {
          const content = await api!.readSource({ path });
          setFiles((current) => (current.some((file) => file.path === path) ? current : [...current, { path, content, dirty: false, external: true }]));
        } catch (cause) {
          claimed.current.delete(path);
          onError(cause instanceof Error ? cause.message : "Construct could not open that file.");
          return;
        }
      }

      setActive(path);
      if (selection) setReveal({ path, selection });
    },
    [api, onError, openFile, project.directory],
  );

  /* Held in a ref so the opener below can be registered once. It is a global
     registration — one per window, not one per render — and re-registering it
     on every keystroke would leak handlers into the editor service. */
  const latestOpenSource = useRef(openSource);
  latestOpenSource.current = openSource;

  /**
   * Following a definition, from the editor's side.
   *
   * Monaco on its own can only open a file it is already showing: its editor
   * service looks at the one model the editor holds, and returns nothing for
   * any other URI. Every cross-file jump died there. This hands the decision
   * back to Construct, which has the tabs.
   */
  useEffect(() => {
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, selection) {
        if (resource.scheme !== "file") return false;
        const range = selection
          ? "endLineNumber" in selection
            ? selection
            : { startLineNumber: selection.lineNumber, startColumn: selection.column, endLineNumber: selection.lineNumber, endColumn: selection.column }
          : null;
        void latestOpenSource.current(resource.fsPath, range);
        /* Handled, even though the opening has not finished. Answering false
           would let the default handler try, and the default handler is the one
           that cannot do this. */
        return true;
      },
    });
    return () => opener.dispose();
  }, []);

  const closeFile = useCallback((path: string) => {
    /* Released here too, or reopening a closed tab would be a no-op. */
    claimed.current.delete(path);
    setFiles((current) => {
      const remaining = current.filter((file) => file.path !== path);
      setActive((currentPath) => (currentPath === path ? (remaining.at(-1)?.path ?? null) : currentPath));
      return remaining;
    });
  }, []);

  const edit = useCallback(
    (path: string, value: string) => {
      setFiles((current) => current.map((file) => (file.path === path ? { ...file, content: value, dirty: true } : file)));
      clearTimeout(timers.current.get(path));
      timers.current.set(
        path,
        setTimeout(() => {
          void api
            ?.writeFile({ projectId: project.id, path, content: value })
            .then(() => setFiles((current) => current.map((file) => (file.path === path ? { ...file, dirty: false } : file))))
            .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Construct could not save that file."));
        }, SAVE_DEBOUNCE_MS),
      );
    },
    [api, project.id, onError],
  );

  useEffect(() => {
    const pending = timers.current;
    const running = clients.current;
    const shell = terminalId;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      for (const client of running.values()) client.dispose();
      running.clear();
      /* The shell belongs to the project, not to the terminal panel — so it is
         killed when the project closes, and survives the panel being collapsed
         and reopened with a build still running in it. */
      void api?.disposeTerminal({ terminalId: shell });
    };
  }, [api, terminalId]);

  /* The sidebar owns the tree, so opening arrives as a prop rather than a
     callback. Keyed on the path so asking for the same file twice is a no-op
     rather than a re-read that would discard unsaved edits. */
  useEffect(() => {
    if (openPath) void openFile(openPath);
  }, [openPath, openFile]);

  /* Reopen last visit's tabs, once per project.
     
     Guarded by a ref rather than by an empty dependency list: `openFile` is
     rebuilt whenever `files` changes, so an effect keyed on it would re-run
     after every restored tab and restore them all over again. */
  const rehydrated = useRef<string | null>(null);
  useEffect(() => {
    if (rehydrated.current === project.id) return;
    rehydrated.current = project.id;
    if (restored.open.length === 0) return;
    void (async () => {
      /* Sequential, so the tab order matches the order they were in — and files
         that have since been deleted simply drop out, because `openFile` reports
         its own failure and leaves the rest alone. */
      for (const path of restored.open) await openFile(path).catch(() => undefined);
      if (restored.active) setActive(restored.active);
    })();
  }, [openFile, project.id, restored]);

  /* Written on change rather than on an interval. Every one of these is a
     deliberate act — opening a tab, switching, toggling a panel — so there is
     nothing to debounce. */
  useEffect(() => {
    if (rehydrated.current !== project.id) return;
    /* Only the project's own files are remembered. A tab on something outside
       it was opened by following a definition, and restoring one next visit
       would be a tab the learner never asked for on a file they may not
       recognise. */
    const own = files.filter((file) => !file.external).map((file) => file.path);
    remember({ open: own, active: own.includes(active ?? "") ? active : null, terminalOpen, agentOpen });
  }, [active, agentOpen, files, project.id, remember, terminalOpen]);

  const current = files.find((file) => file.path === active) ?? null;
  /* Whose path the strip is reporting: the tab under the pointer while there is
     one, and the open file the rest of the time. */
  const described = (peek === null ? null : files.find((file) => file.path === peek)) ?? current;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceBar
        agentOpen={agentOpen}
        onExpandSidebar={onExpandSidebar}
        nav={nav}
        onOpenFile={(path) => void openFile(path)}
        onSubmitTask={submitTask}
        onTaskOpenChange={(open) => setShownTask(open ? (shown?.taskId ?? null) : null)}
        task={shown}
        taskOpen={shownTask !== null}
        onToggleAgent={() => setAgentOpen((open) => !open)}
        onToggleTerminal={() => setTerminalOpen((open) => !open)}
        project={project}
        terminalOpen={terminalOpen}
      />



      {/* Both groups report their layout back so the columns come up where you
          left them. `autoSaveId` is not used: it keys on the group's own id and
          would share one layout across every project. */}
      <PanelGroup
        className="min-h-0 min-w-0 flex-1 gap-1 p-1 pt-0"
        direction="horizontal"
        /* Only once the conversation has finished moving. Every frame of the
           reveal is a layout change, and remembering one would store the pane
           mid-animation — a column closed to nothing would be remembered as
           nothing wide and reopen to nothing at all. */
        onLayout={(columns) => {
          if (!agent.settled()) return;
          remember({ columns });
          if (columns[1]) setAgentSize(columns[1]);
        }}
      >
        {/* The editor column is layout only. Its children are the objects — the
            terminal used to be nested inside the editor's own panel, which is
            why it could not read as a separate one however it was styled. */}
        {/* `relative` so the floating concept is positioned against the editor
            column: it hovers over the code it explains, never over the
            conversation that raised it. */}
        <Panel className="relative flex min-w-0 flex-col" defaultSize={restored.columns?.[0] ?? (agentOpen ? 62 : 100)} minSize={30}>
          <PanelGroup className="min-h-0 flex-1 gap-1" direction="vertical" onLayout={(rows) => {
              if (!terminal.settled()) return;
              remember({ rows });
              if (rows[1]) setTerminalSize(rows[1]);
            }}>
            <Panel className="app-blob flex min-w-0 flex-col" defaultSize={restored.rows?.[0] ?? 70} minSize={20}>
                {/* Pills, not a filing strip.
                    
                    Tabs used to be full-height blocks butted against each other,
                    so the strip read as a row of cells and the active one had to
                    be marked with a coloured seat to stand out at all. As pills
                    the strip is mostly empty space and only the open file carries
                    a surface, which is the whole signal — nothing else has to be
                    drawn to say which is in front.
                    
                    The close control is part of the same idea: it appears on the
                    tab you are pointing at and on the active one, and nowhere
                    else. Twelve tabs each showing an × is twelve invitations to
                    lose your place. */}
              {files.length > 0 && (
                <div className="flex h-10 shrink-0 items-center">
                {/* The tabs scroll; what follows them does not. Keeping the two
                    apart is what lets the path sit at the trailing edge and
                    stay there once the strip is long enough to overflow. */}
                <div
                  className="app-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5"
                  onMouseLeave={() => setPeek(null)}
                  role="tablist"
                >
                  {files.map((file) => {
                    const open = file.path === active;
                    return (
                      <div
                        aria-selected={open}
                        className={cn(
                          /* Rounded to the full half-height and still a
                             squircle, which is the pair that matters: an arc at
                             50% would be a capsule, and this keeps a continuous
                             corner. It went `--radius-lg` to `--radius-xl` to
                             this, and the scale ran out before the shape did,
                             so it asks for the height rather than a number off
                             a scale with no rung left. Anything rounder than
                             this now comes out of `.app-squircle`'s exponent,
                             not out of here. */
                          "group/tab app-squircle flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-full pl-2 pr-1 text-ui transition-colors",
                          open
                            /* 5%, not 7%. The fill only has to say which tab
                               you are in, and against a light window at this
                               radius a 7% wash read as a grey object sitting on
                               the chrome rather than as a selection. Hover
                               steps back to 3% so the two stay a rung apart. */
                            ? "bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-foreground"
                            : "text-muted-foreground hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] hover:text-foreground",
                        )}
                        key={file.path}
                        onClick={() => setActive(file.path)}
                        onMouseEnter={() => setPeek(file.path)}
                        role="tab"
                      >
                        <LanguageGlyph className="size-3.5 shrink-0" language={languageForPath(file.path) ?? "typescript"} />
                        <span className="max-w-[10rem] truncate">{file.path.split("/").pop()}</span>
                        <button
                          aria-label={`Close ${file.path}`}
                          /* Held back on the tabs you are not using, but never on
                             a dirty one — an unsaved file has to keep saying so.
                             The button gets its own hover fill so the target is
                             visible before it is hit. */
                          className={cn(
                            "grid size-[1.125rem] shrink-0 place-items-center rounded-md transition-[background-color,opacity] outline-none",
                            "hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]",
                            open || file.dirty ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
                          )}
                          onClick={(event) => { event.stopPropagation(); closeFile(file.path); }}
                          type="button"
                        >
                          {/* A dot for unsaved, becoming the close control on
                              hover — the affordance every editor uses, so an
                              unsaved file costs no extra chrome. */}
                          {file.dirty && <span className="size-1.5 rounded-full bg-foreground/60 group-hover/tab:hidden" />}
                          <X className={cn("size-3", file.dirty && "hidden group-hover/tab:block")} />
                        </button>
                      </div>
                    );
                  })}

                </div>

                  {/* The trailing edge: where the file is, and what can be done
                      to it. Reverting is the one destructive thing the editor
                      can do to unsaved work, so it lives where the file is
                      named rather than in a menu. */}
                  <div className="flex min-w-0 max-w-[45%] shrink items-center gap-0.5 pl-1 pr-1.5">
                    {described && (
                      <FilePath
                        directory={project.directory}
                        external={described.external ?? false}
                        path={described.path}
                        peeking={peek !== null}
                      />
                    )}
                    {current && !current.external && (
                      <PaneAction
                        icon={RotateCcw}
                        label="Revert to the file on disk"
                        onClick={() => {
                          void api
                            ?.readFile({ projectId: project.id, path: current.path })
                            .then((content) => setFiles((rest) => rest.map((file) => (file.path === current.path ? { ...file, content, dirty: false } : file))))
                            .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Could not reload that file."));
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1">
                {current ? (
                  <Editor
                    content={current.content}
                    directory={project.directory}
                    onChange={(value) => edit(current.path, value)}
                    path={current.path}
                    readOnly={current.external ?? false}
                    reveal={reveal && reveal.path === current.path ? reveal : null}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 px-8 text-center">
                    <FileCode2 className="size-5 text-muted-foreground/50" />
                    <p className="text-content text-muted-foreground">Pick a file from the sidebar</p>
                    {/* The goal, again, because this is the emptiest moment in
                        the window and the one where a reminder of what you are
                        building is worth most. */}
                    <p className="max-w-sm text-ui leading-[1.5] text-muted-foreground/60">{project.goal}</p>
                  </div>
                )}
              </div>
            </Panel>

            {terminal.present && (
              <>
                {/* The handle lives in the gap between panels, so it is felt
                    rather than drawn: a permanent rule between two objects that
                    are already separated is a line with nothing to do. */}
                <PanelResizeHandle className="h-0.5 shrink-0 rounded-full transition-colors data-[resize-handle-state=drag]:bg-ring/60 data-[resize-handle-state=hover]:bg-ring/30" />
                <Panel className="app-blob flex min-w-0 flex-col" defaultSize={0} minSize={terminal.minSize(10)} ref={terminal.panel}>
                  <div className="hairline-b flex h-8 shrink-0 items-center gap-1.5 px-3">
                    <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-ui text-muted-foreground">Terminal</span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <PaneAction
                        icon={Trash2}
                        label="Start a fresh shell"
                        onClick={() => setTerminalId(crypto.randomUUID())}
                      />
                      <PaneAction icon={X} label="Close the terminal" onClick={() => setTerminalOpen(false)} />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
                  <TerminalPanel
                    api={api}
                    onExit={() => {
                      setTerminalOpen(false);
                      setTerminalId(crypto.randomUUID());
                    }}
                    projectId={project.id}
                    terminalId={terminalId}
                  />
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>

          <AnimatePresence>
            {concept && (
              <ConceptPip
                api={api}
                concept={concept}
                projectId={project.id}
                initial={restored.concept?.conceptId === concept.conceptId ? restored.concept : undefined}
                key={concept.conceptId}
                onArrange={(state) => remember({ concept: { conceptId: concept.conceptId, ...state } })}
                onClose={() => {
                  /* Forgotten as well as closed: reopening the project should
                     not bring back a card the learner dismissed. */
                  remember({ concept: null });
                  onCloseConcept();
                }}
              />
            )}
          </AnimatePresence>
        </Panel>

        {agent.present && (
          <>
            <PanelResizeHandle className="w-0.5 shrink-0 rounded-full transition-colors data-[resize-handle-state=drag]:bg-ring/60 data-[resize-handle-state=hover]:bg-ring/30" />
            {/* The one surface with no card around it. A conversation is not an
                object you look at the way you look at a file; it sits directly on
                the window's own ground, while the editor and terminal keep the
                blob that gives code a surface to be read against. */}
            <Panel className="flex min-w-0 flex-col overflow-hidden" defaultSize={0} minSize={agent.minSize(22)} ref={agent.panel}>
              {/* The conversation stays. Opening a concept used to close it,
                  which made reading the idea and reading the answer that raised
                  it mutually exclusive — see `ConceptPip`, which floats over the
                  editor instead. */}
              {/* Held at one width while the pane travels, and faded rather than
                  squeezed. Without this the transcript rewraps on every frame of
                  the collapse — the paragraphs reflow, the composer changes row
                  count, and what should read as a panel sliding away reads as a
                  page being re-rendered fifteen times. */}
              <div className="flex min-h-0 flex-1 flex-col" ref={agent.content.ref} style={agent.content.style}>
              <AgentPanel
                api={api}
                  language={project.language}
                  onShowTask={setShownTask}
                  tasks={tasks}
                onError={onError}
                onOpenConcept={onOpenConceptId}
                onOpenFile={(path) => void openFile(path)}
                onOpenSettings={onOpenSettings}
                projectId={project.id}
              />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}

function ToolbarToggle({
  icon: Icon,
  label,
  on,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  on: boolean;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={on}
      className={cn(
        "app-no-drag grid size-6 shrink-0 place-items-center rounded-md transition-colors",
        on ? "bg-[var(--sidebar-accent-active)] text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/** A small action on a pane header. Sized to the header row rather than to a
 *  button, so a pane's chrome stays one line tall whatever is in it. */
function PaneAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="grid size-5 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="size-3" />
    </button>
  );
}
