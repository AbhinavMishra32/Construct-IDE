import { useCallback, useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { languageForPath } from "@construct/domain";
import { LanguageGlyph } from "../common/LanguageGlyph";
import type { ConstructApi, WorkspaceEntry } from "../../../shared/api";
import { cn } from "@/lib/utils";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  activePath: string | null;
  onOpenFile(path: string): void;
  onError(message: string): void;
};

/**
 * The project's files, one directory at a time.
 *
 * Children are fetched when a folder is opened rather than up front. A project
 * is a real repository, so eagerly walking it would mean thousands of stat
 * calls before the first row could be drawn — and almost all of that work is
 * for folders nobody opens.
 */
export function FileTree({ api, projectId, activePath, onOpenFile, onError }: Props) {
  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto pb-2">
      <Directory api={api} projectId={projectId} directory="" depth={0} activePath={activePath} onOpenFile={onOpenFile} onError={onError} />
    </div>
  );
}

function Directory({
  api,
  projectId,
  directory,
  depth,
  activePath,
  onOpenFile,
  onError,
}: Props & { directory: string; depth: number }) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setEntries(await api.listFiles({ projectId, ...(directory ? { directory } : {}) }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Construct could not read that folder.");
      /* An empty list, not null: null means "still loading" and would leave a
         permanent spinner where a folder failed to read. */
      setEntries([]);
    }
  }, [api, projectId, directory, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!entries) return null;

  return (
    <ul className="px-1.5">
      {entries.map((entry) => {
        const expanded = open.has(entry.path);
        return (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => {
                if (entry.type === "file") {
                  onOpenFile(entry.path);
                  return;
                }
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                });
              }}
              className={cn(
                /* The sidebar's own row metrics, so the tree reads as part of
                   the same source list rather than a second one with its own
                   rhythm. No transition on the fill for the same reason it is
                   absent there: a crossfade per row leaves a wake behind a
                   fast pointer. */
                "flex h-[1.625rem] w-full items-center gap-1.5 rounded-md pr-2 text-source outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                entry.path === activePath ? "bg-sidebar-accent-active text-foreground" : "text-foreground/85 hover:bg-sidebar-accent",
              )}
              /* Indent by depth on the padding rather than a nested container,
                 so a deep row still spans the full width and its highlight
                 reaches both edges the way a source list's does. */
              style={{ paddingLeft: `${0.375 + depth * 0.6875}rem` }}
            >
              {entry.type === "directory" ? (
                <ChevronRight className={cn("size-3 shrink-0 text-foreground/45 transition-transform duration-150", expanded && "rotate-90")} />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              {entry.type === "directory" ? (
                <Folder className="size-3.5 shrink-0 text-foreground/55" />
              ) : (
                /* The language's own mark, which is the only colour a file tree
                   has any business carrying — and the difference between a list
                   of grey rows and a list you can scan. A file in a language
                   Construct cannot name falls back to the generic glyph rather
                   than being given a colour it has not earned. */
                (() => {
                  const language = languageForPath(entry.name);
                  return language ? (
                    <LanguageGlyph className="size-3.5 shrink-0" language={language} />
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-foreground/40" />
                  );
                })()
              )}
              <span className="truncate">{entry.name}</span>
            </button>

            {entry.type === "directory" && expanded && (
              <Directory
                api={api}
                projectId={projectId}
                directory={entry.path}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onError={onError}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
