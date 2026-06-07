"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ShellHistoryEntry<TType extends string = string, TPayload = unknown> = {
  id: string;
  payload?: TPayload;
  title?: string;
  type: TType;
};

export type ShellHistoryState<TEntry extends ShellHistoryEntry = ShellHistoryEntry> = {
  entries: TEntry[];
  index: number;
};

export type ShellHistoryController<TEntry extends ShellHistoryEntry = ShellHistoryEntry> = {
  canGoBack: boolean;
  canGoForward: boolean;
  current: TEntry | null;
  entries: readonly TEntry[];
  goBack: () => void;
  goForward: () => void;
  goTo: (index: number) => void;
  index: number;
  push: (entry: TEntry, options?: { replace?: boolean }) => void;
  replace: (entry: TEntry) => void;
  reset: (entries: readonly TEntry[], index?: number) => void;
};

export type UseShellHistoryOptions<TEntry extends ShellHistoryEntry = ShellHistoryEntry> = {
  getEntryKey?: (entry: TEntry) => string;
  maxEntries?: number;
};

export type ShellHistoryProviderProps<TEntry extends ShellHistoryEntry = ShellHistoryEntry> = {
  children: ReactNode;
  history: ShellHistoryController<TEntry>;
};

const ShellHistoryContext = createContext<ShellHistoryController<any> | null>(null);

export function useShellHistory<TEntry extends ShellHistoryEntry = ShellHistoryEntry>(
  initialEntries: readonly TEntry[] | (() => readonly TEntry[]),
  options: UseShellHistoryOptions<TEntry> = {},
): ShellHistoryController<TEntry> {
  const { getEntryKey = defaultGetEntryKey, maxEntries } = options;
  const [state, setState] = useState<ShellHistoryState<TEntry>>(() => {
    const entries = resolveInitialEntries(initialEntries);
    return {
      entries,
      index: entries.length > 0 ? entries.length - 1 : -1,
    };
  });

  const current = state.index >= 0 ? state.entries[state.index] ?? null : null;

  const push = useCallback(
    (entry: TEntry, pushOptions: { replace?: boolean } = {}) => {
      setState((currentState) => {
        const currentEntry = currentState.entries[currentState.index];
        const entryKey = getEntryKey(entry);

        if (pushOptions.replace !== true && currentEntry != null && getEntryKey(currentEntry) === entryKey) {
          return currentState;
        }

        const baseEntries =
          pushOptions.replace === true
            ? currentState.entries.slice(0, Math.max(currentState.index, 0))
            : currentState.entries.slice(0, currentState.index + 1);
        const nextEntries = trimEntries([...baseEntries, entry], maxEntries);

        return {
          entries: nextEntries,
          index: nextEntries.length - 1,
        };
      });
    },
    [getEntryKey, maxEntries],
  );

  const replace = useCallback(
    (entry: TEntry) => {
      setState((currentState) => {
        if (currentState.entries.length === 0 || currentState.index < 0) {
          return { entries: [entry], index: 0 };
        }

        const entries = currentState.entries.slice();
        entries[currentState.index] = entry;
        const nextEntries = trimEntries(entries, maxEntries);
        return {
          entries: nextEntries,
          index: clampIndex(currentState.index, nextEntries.length),
        };
      });
    },
    [maxEntries],
  );

  const reset = useCallback((entriesToSet: readonly TEntry[], nextIndex = entriesToSet.length - 1) => {
    const entries = [...entriesToSet];
    setState({
      entries,
      index: clampIndex(nextIndex, entries.length),
    });
  }, []);

  const goBack = useCallback(() => {
    setState((currentState) => ({
      ...currentState,
      index: clampIndex(currentState.index - 1, currentState.entries.length),
    }));
  }, []);

  const goForward = useCallback(() => {
    setState((currentState) => ({
      ...currentState,
      index: clampIndex(currentState.index + 1, currentState.entries.length),
    }));
  }, []);

  const goTo = useCallback((nextIndex: number) => {
    setState((currentState) => ({
      ...currentState,
      index: clampIndex(nextIndex, currentState.entries.length),
    }));
  }, []);

  return useMemo(
    () => ({
      canGoBack: state.index > 0,
      canGoForward: state.index >= 0 && state.index < state.entries.length - 1,
      current,
      entries: state.entries,
      goBack,
      goForward,
      goTo,
      index: state.index,
      push,
      replace,
      reset,
    }),
    [current, goBack, goForward, goTo, push, replace, reset, state.entries, state.index],
  );
}

export function ShellHistoryProvider<TEntry extends ShellHistoryEntry = ShellHistoryEntry>({
  children,
  history,
}: ShellHistoryProviderProps<TEntry>) {
  return <ShellHistoryContext.Provider value={history as ShellHistoryController<any>}>{children}</ShellHistoryContext.Provider>;
}

export function useShellHistoryContext<TEntry extends ShellHistoryEntry = ShellHistoryEntry>() {
  const history = useContext(ShellHistoryContext);
  if (history == null) {
    throw new Error("useShellHistoryContext must be used inside ShellHistoryProvider.");
  }
  return history as unknown as ShellHistoryController<TEntry>;
}

function resolveInitialEntries<TEntry extends ShellHistoryEntry>(
  initialEntries: readonly TEntry[] | (() => readonly TEntry[]),
) {
  return [...(typeof initialEntries === "function" ? initialEntries() : initialEntries)];
}

function defaultGetEntryKey(entry: ShellHistoryEntry) {
  return entry.id;
}

function trimEntries<TEntry extends ShellHistoryEntry>(entries: TEntry[], maxEntries?: number) {
  if (maxEntries == null || maxEntries <= 0 || entries.length <= maxEntries) {
    return entries;
  }
  return entries.slice(entries.length - maxEntries);
}

function clampIndex(index: number, length: number) {
  if (length === 0) {
    return -1;
  }
  return Math.max(0, Math.min(index, length - 1));
}
