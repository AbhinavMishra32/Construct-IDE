/**
 * The sync protocol, as one shape shared by both ends.
 *
 * Declared here rather than in the main process because the renderer shows what
 * a sync did, and because the cloud validates exactly this — a protocol with two
 * definitions is a protocol with two meanings.
 *
 * What is absent matters as much as what is here. A project's `directory` is an
 * absolute path on one machine and would tell another to look somewhere that
 * does not exist; snapshots and their blobs are the undo history, which is large
 * and belongs to the machine that recorded it. Neither travels.
 */
export type SyncProject = {
  id: string;
  name: string;
  goal: string;
  language: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  currentPathNode: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncMessage = {
  id: string;
  projectId: string;
  role: string;
  body: string;
  activity: unknown[];
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncConcept = {
  projectId: string;
  conceptId: string;
  parentId: string | null;
  title: string;
  masteryLevel: number;
  confidence: string;
  note: string;
  summary: string;
  content: string;
  docs: Array<{ title: string; url: string }>;
  tags: string[];
  firstSeenAt: string;
  deletedAt?: string | null;
  updatedAt: string;
};

export type SyncTask = {
  projectId: string;
  taskId: string;
  title: string;
  brief: string;
  criteria: string[];
  concepts: string[];
  files: string[];
  status: string;
  outcome: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncPathNode = {
  projectId: string;
  nodeId: string;
  title: string;
  summary: string;
  status: string;
  sortOrder: number;
  kind: string;
  concepts: string[];
  exitCriteria: string[];
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What this machine has to say. */
/** The learner's profile, as the cloud carries it: one document, and when it
 *  last changed. Null on a device that has not been through the intake — which
 *  is not the same as an empty profile, and the difference is what decides
 *  whether somebody is asked the questions again. */
export type SyncLearner = { profile: Record<string, unknown>; updatedAt: string };

export type SyncPush = {
  projects: SyncProject[];
  messages: SyncMessage[];
  concepts: SyncConcept[];
  tasks: SyncTask[];
  pathNodes: SyncPathNode[];
};

/** What it has been told. The same rows — sync is symmetric, which is what lets
 *  one endpoint serve both directions — plus the profile, which rides alongside
 *  rather than inside because it is a setting on this side, not a table. */
export type SyncPull = SyncPush & { learner: SyncLearner | null };

/** How a sync ended, for the one line of interface that reports it. */
export type SyncStatus = {
  state: "idle" | "syncing" | "offline" | "error";
  /** When the last successful sync finished. */
  at: string | null;
  /** Why the last attempt failed, if it did. */
  error?: string | undefined;
};

/** Rows moved in the last sync, so the window can say more than "done". */
export type SyncResult = { pushed: number; pulled: number; at: string };
