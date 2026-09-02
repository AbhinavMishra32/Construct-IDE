export type DocumentReveal = {
  column?: number;
  endLine?: number;
  id: number;
  kind: "focus" | "jump";
  line: number;
  path: string;
};

export type DocumentSession = {
  activePath: string | null;
  reveal: DocumentReveal | null;
  tabs: string[];
};

export function createDocumentSession(initialPath?: string | null): DocumentSession {
  const path = initialPath ? normalizeDocumentPath(initialPath) : null;
  return {
    activePath: path,
    reveal: null,
    tabs: path ? [path] : [],
  };
}

export function activateDocument(session: DocumentSession, rawPath: string): DocumentSession {
  const path = normalizeDocumentPath(rawPath);
  if (!path) return session;

  return {
    ...session,
    activePath: path,
    tabs: session.tabs.includes(path) ? session.tabs : [...session.tabs, path],
  };
}

export function closeDocument(session: DocumentSession, rawPath: string): DocumentSession {
  const path = normalizeDocumentPath(rawPath);
  const index = session.tabs.indexOf(path);
  if (index < 0) return session;

  const tabs = session.tabs.filter((tab) => tab !== path);
  const activePath = session.activePath === path
    ? tabs[Math.min(index, tabs.length - 1)] ?? null
    : session.activePath;

  return {
    activePath,
    reveal: session.reveal?.path === path ? null : session.reveal,
    tabs,
  };
}

export function replaceDocumentPath(session: DocumentSession, rawOldPath: string, rawNewPath: string): DocumentSession {
  const oldPath = normalizeDocumentPath(rawOldPath);
  const newPath = normalizeDocumentPath(rawNewPath);
  if (!oldPath || !newPath || oldPath === newPath) return session;

  const nextTabs = session.tabs.reduce<string[]>((tabs, tab) => {
    const nextTab = tab === oldPath ? newPath : tab;
    if (!tabs.includes(nextTab)) {
      tabs.push(nextTab);
    }
    return tabs;
  }, []);

  return {
    activePath: session.activePath === oldPath ? newPath : session.activePath,
    reveal: session.reveal?.path === oldPath
      ? { ...session.reveal, path: newPath }
      : session.reveal,
    tabs: nextTabs,
  };
}

export function revealDocument(
  session: DocumentSession,
  target: Omit<DocumentReveal, "id" | "path"> & { path: string },
): DocumentSession {
  const path = normalizeDocumentPath(target.path);
  if (!path) return session;

  const active = activateDocument(session, path);
  return {
    ...active,
    reveal: {
      ...target,
      path,
      id: (session.reveal?.id ?? 0) + 1,
    },
  };
}

export function consumeDocumentReveal(session: DocumentSession, revealId: number): DocumentSession {
  if (session.reveal?.id !== revealId) return session;
  return { ...session, reveal: null };
}

export function normalizeDocumentPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
