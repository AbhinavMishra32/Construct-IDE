import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, MessageSquare, SquareTerminal, X } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { isLspLanguage, languageForPath } from "@construct/domain";
import type { ConstructApi, ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { LanguageClient } from "@/lib/lsp/client";
import { Toolbar } from "../shell/Toolbar";
import { Editor } from "./Editor";
import { TerminalPanel } from "./TerminalPanel";
import { AgentPanel } from "./AgentPanel";

type OpenFile = { path: string; content: string; dirty: boolean };

type Props = {
  api: ConstructApi | undefined;
  project: ProjectSummary;
  /** The file the tree asked to open, lifted to the shell because the tree now
   *  lives in the sidebar rather than inside this component. */
  openPath: string | null;
  onError(message: string): void;
};

/** How long after the last keystroke a file is written. Long enough that
 *  typing a word is one write, short enough that nothing is lost by closing
 *  the window a second after stopping. */
const SAVE_DEBOUNCE_MS = 600;

export function Workspace({ api, project, openPath, onError }: Props) {
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
      {/* The shell's own toolbar rather than a bespoke header: it carries the
          title-bar height, the drag region, and the inset the OS window buttons
          need, none of which a hand-rolled row would have had. */}
      <Toolbar title={current ? (current.path.split("/").pop() ?? project.name) : project.name} subtitle={current?.path} />

      <div className="flex min-h-0 flex-1">
        <PanelGroup direction="horizontal" className="min-w-0 flex-1">
        <Panel defaultSize={agentOpen ? 62 : 100} minSize={30} className="app-pane flex min-w-0 flex-col">
          {files.length > 0 && (
            <div role="tablist" className="hairline-b app-scroll flex h-8 shrink-0 items-stretch overflow-x-auto">
              {files.map((file) => (
                <div
                  key={file.path}
                  role="tab"
                  aria-selected={file.path === active}
                  className={cn(
                    "group/tab relative flex shrink-0 items-center gap-1.5 pl-3 pr-1.5 text-ui transition-colors",
                    file.path === active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* The active tab is marked by a rule along its base rather
                      than a filled block: the strip sits on the same material as
                      the editor, and a fill would read as a second surface
                      floating on it. */}
                  {file.path === active && <span className="absolute inset-x-0 bottom-0 h-px bg-foreground/70" />}
                  <button type="button" onClick={() => setActive(file.path)} className="outline-none">
                    {file.path.split("/").pop()}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${file.path}`}
                    className="grid size-4 place-items-center rounded-sm hover:bg-accent"
                    onClick={() => closeFile(file.path)}
                  >
                    {/* A dot for unsaved, becoming the close control on hover —
                        the affordance every editor uses, so an unsaved file
                        costs no extra chrome. */}
                    {file.dirty && <span className="size-1.5 rounded-full bg-foreground/50 group-hover/tab:hidden" />}
                    <X className={cn("size-3", file.dirty && "hidden group-hover/tab:block")} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <PanelGroup direction="vertical" className="min-h-0 flex-1">
            <Panel defaultSize={70} minSize={20}>
              {current ? (
                <Editor path={current.path} content={current.content} onChange={(value) => edit(current.path, value)} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <FileCode2 className="size-5 text-muted-foreground/70" />
                  <p className="text-ui text-muted-foreground">Pick a file to start reading.</p>
                </div>
              )}
            </Panel>

            {terminalOpen && (
              <>
                {/* A one-pixel rule with an invisible grab area above it: a
                    handle you can only hit dead-on is a handle you miss. */}
                <PanelResizeHandle className="relative h-px bg-[var(--border)] after:absolute after:inset-x-0 after:-top-1 after:h-2 after:content-[''] data-[resize-handle-state=drag]:bg-ring" />
                <Panel defaultSize={30} minSize={10}>
                  <TerminalPanel
                    api={api}
                    projectId={project.id}
                    terminalId={terminalId}
                    /* The shell exited on its own. A fresh id means reopening
                       starts a new shell rather than writing into a dead pty. */
                    onExit={() => {
                      setTerminalOpen(false);
                      setTerminalId(crypto.randomUUID());
                    }}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>

          <footer className="hairline-t flex h-6 shrink-0 items-center gap-3 px-2 text-ui-sm text-muted-foreground">
            <button
              type="button"
              aria-pressed={terminalOpen}
              onClick={() => setTerminalOpen((open) => !open)}
              className={cn(
                "flex h-4 items-center gap-1 rounded-sm px-1 transition-colors hover:text-foreground",
                terminalOpen && "text-foreground",
              )}
            >
              <SquareTerminal className="size-3" /> Terminal
            </button>
            <button
              type="button"
              aria-pressed={agentOpen}
              onClick={() => setAgentOpen((open) => !open)}
              className={cn(
                "flex h-4 items-center gap-1 rounded-sm px-1 transition-colors hover:text-foreground",
                agentOpen && "text-foreground",
              )}
            >
              <MessageSquare className="size-3" /> Construct
            </button>
            {current && <span className="truncate">{current.path}</span>}
            {current?.dirty && <span className="ml-auto">Saving…</span>}
          </footer>
        </Panel>

        {agentOpen && (
          <>
            <PanelResizeHandle className="relative w-px bg-[var(--border)] after:absolute after:inset-y-0 after:-left-1 after:w-2 after:content-[''] data-[resize-handle-state=drag]:bg-ring" />
            <Panel defaultSize={38} minSize={22} className="app-pane app-panel-glass flex min-w-0 flex-col">
              <AgentPanel api={api} projectId={project.id} onError={onError} />
            </Panel>
          </>
        )}
        </PanelGroup>
      </div>
    </div>
  );
}
