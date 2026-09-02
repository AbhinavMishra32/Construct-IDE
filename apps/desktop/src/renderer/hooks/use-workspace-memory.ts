import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_SIZE, type Corner } from "@/components/workspace/pipGeometry";

const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

/**
 * What the workspace remembers about a project between visits.
 *
 * Reopening a project used to put you in an empty editor with the terminal shut,
 * however deep into it you had been — the state was React state, so it died with
 * the unmount. Every return started with rebuilding the same three tabs.
 *
 * Kept in `localStorage` rather than in the main process on purpose. This is
 * per-window furniture — which tabs are up, how far the terminal is pulled open
 * — and it belongs to the machine you are sitting at, not to the project. It is
 * also the kind of state that must never be the reason a project fails to open:
 * every read is guarded, and anything unparseable is thrown away rather than
 * repaired. Losing your tab layout is a small cost; refusing to open a project
 * because of a bad key is not.
 */
export type WorkspaceMemory = {
  /** Project-relative paths, in tab order. */
  open: string[];
  /** The tab in front, if it is still one of `open`. */
  active: string | null;
  terminalOpen: boolean;
  agentOpen: boolean;
  /** Panel group layouts, as react-resizable-panels reports them. */
  columns: number[] | null;
  rows: number[] | null;
  /** The floating concept card: which concept, and where it was left. Part of
   *  the furniture for the same reason the tabs are — a card dragged to the
   *  top-left and sized to the note in it is a reading position, and having to
   *  set it again on every visit is the same annoyance as rebuilding tabs. */
  concept: RememberedConcept | null;
};

export type RememberedConcept = {
  conceptId: string;
  corner: Corner;
  width: number;
  height: number;
};

const EMPTY: WorkspaceMemory = {
  open: [],
  active: null,
  terminalOpen: false,
  agentOpen: true,
  columns: null,
  rows: null,
  concept: null,
};

/** Bounded so a long-lived install does not accumulate a key per project ever
 *  opened. Least-recently-written is dropped first. */
const MAX_PROJECTS = 40;
const KEY = "construct.workspace";

type Store = Record<string, { at: number; state: WorkspaceMemory }>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    /* A private window, a cleared profile, or a key some earlier version wrote
       in a shape this one does not understand. All three mean the same thing:
       there is nothing to restore. */
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    const entries = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PROJECTS);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Quota, or storage disabled. The workspace keeps working; it just will not
       remember. */
  }
}

/** Normalised on the way out, because the file it points at may be gone: a
 *  project's tabs are paths, and paths are the one thing here the learner can
 *  change from outside the app. */
function sane(state: Partial<WorkspaceMemory> | undefined): WorkspaceMemory {
  if (!state || typeof state !== "object") return EMPTY;
  const open = Array.isArray(state.open) ? state.open.filter((path): path is string => typeof path === "string").slice(0, 24) : [];
  const active = typeof state.active === "string" && open.includes(state.active) ? state.active : (open[0] ?? null);
  const sizes = (value: unknown) =>
    Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry)) ? (value as number[]) : null;
  return {
    open,
    active,
    terminalOpen: state.terminalOpen === true,
    agentOpen: state.agentOpen !== false,
    columns: sizes(state.columns),
    rows: sizes(state.rows),
    concept: concept(state.concept),
  };
}

/** The remembered card, or nothing. A concept that has since been forgotten is
 *  dropped by the workspace when it cannot find the id — this only guarantees
 *  the shape, and that the size is one the card can actually be. */
function concept(value: unknown): RememberedConcept | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<RememberedConcept>;
  if (typeof entry.conceptId !== "string" || !entry.conceptId) return null;
  if (!CORNERS.includes(entry.corner as Corner)) return null;
  const span = (size: unknown, fallback: number) =>
    typeof size === "number" && Number.isFinite(size) && size > 0 ? size : fallback;
  return {
    conceptId: entry.conceptId,
    corner: entry.corner as Corner,
    width: span(entry.width, DEFAULT_SIZE.width),
    height: span(entry.height, DEFAULT_SIZE.height),
  };
}

export function useWorkspaceMemory(projectId: string): {
  /** What was remembered when this project was opened. Read once per project:
   *  it is the starting point, not a live mirror of the current layout. */
  restored: WorkspaceMemory;
  remember(patch: Partial<WorkspaceMemory>): void;
} {
  /* Read synchronously on the first render for this project, so the workspace
     mounts with its tabs already up. Restoring in an effect would show the empty
     state for a frame, which reads as the memory failing and then working. */
  const [restored, setRestored] = useState<WorkspaceMemory>(() => sane(readStore()[projectId]?.state));
  const current = useRef<WorkspaceMemory>(restored);
  const loaded = useRef(projectId);

  if (loaded.current !== projectId) {
    loaded.current = projectId;
    const next = sane(readStore()[projectId]?.state);
    current.current = next;
    /* Set during render rather than in an effect, for the same reason as the
       initialiser: the new project's tabs should be there on its first frame. */
    setRestored(next);
  }

  const remember = useCallback(
    (patch: Partial<WorkspaceMemory>) => {
      current.current = { ...current.current, ...patch };
      const store = readStore();
      store[projectId] = { at: Date.now(), state: current.current };
      writeStore(store);
    },
    [projectId],
  );

  /* One last write on unmount, so closing a project keeps whatever the last
     resize or tab change was even if it landed inside a debounce. */
  useEffect(() => {
    return () => {
      const store = readStore();
      store[projectId] = { at: Date.now(), state: current.current };
      writeStore(store);
    };
  }, [projectId]);

  return { restored, remember };
}
