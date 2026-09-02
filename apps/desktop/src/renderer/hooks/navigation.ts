/**
 * Where the window has been, and where it can go back to.
 *
 * The model is a browser's, not a stack's: there is one list and a cursor into
 * it, going back moves the cursor rather than dropping the entry, and visiting
 * somewhere new from the middle discards the forward tail. That last rule is
 * what makes forward trustworthy — a forward button that could land somewhere
 * you never navigated to is worse than no forward button.
 *
 * A view is a place, not a page: the workspace is a different view per project
 * and per file, because in an IDE "back" after opening a file means the file you
 * were reading, and landing on the project with no file open instead is the
 * behaviour that makes people stop using the button.
 */
export type View =
  | { page: "projects" | "concepts" | "settings" }
  | { page: "workspace"; projectId: string; path: string | null };

export type History = { entries: View[]; index: number };

/** How much is kept. Long enough that back is never a dead end in a session,
 *  short enough that it is not a log of the whole day. */
export const HISTORY_LIMIT = 50;

export const sameView = (a: View | undefined, b: View): boolean => {
  if (!a || a.page !== b.page) return false;
  if (a.page !== "workspace" || b.page !== "workspace") return true;
  return a.projectId === b.projectId && a.path === b.path;
};

/**
 * Records a move to `view`.
 *
 * Re-visiting where you already are is not a move and is ignored, which matters
 * because the places this is called from — selecting a file, switching a page —
 * also fire when nothing changed, and every one of those would otherwise become
 * an entry you have to press back through.
 */
export function visit(history: History, view: View): History {
  if (sameView(history.entries[history.index], view)) return history;

  /* Everything after the cursor is a future that no longer happened. */
  const kept = history.entries.slice(0, history.index + 1);
  const entries = [...kept, view].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1 };
}

export const canGoBack = (history: History): boolean => history.index > 0;
export const canGoForward = (history: History): boolean => history.index < history.entries.length - 1;

/** The cursor moved, and the view to apply. Null when there is nowhere to go, so
 *  the caller can treat "pressed a dead button" as doing nothing at all. */
export function step(history: History, direction: -1 | 1): { history: History; view: View } | null {
  const index = history.index + direction;
  const view = history.entries[index];
  if (!view) return null;
  return { history: { ...history, index }, view };
}

/**
 * Drops every entry for a project, and any that would be left duplicated.
 *
 * Deleting a project must not leave back pointing at its workspace: the entry
 * would reopen something that no longer exists. Removing entries can strand the
 * cursor and can put two identical views next to each other, so both are
 * repaired here rather than left for the caller to notice.
 */
export function forget(history: History, projectId: string): History {
  const current = history.entries[history.index];
  const kept: View[] = [];
  for (const view of history.entries) {
    if (view.page === "workspace" && view.projectId === projectId) continue;
    if (sameView(kept[kept.length - 1], view)) continue;
    kept.push(view);
  }

  if (kept.length === 0) return { entries: [{ page: "projects" }], index: 0 };

  /* The cursor follows the view it was on when that view survived, and falls to
     the end when it did not — the end being the most recent place still real. */
  const index = current && !(current.page === "workspace" && current.projectId === projectId)
    ? kept.findIndex((view) => sameView(view, current))
    : -1;
  return { entries: kept, index: index >= 0 ? index : kept.length - 1 };
}
