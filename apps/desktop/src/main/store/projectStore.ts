import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { AgentMessage, Language } from "@construct/domain";
import type { ProjectSummary, ThemePreference } from "../../shared/api.js";
import { openDatabase, type Database } from "./database.js";

/**
 * Append-only. Every entry has shipped to someone the moment it is released, so
 * an existing statement is never edited — a correction is a new statement.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE projects (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     goal       TEXT NOT NULL,
     directory  TEXT NOT NULL UNIQUE,
     language   TEXT NOT NULL,
     created_at TEXT NOT NULL,
     opened_at  TEXT
   );
   CREATE INDEX projects_opened_at ON projects (opened_at DESC);`,

  /* Agent turns. Stored per project so a conversation survives closing the
     project, the window, and the application — a teaching thread that resets
     every launch would make the agent unable to refer to anything it taught. */
  `CREATE TABLE agent_messages (
     id         TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     role       TEXT NOT NULL,
     body       TEXT NOT NULL,
     activity   TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL
   );
   CREATE INDEX agent_messages_project ON agent_messages (project_id, created_at);`,

  /* Pinning and archiving. Both are the learner filing their own work: a
     project they keep returning to stays at the top, and one they are done with
     leaves the list without being deleted — deleting is for projects Construct
     should forget, which is a different intent entirely. */
  `ALTER TABLE projects ADD COLUMN pinned_at TEXT;
   ALTER TABLE projects ADD COLUMN archived_at TEXT;`,
];

type ProjectRow = {
  id: string;
  name: string;
  goal: string;
  directory: string;
  language: string;
  created_at: string;
  opened_at: string | null;
  pinned_at: string | null;
  archived_at: string | null;
};

export type CreateProjectRecord = {
  name: string;
  goal: string;
  directory: string;
  language: Language;
};

/**
 * The local record of what projects exist and how the application is set up.
 *
 * It deliberately does not hold the project's *contents*. A Construct project
 * is a real directory the learner owns; the files are the truth and this table
 * only says where they are and what the learner set out to build. That is why
 * deleting a project here never touches the directory, and why every read
 * reports whether the directory is still `present` rather than assuming it.
 */
export class ProjectStore {
  private readonly database: Database;

  constructor(file: string) {
    this.database = openDatabase(file, MIGRATIONS);
  }

  close(): void {
    this.database.close();
  }

  /* ---- Settings --------------------------------------------------------- */

  /**
   * Settings are stored as JSON, not as text.
   *
   * They are not all strings — the provider layer keeps a model catalogue, a
   * timestamp, and several booleans in here. Storing text and having each
   * caller remember which of them to parse is how a boolean comes back as the
   * string "false" and reads as true.
   *
   * A row that fails to parse answers with the fallback rather than throwing.
   * A corrupt preference should cost the preference, not the launch.
   */
  getSetting<T>(key: string, fallback: T): T {
    const row = this.database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (row === undefined) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting<T>(key: string, value: T): void {
    this.database
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  theme(): ThemePreference {
    return this.getSetting<ThemePreference>("theme", "system");
  }

  setTheme(theme: ThemePreference): void {
    this.setSetting("theme", theme);
  }

  /* ---- Projects --------------------------------------------------------- */

  listProjects(): ProjectSummary[] {
    /* Three keys, and each one earns its place.

       The timestamp is the real ordering: most recently opened, falling back to
       created for a project never opened.

       Then an actual open outranks a mere creation. Timestamps are millisecond
       ISO strings, so opening one project in the same millisecond another was
       created is a genuine tie — and resolving it by insertion order would put
       the just-created project above the one the learner deliberately opened.

       rowid last, because two projects created inside the same millisecond tie
       on both keys above, and without a final one SQLite may return them in
       either order — a project list that reshuffles itself between launches. */
    const rows = this.database
      .prepare(
        /* Pinned first, then the timestamp ordering. Sorting pinned rows here
           rather than in the sidebar means every surface that lists projects
           agrees on the order without each one remembering to. */
        `SELECT * FROM projects
         ORDER BY (pinned_at IS NOT NULL) DESC,
                  COALESCE(opened_at, created_at) DESC,
                  (opened_at IS NOT NULL) DESC,
                  rowid DESC`,
      )
      .all() as ProjectRow[];
    return rows.map((row) => toSummary(row));
  }

  readProject(projectId: string): ProjectSummary | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** The project occupying a directory, if any. Import is idempotent because of
   *  this: adopting the same directory twice reopens it rather than making a
   *  second row that would fight the first over the same files. */
  readProjectAt(directory: string): ProjectSummary | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE directory = ?").get(directory) as ProjectRow | undefined;
    return row ? toSummary(row) : null;
  }

  createProject(record: CreateProjectRecord): ProjectSummary {
    const existing = this.readProjectAt(record.directory);
    if (existing) return existing;

    const row: ProjectRow = {
      id: randomUUID(),
      name: record.name,
      goal: record.goal,
      directory: record.directory,
      language: record.language,
      created_at: new Date().toISOString(),
      opened_at: null,
      pinned_at: null,
      archived_at: null,
    };
    this.database
      .prepare("INSERT INTO projects (id, name, goal, directory, language, created_at, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.name, row.goal, row.directory, row.language, row.created_at, row.opened_at);
    return toSummary(row);
  }

  renameProject(projectId: string, name: string): void {
    this.database.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, projectId);
  }

  setPinned(projectId: string, pinned: boolean): void {
    this.database.prepare("UPDATE projects SET pinned_at = ? WHERE id = ?").run(pinned ? new Date().toISOString() : null, projectId);
  }

  setArchived(projectId: string, archived: boolean): void {
    this.database.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run(archived ? new Date().toISOString() : null, projectId);
  }

  /** Stamps the project as opened, which is also what orders the project list.
   *  Recency is the only ordering that stays right without being maintained. */
  markOpened(projectId: string): void {
    this.database.prepare("UPDATE projects SET opened_at = ? WHERE id = ?").run(new Date().toISOString(), projectId);
  }

  /** Forgets the project. The directory on disk is left exactly as it is —
   *  those files are the learner's work, and Construct did not write most of
   *  them. */
  deleteProject(projectId: string): void {
    /* The conversation goes with it. ON DELETE CASCADE would do this too, but
       only with foreign keys enforced on every connection, and a thread
       orphaned from its project is unreachable data still counted against the
       file. */
    this.database.prepare("DELETE FROM agent_messages WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }

  /* ---- Agent conversation ------------------------------------------------ */

  listMessages(projectId: string): AgentMessage[] {
    const rows = this.database
      .prepare("SELECT * FROM agent_messages WHERE project_id = ? ORDER BY created_at, rowid")
      .all(projectId) as Array<{ id: string; role: string; body: string; activity: string; created_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      role: row.role as AgentMessage["role"],
      body: row.body,
      createdAt: row.created_at,
      activity: parseActivity(row.activity),
    }));
  }

  appendMessage(projectId: string, message: AgentMessage): void {
    this.database
      .prepare("INSERT INTO agent_messages (id, project_id, role, body, activity, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(message.id, projectId, message.role, message.body, JSON.stringify(message.activity), message.createdAt);
  }
}

/** A row written by an older build, or corrupted, still has a readable message
 *  body — losing the activity trail is far better than losing the turn. */
function parseActivity(value: string): AgentMessage["activity"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentMessage["activity"]) : [];
  } catch {
    return [];
  }
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    directory: row.directory,
    language: row.language as Language,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    present: existsSync(row.directory),
  };
}
