import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Language } from "@construct/domain";
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
];

type ProjectRow = {
  id: string;
  name: string;
  goal: string;
  directory: string;
  language: string;
  created_at: string;
  opened_at: string | null;
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

  getSetting<T extends string>(key: string, fallback: T): T {
    const row = this.database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return (row?.value as T) ?? fallback;
  }

  setSetting(key: string, value: string): void {
    this.database
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  theme(): ThemePreference {
    return this.getSetting<ThemePreference>("theme", "system");
  }

  setTheme(theme: ThemePreference): void {
    this.setSetting("theme", theme);
  }

  /* ---- Projects --------------------------------------------------------- */

  listProjects(): ProjectSummary[] {
    /* rowid breaks the tie. Two projects created inside the same millisecond
       share a timestamp, and without a second key SQLite is free to return
       them in either order — which shows up as a project list that reshuffles
       itself between launches. rowid rises with insertion, so it orders them
       the way they were made. */
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY COALESCE(opened_at, created_at) DESC, rowid DESC")
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
    };
    this.database
      .prepare("INSERT INTO projects (id, name, goal, directory, language, created_at, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.name, row.goal, row.directory, row.language, row.created_at, row.opened_at);
    return toSummary(row);
  }

  renameProject(projectId: string, name: string): void {
    this.database.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, projectId);
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
    this.database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
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
    present: existsSync(row.directory),
  };
}
