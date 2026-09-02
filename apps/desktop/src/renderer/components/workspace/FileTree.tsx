import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, File as FileIcon, FilePlus2, Folder, FolderOpen, FolderPlus, Search } from "lucide-react";
import { languageForPath } from "@construct/domain";
import { LanguageGlyph } from "../common/LanguageGlyph";
import type { ConstructApi, WorkspaceEntry } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

type Props = {
  api: ConstructApi | undefined;
  projectId: string;
  activePath: string | null;
  onOpenFile(path: string): void;
  onError(message: string): void;
};

/** An edit in progress. One at a time: two half-typed filenames in a column is
 *  a state nobody can reason about, and the tree has nowhere to show which is
 *  which. `parent` is the directory the row belongs to, "" for the root. */
type Edit =
  | { kind: "create-file" | "create-directory"; parent: string }
  | { kind: "rename"; parent: string; path: string; name: string };

type TreeContext = {
  /** Bumped after every mutation so open folders re-read themselves. */
  version: number;
  filter: string;
  edit: Edit | null;
  onEdit(edit: Edit | null): void;
  onCommit(edit: Edit, name: string): void;
  onDelete(entry: WorkspaceEntry): void;
  /** Moves an entry into a directory ("" for the project root). */
  onMove(from: string, intoDirectory: string): void;
  /** Pops the platform's menu for a row. `expand` opens the folder, so a new
   *  file appears inside the one it was asked for rather than behind a
   *  still-closed caret. */
  onMenu(entry: WorkspaceEntry, parent: string, expand: () => void): Promise<void>;
  /** What is being dragged, so a row can tell whether it may accept the drop.
   *  Held in the context rather than read from the drag event because
   *  `dragover` cannot see the payload — the platform only exposes it on
   *  `drop`, and the highlight has to be decided before then. */
  dragging: WorkspaceEntry | null;
  onDragging(entry: WorkspaceEntry | null): void;
};

/**
 * Whether `entry` can be dropped into `directory`.
 *
 * Three refusals, and the third is the one that matters: moving a folder into
 * its own descendant would move the destination along with it, which on a real
 * filesystem either fails or eats the tree.
 */
