import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileCode2, SquareTerminal, X } from "lucide-react";
import type { ConstructApi, ProjectSummary } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Editor } from "./Editor";
import { FileTree } from "./FileTree";
import { TerminalPanel } from "./TerminalPanel";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

type OpenFile = { path: string; content: string; dirty: boolean };

type Props = {
  api: ConstructApi | undefined;
  project: ProjectSummary;
  onBack(): void;
  onError(message: string): void;
};

/** How long after the last keystroke a file is written. Long enough that
 *  typing a word is one write, short enough that nothing is lost by closing
 *  the window a second after stopping. */
const SAVE_DEBOUNCE_MS = 600;

export function Workspace({ api, project, onBack, onError }: Props) {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* One terminal id per project visit. Held in state rather than derived, so
     the panel closing and reopening reuses the same shell instead of leaving
     the old one running and starting another. */
  const [terminalId, setTerminalId] = useState(() => crypto.randomUUID());
  const [terminalOpen, setTerminalOpen] = useState(false);

  const openFile = useCallback(
    async (path: string) => {
      setActive(path);
      /* Already open: switch to it and keep whatever is in the buffer. Re-reading
         from disk here would discard unsaved edits every time the learner
         clicked the file in the tree. */
      if (files.some((file) => file.path === path)) return;

      try {
        const content = await api!.readFile({ projectId: project.id, path });
        setFiles((current) => [...current, { path, content, dirty: false }]);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Construct could not open that file.");
        setActive((current) => (current === path ? null : current));
      }
    },
    [api, files, project.id, onError],
  );

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

  /* Pending writes are flushed on unmount. Leaving the workspace within the
     debounce window would otherwise drop the last edit silently. */
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const current = files.find((file) => file.path === active) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/60">
        <header className="flex h-9 items-center gap-1.5 px-2">
          <Button variant="ghost" size="icon" className="size-6" aria-label="Back to projects" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <span className="truncate text-source font-medium">{project.name}</span>
        </header>
        <FileTree api={api} projectId={project.id} activePath={active} onOpenFile={(path) => void openFile(path)} onError={onError} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {files.length > 0 && (
          <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border/60">
            {files.map((file) => (
              <div
                key={file.path}
                className={cn(
                  "group/tab flex shrink-0 items-center gap-1.5 border-r border-border/60 pl-3 pr-1.5 text-source",
                  file.path === active ? "bg-foreground/6" : "hover:bg-foreground/3",
                )}
              >
                <button type="button" role="tab" aria-selected={file.path === active} onClick={() => setActive(file.path)} className="outline-none">
                  {file.path.split("/").pop()}
                </button>
                {/* A dot, not an asterisk, and it becomes the close button on
                    hover — the same affordance every editor uses, so an unsaved
                    file never costs a separate column of chrome. */}
                <button
                  type="button"
                  aria-label={`Close ${file.path}`}
                  className="grid size-4 place-items-center rounded"
                  onClick={() => {
                    setFiles((rest) => rest.filter((entry) => entry.path !== file.path));
                    setActive((currentPath) =>
                      currentPath === file.path ? (files.find((entry) => entry.path !== file.path)?.path ?? null) : currentPath,
                    );
                  }}
                >
                  {file.dirty ? (
                    <span className="size-1.5 rounded-full bg-foreground/60 group-hover/tab:hidden" />
                  ) : null}
                  <X className={cn("size-3 text-foreground/60", file.dirty && "hidden group-hover/tab:block")} />
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
                <FileCode2 className="size-6 text-muted-foreground" />
                <p className="text-ui text-muted-foreground">Pick a file to start reading.</p>
              </div>
            )}
          </Panel>

          {terminalOpen && (
            <>
              <PanelResizeHandle className="h-px bg-border/60 data-[resize-handle-state=drag]:bg-ring" />
              <Panel defaultSize={30} minSize={10}>
                <TerminalPanel
                  api={api}
                  projectId={project.id}
                  terminalId={terminalId}
                  /* The shell exited on its own — `exit`, or a crash. A fresh id
                     means reopening starts a new shell rather than writing into
                     a pty that is gone. */
                  onExit={() => {
                    setTerminalOpen(false);
                    setTerminalId(crypto.randomUUID());
                  }}
                />
              </Panel>
            </>
          )}
        </PanelGroup>

        <footer className="flex h-7 shrink-0 items-center border-t border-border/60 px-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1.5 px-1.5 text-ui"
            aria-pressed={terminalOpen}
            onClick={() => setTerminalOpen((open) => !open)}
          >
            <SquareTerminal className="size-3.5" /> Terminal
          </Button>
        </footer>
      </div>
    </div>
  );
}
