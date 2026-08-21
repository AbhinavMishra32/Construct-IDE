import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, FolderOpen } from "lucide-react";
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

/** One indent step, in rem. The rails are drawn at multiples of it, so the
 *  number lives here rather than twice in two different units. */
const INDENT = 0.75;

/**
 * The project's files, one directory at a time.
 *
 * Children are fetched when a folder is opened rather than up front. A project
 * is a real repository, so eagerly walking it would mean thousands of stat
 * calls before the first row could be drawn — and almost all of that work is
 * for folders nobody opens.
 *
 * Three things do the work of making this readable rather than a list of grey
 * words. The first is the rails: one hairline per indent level, and the ones
 * along the path to the open file are lit, so a file six folders deep still
 * shows you where it lives without reading a single name. The second is that a
 * filename is set as two things — the stem in ink and the extension dimmed —
 * because a column of names all ending in `.tsx` is a column whose right half
 * carries no information and whose left half is what you are actually scanning.
 * The third is the folders: drawn as filled ember rather than grey outlines,
 * which is both the one warm mark in the column and, not coincidentally, what a
 * paper folder actually looks like.
 */
export function FileTree({ api, projectId, activePath, onOpenFile, onError }: Props) {
  return (
    <div className="pb-2">
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

  /* Folders first, then files, each alphabetically and case-insensitively. The
     order is asserted here rather than assumed of the main process, because a
     tree that reorders itself between two reads of the same folder is the kind
     of thing nobody reports and everybody notices. */
  const sorted = useMemo(() => {
    if (!entries) return null;
    return [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
  }, [entries]);

  if (!sorted) return null;

  if (sorted.length === 0 && depth > 0) {
    return (
      <p className="py-0.5 text-source-sm italic text-foreground/35" style={{ paddingLeft: `${0.5 + (depth + 1) * INDENT}rem` }}>
        empty
      </p>
    );
  }

  return (
    <ul className={cn("px-1.5", depth > 0 && "animate-in fade-in slide-in-from-top-1 duration-150 ease-out")}>
      {sorted.map((entry) => {
        const expanded = open.has(entry.path);
        const active = entry.path === activePath;
        /* Lit rails: this row is on the way to the open file. Prefix-matched on
           the separator so `src/app` never claims `src/application`. */
        const onActivePath = activePath !== null && (activePath === entry.path || activePath.startsWith(`${entry.path}/`));

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
                "group/row relative flex h-[1.625rem] w-full items-center gap-1.5 overflow-hidden rounded-md pr-2 text-source outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                active ? "bg-sidebar-accent-active text-foreground" : "text-foreground/85 hover:bg-sidebar-accent",
              )}
              /* Indent by depth on the padding rather than a nested container,
                 so a deep row still spans the full width and its highlight
                 reaches both edges the way a source list's does. */
              style={{ paddingLeft: `${0.375 + depth * INDENT}rem` }}
            >
              {/* The open file wears a seat on its leading edge. Two pixels of
                  ember inside the row's own corner: enough to find the row in
                  peripheral vision, small enough not to become a second
                  highlight competing with the fill. */}
              {active && <span className="absolute inset-y-[3px] left-0 w-[2px] rounded-full bg-[var(--brand)]" />}

              <Rails depth={depth} lit={onActivePath} />

              {entry.type === "directory" ? (
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 text-foreground/35 transition-transform duration-150 group-hover/row:text-foreground/60",
                    expanded && "rotate-90",
                  )}
                />
              ) : (
                <span className="size-3 shrink-0" />
              )}

              {entry.type === "directory" ? (
                /* Filled, and in the one warm colour the app has. A folder is
                   the only glyph in the column that appears dozens of times, so
                   it is the one worth making a shape rather than an outline —
                   and an open folder is drawn open, which means the chevron and
                   the icon say the same thing twice on purpose: at a glance you
                   read the shape, on inspection you read the arrow. */
                (() => {
                  const Glyph = expanded ? FolderOpen : Folder;
                  return (
                    <Glyph
                      className="size-3.5 shrink-0 text-[var(--brand)]/85"
                      style={{ fill: "color-mix(in oklab, var(--brand) 22%, transparent)" }}
                    />
                  );
                })()
              ) : (
                /* The language's own mark, which is the only colour a file tree
                   has any business carrying beyond the folders — and the
                   difference between a list of grey rows and a list you can
                   scan. A file in a language Construct cannot name falls back to
                   the generic glyph rather than being given a colour it has not
                   earned. */
                (() => {
                  const language = languageForPath(entry.name);
                  return language ? (
                    <LanguageGlyph className="size-3.5 shrink-0" language={language} />
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-foreground/30" />
                  );
                })()
              )}

              <FileName active={active} directory={entry.type === "directory"} name={entry.name} />
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

/**
 * The indent rails.
 *
 * Drawn absolutely rather than as padded containers so the row's highlight still
 * runs the full width of the column: a tree whose nested rows are inset loses the
 * one thing a source list's selection is for, which is being a bar you can find
 * without aiming.
 *
 * The last rail — the one immediately left of this row's glyph — is the one that
 * lights, and only when the row is on the path to the open file. Lighting all of
 * an ancestor's rails would draw a ladder up the whole column; lighting one draws
 * a thread.
 */
function Rails({ depth, lit }: { depth: number; lit: boolean }) {
  if (depth === 0) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: depth }, (_, level) => (
        <span
          className={cn(
            "absolute top-0 bottom-0 w-px",
            lit && level === depth - 1 ? "bg-[var(--brand)]/45" : "bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]",
          )}
          key={level}
          style={{ left: `${0.875 + level * INDENT}rem` }}
        />
      ))}
    </span>
  );
}

/**
 * A filename, set as a stem and an extension.
 *
 * In a real project the extension is the least informative part of a name and
 * the most repeated — twenty rows of `.tsx` — so it is dimmed to let the stem
 * carry the row. Dotfiles are all extension and no stem, so they are left whole
 * rather than being rendered as an empty name.
 */
function FileName({ active, directory, name }: { active: boolean; directory: boolean; name: string }) {
  const dot = directory ? -1 : name.lastIndexOf(".");
  const split = dot > 0;

  return (
    <span className={cn("min-w-0 truncate", directory && "font-medium", active && "text-foreground")}>
      {split ? name.slice(0, dot) : name}
      {split && <span className="text-foreground/40">{name.slice(dot)}</span>}
    </span>
  );
}
