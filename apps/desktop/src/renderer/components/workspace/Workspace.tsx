import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, MessageSquare, RotateCcw, SquareTerminal, Trash2, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { isLspLanguage, languageForPath } from "@construct/domain";
import type { ConstructApi, ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { LanguageClient } from "@/lib/lsp/client";
import { Toolbar } from "../shell/Toolbar";
import { Editor } from "./Editor";
import { TerminalPanel } from "./TerminalPanel";
import { AgentPanel } from "./AgentPanel";
import { LanguageGlyph } from "../common/LanguageGlyph";

type OpenFile = { path: string; content: string; dirty: boolean };

type Props = {
  api: ConstructApi | undefined;
  project: ProjectSummary;
  onOpenSettings(): void;
  /** The file the tree asked to open, lifted to the shell because the tree now
   *  lives in the sidebar rather than inside this component. */
  openPath: string | null;
  onError(message: string): void;
};

/** How long after the last keystroke a file is written. Long enough that
 *  typing a word is one write, short enough that nothing is lost by closing
 *  the window a second after stopping. */
const SAVE_DEBOUNCE_MS = 600;

export function Workspace({ api, project, openPath, onError, onOpenSettings }: Props) {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* One terminal id per project visit, so closing and reopening the panel
     returns to the same shell rather than leaving the old one running. */
  const [terminalId, setTerminalId] = useState(() => crypto.randomUUID());
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(true);
  /* One client per language, started when a file of that language is first
     opened. Starting every server up front would spawn a TypeScript server for
     a project with no TypeScript in it. */
  const clients = useRef(new Map<string, LanguageClient>());

  const clientFor = useCallback(
    async (filePath: string) => {
      const language = languageForPath(filePath);
      if (!api || !language || !isLspLanguage(language)) return null;

      /* TypeScript and JavaScript share one server — it is the same server, and
         two of them on one project would each index it. */
      const key = language === "javascript" ? "typescript" : language;
      const existing = clients.current.get(key);
      if (existing) return existing;

      const client = new LanguageClient(api, `${project.id}:${key}`, project.id, project.directory, key);
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

  const openFile = useCallback(
    async (path: string) => {
      setActive(path);
      /* Already open: switch to it and keep the buffer. Re-reading from disk
         would discard unsaved edits every time the file was clicked. */
      if (files.some((file) => file.path === path)) return;

      try {
        const content = await api!.readFile({ projectId: project.id, path });
        setFiles((current) => [...current, { path, content, dirty: false }]);
        void clientFor(path).then((client) => client?.sync(path, content));
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Construct could not open that file.");
        setActive((current) => (current === path ? null : current));
      }
    },
    [api, files, project.id, onError, clientFor],
  );

  const closeFile = useCallback((path: string) => {
    setFiles((current) => {
      const remaining = current.filter((file) => file.path !== path);
      setActive((currentPath) => (currentPath === path ? (remaining.at(-1)?.path ?? null) : currentPath));
      return remaining;
    });
  }, []);

  const edit = useCallback(
    (path: string, value: string) => {
      setFiles((current) => current.map((file) => (file.path === path ? { ...file, content: value, dirty: true } : file)));
      /* Sent on every keystroke rather than on save: diagnostics that appear
         only once a file is written arrive after the learner has moved on. */
      void clientFor(path).then((client) => client?.sync(path, value));

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
    [api, project.id, onError, clientFor],
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

  const current = files.find((file) => file.path === active) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The shell's toolbar, carrying the title-bar height, the drag region and
          the window-control inset — and the panel toggles, which used to sit on
          a strip along the bottom. A whole row of chrome for two switches and a
          path the tab already showed was the worst trade in the window. */}
      <Toolbar
        /* The project names the window; the file is named by its own tab. A
           subtitle only earns its place when it says something the title does
           not — a nested path, or that the file is saving. */
        title={project.name}
        subtitle={current?.dirty ? "Saving…" : current?.path.includes("/") ? current.path : undefined}
        actions={
          <>
            <ToolbarToggle icon={SquareTerminal} label="Terminal" on={terminalOpen} onClick={() => setTerminalOpen((open) => !open)} />
            <ToolbarToggle icon={MessageSquare} label="Construct" on={agentOpen} onClick={() => setAgentOpen((open) => !open)} />
          </>
        }
      />

      <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1 gap-1 p-1 pt-0">
        {/* The editor column is layout only. Its children are the objects — the
            terminal used to be nested inside the editor's own panel, which is
            why it could not read as a separate one however it was styled. */}
        <Panel className="flex min-w-0 flex-col" defaultSize={agentOpen ? 62 : 100} minSize={30}>
          <PanelGroup direction="vertical" className="min-h-0 flex-1 gap-1">
            <Panel className="app-blob flex min-w-0 flex-col" defaultSize={70} minSize={20}>
              {files.length > 0 && (
                <div className="hairline-b app-scroll flex h-8 shrink-0 items-stretch overflow-x-auto" role="tablist">
                  {files.map((file) => (
                    <div
                      aria-selected={file.path === active}
                      className={cn(
                        "group/tab relative flex shrink-0 items-center gap-1.5 pl-3 pr-1.5 text-ui transition-colors",
                        file.path === active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      key={file.path}
                      role="tab"
                    >
                      {/* A rule along the base rather than a filled block: the
                          strip shares a surface with the editor, and a fill would
                          read as a second one floating on it. */}
                      {file.path === active && <span className="absolute inset-x-0 bottom-0 h-px bg-foreground/70" />}
                      <button className="flex items-center gap-1.5 outline-none" onClick={() => setActive(file.path)} type="button">
                        <LanguageGlyph className="size-3.5 shrink-0" language={languageForPath(file.path) ?? "typescript"} />
                        {file.path.split("/").pop()}
                      </button>
                      <button
                        aria-label={`Close ${file.path}`}
                        className="grid size-4 place-items-center rounded-sm hover:bg-accent"
                        onClick={() => closeFile(file.path)}
                        type="button"
                      >
                        {/* A dot for unsaved, becoming the close control on
                            hover — the affordance every editor uses, so an
                            unsaved file costs no extra chrome. */}
                        {file.dirty && <span className="size-1.5 rounded-full bg-foreground/50 group-hover/tab:hidden" />}
                        <X className={cn("size-3", file.dirty && "hidden group-hover/tab:block")} />
                      </button>
                    </div>
                  ))}

                  {/* The file's own actions, pushed to the trailing edge of the
                      strip. Reverting is the one destructive thing the editor can
                      do to unsaved work, so it lives where the file is named
                      rather than in a menu. */}
                  {current && (
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-1.5">
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
                    </div>
                  )}
                </div>
              )}

              <div className="min-h-0 flex-1">
                {current ? (
                  <Editor content={current.content} onChange={(value) => edit(current.path, value)} path={current.path} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <FileCode2 className="size-5 text-muted-foreground/70" />
                    <p className="text-ui text-muted-foreground">Pick a file to start reading.</p>
                  </div>
                )}
              </div>
            </Panel>

            {terminalOpen && (
              <>
                {/* The handle lives in the gap between panels, so it is felt
                    rather than drawn: a permanent rule between two objects that
                    are already separated is a line with nothing to do. */}
                <PanelResizeHandle className="h-0.5 shrink-0 rounded-full transition-colors data-[resize-handle-state=drag]:bg-ring/60 data-[resize-handle-state=hover]:bg-ring/30" />
                <Panel className="app-blob flex min-w-0 flex-col" defaultSize={30} minSize={10}>
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
        </Panel>

        {agentOpen && (
          <>
            <PanelResizeHandle className="w-0.5 shrink-0 rounded-full transition-colors data-[resize-handle-state=drag]:bg-ring/60 data-[resize-handle-state=hover]:bg-ring/30" />
            {/* The one surface kept on glass. A conversation is transient and
                should feel like it floats over the work; the editor and terminal
                hold code, which needs a ground it can be read against. */}
            <Panel className="app-blob flex min-w-0 flex-col" defaultSize={38} minSize={22}>
              <AgentPanel api={api} onError={onError} onOpenSettings={onOpenSettings} projectId={project.id} />
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