export function canDrop(entry: WorkspaceEntry, directory: string): boolean {
  const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
  if (parent === directory) return false;
  if (entry.path === directory) return false;
  return !(entry.type === "directory" && directory.startsWith(`${entry.path}/`));
}

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
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [doomed, setDoomed] = useState<WorkspaceEntry | null>(null);
  /* What is being dragged. Lifted to the tree because `dragover` fires on a
     different row than `dragstart` did, and the target has to know what is
     coming before it can say whether it will take it. */
  const [dragging, setDragging] = useState<WorkspaceEntry | null>(null);

  const refresh = () => setVersion((current) => current + 1);
  const fail = (cause: unknown, fallback: string) => onError(cause instanceof Error ? cause.message : fallback);

  const commit = (pending: Edit, name: string) => {
    const trimmed = name.trim();
    setEdit(null);
    if (!api || !trimmed) return;
    /* The name is a name, not a path. Letting a slash through here would make
       the tree a second way to address the filesystem, and the containment check
       in the main process would be the only thing between a typo and a write
       outside the project — it should not have to be the only thing. */
    if (trimmed.includes("/") || trimmed === "." || trimmed === "..") {
      onError("A name cannot contain a slash.");
      return;
    }
    const target = pending.parent ? `${pending.parent}/${trimmed}` : trimmed;
    const run =
      pending.kind === "rename"
        ? api.renameFile({ projectId, from: pending.path, to: target })
        : pending.kind === "create-directory"
          ? api.createDirectory({ projectId, path: target })
          : api.createFile({ projectId, path: target });
    void run
      .then(() => {
        refresh();
        /* A file you just made is a file you meant to edit. Folders are not
           opened, because the point of making one is to put something in it. */
        if (pending.kind === "create-file") onOpenFile(target);
      })
      .catch((cause: unknown) => fail(cause, "Construct could not do that."));
  };

  const remove = (entry: WorkspaceEntry) => {
    setDoomed(null);
    if (!api) return;
    void api
      .removeFile({ projectId, path: entry.path })
      .then(refresh)
      .catch((cause: unknown) => fail(cause, "Construct could not delete that."));
  };

  /**
   * Moves an entry into a directory.
   *
   * A move is a rename to a path in another folder, which is what it is on the
   * filesystem too — so this reuses the same call, and inherits its refusal to
   * overwrite an existing name and its containment check.
   */
  const move = (from: string, intoDirectory: string) => {
    if (!api) return;
    const name = from.slice(from.lastIndexOf("/") + 1);
    const to = intoDirectory ? `${intoDirectory}/${name}` : name;
    if (to === from) return;
    void api
      .renameFile({ projectId, from, to })
      .then(refresh)
      .catch((cause: unknown) => fail(cause, "Construct could not move that."));
  };

  /**
   * The platform's context menu for one row.
   *
   * Built as data and popped by the main process, so it is a real menu rather
   * than a web page drawn to look like one. The reply is the id that was
   * chosen, which is why every branch here is a plain switch rather than a
   * callback per item.
   */
  const openMenu = async (entry: WorkspaceEntry, parent: string, expand: () => void) => {
    if (!api) return;
    const directoryItems = [
      { id: "new-file", label: "New File" },
      { id: "new-folder", label: "New Folder" },
      { type: "separator" as const },
    ];
    const chosen = await api
      .showContextMenu({
        items: [
          ...(entry.type === "directory" ? directoryItems : []),
          { id: "rename", label: "Rename" },
          { id: "delete", label: "Delete", danger: true },
        ],
      })
      .catch(() => null);

    if (chosen === "new-file" || chosen === "new-folder") {
      expand();
      setEdit({ kind: chosen === "new-file" ? "create-file" : "create-directory", parent: entry.path });
    } else if (chosen === "rename") {
      setEdit({ kind: "rename", parent, path: entry.path, name: entry.name });
    } else if (chosen === "delete") {
      setDoomed(entry);
    }
  };

  const context: TreeContext = {
    version,
    filter: filter.trim().toLocaleLowerCase(),
    edit,
    onEdit: setEdit,
    onCommit: commit,
    onDelete: setDoomed,
    onMove: move,
    onMenu: openMenu,
    dragging,
    onDragging: setDragging,
  };

  return (
    <div
      className="flex min-h-0 flex-col pb-2"
      /* The column itself is the project root's drop target, so dragging a file
         out of a folder and letting go in the empty space below the tree moves
         it to the top level. Without it the root was the one directory nothing
         could be moved into. */
      onDragOver={(event) => {
        if (dragging && canDrop(dragging, "")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!dragging || !canDrop(dragging, "")) return;
        event.preventDefault();
        move(dragging.path, "");
        setDragging(null);
      }}
    >
      {/* Filter and the two make-something buttons on one row. A tree deep enough
          to need a filter is also one where scrolling to the right folder to
          right-click it is the slow way to add a file. */}
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <InputGroup className="h-7 bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]">
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Filter files"
            className="text-source"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setFilter(""); }}
            placeholder="Filter files…"
            value={filter}
          />
        </InputGroup>
        <TreeAction icon={FilePlus2} label="New file" onClick={() => setEdit({ kind: "create-file", parent: "" })} />
        <TreeAction icon={FolderPlus} label="New folder" onClick={() => setEdit({ kind: "create-directory", parent: "" })} />
      </div>

      <Directory
        activePath={activePath}
        api={api}
        context={context}
        depth={0}
        directory=""
        onError={onError}
        onOpenFile={onOpenFile}
        projectId={projectId}
      />

      <Dialog onOpenChange={(next) => { if (!next) setDoomed(null); }} open={!!doomed}>
        <DialogContent className="sm:max-w-[26rem]">
          <DialogHeader>
            <DialogTitle>Delete {doomed?.name}?</DialogTitle>
            <DialogDescription>
              {doomed?.type === "directory"
                ? "This deletes the folder and everything inside it from your disk. It cannot be undone."
                : "This deletes the file from your disk. It cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDoomed(null)} variant="secondary">Cancel</Button>
            <Button onClick={() => doomed && remove(doomed)} variant="destructive">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TreeAction({
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
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/** The inline row a create or a rename types into. Commits on Enter or blur,
 *  abandons on Escape — the same contract as renaming in Finder. */
function EditRow({
  depth,
  initial,
  onCancel,
  onCommit,
}: {
  depth: number;
  initial: string;
  onCancel(): void;
  onCommit(name: string): void;
}) {
  const [value, setValue] = useState(initial);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    /* Select the stem, not the extension: renaming almost never means changing
       `.ts`, and selecting the whole name makes you retype it. */
    const dot = initial.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initial]);

  return (
    <li style={{ paddingLeft: `${0.375 + depth * INDENT}rem` }}>
      <input
        className="h-[1.625rem] w-full rounded-md border border-ring bg-[var(--popover)] px-1.5 text-source text-foreground outline-none"
        onBlur={() => onCommit(value)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onCommit(value); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
        ref={field}
        value={value}
      />
    </li>
  );
}

function Directory({
  api,
  context,
  projectId,
  directory,
  depth,
  activePath,
  onOpenFile,
  onError,
}: Props & { directory: string; depth: number; context: TreeContext }) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  /* The row whose context menu is showing. One per directory level is enough:
     opening a menu anywhere closes whatever was open, because the menu is
     rendered from this and there is only one of it. */

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
    /* `context.version` is the dependency that matters: a create, rename or
       delete anywhere bumps it, and every open folder re-reads itself. Cheaper
       than threading a targeted invalidation through a recursive tree, and a
       sidebar's worth of folders is a handful of listings. */
  }, [load, context.version]);

  /* Folders first, then files, each alphabetically and case-insensitively. The
     order is asserted here rather than assumed of the main process, because a
     tree that reorders itself between two reads of the same folder is the kind
     of thing nobody reports and everybody notices. */
  const sorted = useMemo(() => {
    if (!entries) return null;
    /* Filtering keeps folders whatever their name, because hiding a folder
       hides everything under it and the match you are looking for is usually
       inside one. Files are matched on their own name. */
    const kept = context.filter
      ? entries.filter((entry) => entry.type === "directory" || entry.name.toLocaleLowerCase().includes(context.filter))
      : entries;
    return [...kept].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
  }, [context.filter, entries]);

  if (!sorted) return null;

  if (sorted.length === 0 && depth > 0) {
    return (
      <p className="py-0.5 text-source-sm italic text-foreground/35" style={{ paddingLeft: `${0.5 + (depth + 1) * INDENT}rem` }}>
        empty
      </p>
    );
  }

  const { edit } = context;
  const creating = edit && edit.kind !== "rename" && edit.parent === directory ? edit : null;

  return (
    <ul className={cn("px-1.5", depth > 0 && "animate-in fade-in slide-in-from-top-1 duration-150 ease-out")}>
      {/* New rows go at the top of the folder they belong to, where the caret
          already is, rather than in sort position — which for a half-typed name
          would be somewhere the eye is not. */}
      {creating && (
        <EditRow
          depth={depth}
          initial=""
          onCancel={() => context.onEdit(null)}
          onCommit={(name) => context.onCommit(creating, name)}
        />
      )}
      {sorted.map((entry) => {
        const expanded = open.has(entry.path);
        const active = entry.path === activePath;
        /* Lit rails: this row is on the way to the open file. Prefix-matched on
           the separator so `src/app` never claims `src/application`. */
        const onActivePath = activePath !== null && (activePath === entry.path || activePath.startsWith(`${entry.path}/`));

        /* A file accepts a drop on behalf of the folder holding it, so dropping
           between two files in a folder does the obvious thing rather than
           nothing. Directories take it themselves. */
        const dropInto = entry.type === "directory" ? entry.path : directory;
        const dropTarget = context.dragging !== null && canDrop(context.dragging, dropInto);

        const renaming = edit?.kind === "rename" && edit.path === entry.path;
        if (renaming) {
          return (
            <EditRow
              depth={depth}
              initial={entry.name}
              key={entry.path}
              onCancel={() => context.onEdit(null)}
              onCommit={(name) => context.onCommit(edit, name)}
            />
          );
        }

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
                "",
                active ? "bg-sidebar-accent-active text-foreground" : "text-foreground/85 hover:bg-sidebar-accent",
                /* Only while something is over it, and only when it would be
                   accepted — a ring on every row during a drag is noise. */
                dropTarget && entry.type === "directory" && "ring-1 ring-inset ring-ring/60",
              )}
              /* Right-click opens the same menu the row's own affordances would.
                 Handled here rather than on a wrapper so the target is the row
                 you actually pointed at, including its indent. */
              onContextMenu={(event) => {
                event.preventDefault();
                void context.onMenu(entry, directory, () => setOpen((current) => new Set(current).add(entry.path)));
              }}
              /* Dragging moves the file. The payload is carried in the
                 context rather than in `dataTransfer`, because the highlight has
                 to be decided during `dragover` and the platform hides the data
                 until `drop` — but the path is still set on the transfer so a
                 drag out of the window means something to whatever receives it. */
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", entry.path);
                context.onDragging(entry);
              }}
              onDragEnd={() => context.onDragging(null)}
              onDragOver={(event) => {
                if (!dropTarget) return;
                /* Preventing the default is what marks this a valid drop; a row
                   that never calls it shows the "no" cursor, which is the
                   feedback a bad target should give. */
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!dropTarget || !context.dragging) return;
                event.preventDefault();
                event.stopPropagation();
                context.onMove(context.dragging.path, dropInto);
                context.onDragging(null);
              }}
              /* Indent by depth on the padding rather than a nested container,
                 so a deep row still spans the full width and its highlight
                 reaches both edges the way a source list's does. */
              style={{ paddingLeft: `${0.375 + depth * INDENT}rem` }}
            >
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
                activePath={activePath}
                api={api}
                context={context}
                depth={depth + 1}
                directory={entry.path}
                onError={onError}
                onOpenFile={onOpenFile}
                projectId={projectId}
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
