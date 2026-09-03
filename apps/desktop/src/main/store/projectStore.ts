import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { AgentMessage, Language } from "@construct/domain";
import type { ProjectSummary, ThemePreference } from "../../shared/api.js";
import type { PathNode } from "../learning/pathService.js";
import type { SnapshotFile } from "../projects/snapshotService.js";
import { openDatabase, type Database } from "./database.js";
import type { SyncPush } from "../../shared/sync.js";

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

  /* What the learner understands, per project.
     
     Mastery is per concept and per project because that is how the agent
     reasons about it: a concept introduced while building a renderer is
     evidence about this learner, but the level it reached is evidence about
     this project's use of it. The event log beside it is the record of how the
     level moved, which is what the agent reads back to avoid re-teaching. */
  `CREATE TABLE concepts (
     project_id    TEXT NOT NULL REFERENCES projects (id),
     concept_id    TEXT NOT NULL,
     title         TEXT NOT NULL,
     mastery_level INTEGER NOT NULL DEFAULT 0,
     confidence    TEXT NOT NULL DEFAULT 'introduced',
     note          TEXT NOT NULL DEFAULT '',
     first_seen_at TEXT NOT NULL,
     updated_at    TEXT NOT NULL,
     PRIMARY KEY (project_id, concept_id)
   );
   CREATE TABLE concept_events (
     id            TEXT PRIMARY KEY,
     project_id    TEXT NOT NULL,
     concept_id    TEXT NOT NULL,
     kind          TEXT NOT NULL,
     previous_level INTEGER,
     mastery_level INTEGER,
     reason        TEXT NOT NULL DEFAULT '',
     created_at    TEXT NOT NULL
   );
   CREATE INDEX concept_events_project ON concept_events (project_id, created_at);`,

  /* A concept is a note the learner can read, not just a level.
     
     v0.7's KnowledgeBaseRecord is the model: what the idea is, why it matters,
     a worked example, real references, and the evidence behind the current
     reading. Storing only a title and a number — which is what the first cut
     did — produces a card with nothing in it, which is worse than no card. */
  `ALTER TABLE concepts ADD COLUMN summary TEXT NOT NULL DEFAULT '';
   ALTER TABLE concepts ADD COLUMN why TEXT NOT NULL DEFAULT '';
   ALTER TABLE concepts ADD COLUMN example TEXT NOT NULL DEFAULT '';
   ALTER TABLE concepts ADD COLUMN docs TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE concepts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`,

  /* The remaining fields v0.7's concept card actually renders: the untitled
     body, the mistake this idea is usually got wrong by, and the language its
     example is written in. `summary` stays as the one-line gloss the rail and
     cards use; `content` is the body the sidecar reads from. */
  `ALTER TABLE concepts ADD COLUMN content TEXT NOT NULL DEFAULT '';
   ALTER TABLE concepts ADD COLUMN common_mistake TEXT NOT NULL DEFAULT '';
   ALTER TABLE concepts ADD COLUMN language TEXT NOT NULL DEFAULT '';`,

  /* The path: the ordered steps between where the learner is and the project
     they set out to build.
     
     Its own table rather than JSON on the project row, because the path is read
     and written a step at a time — marking one done, revising the tail — and a
     blob would mean rewriting the whole plan to move one status. `current_node`
     lives on the project because it is a property of the project's progress
     rather than of any step. */
  `CREATE TABLE path_nodes (
     project_id     TEXT NOT NULL REFERENCES projects (id),
     node_id        TEXT NOT NULL,
     title          TEXT NOT NULL,
     summary        TEXT NOT NULL DEFAULT '',
     status         TEXT NOT NULL DEFAULT 'planned',
     sort_order     INTEGER NOT NULL DEFAULT 0,
     kind           TEXT NOT NULL DEFAULT 'custom',
     concepts       TEXT NOT NULL DEFAULT '[]',
     exit_criteria  TEXT NOT NULL DEFAULT '[]',
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL,
     PRIMARY KEY (project_id, node_id)
   );
   CREATE INDEX path_nodes_project ON path_nodes (project_id, sort_order);
   ALTER TABLE projects ADD COLUMN current_path_node TEXT;`,

  /* Concepts nest.
     
     Until now the only hierarchy concepts had was their tags, and the sidebar
     built a two-level tree by reading the first two of them. That is a shelf,
     not a structure: it cannot say that virtual dispatch sits under
     polymorphism which sits under object orientation, which is exactly the
     shape understanding has. The parent is a real edge, so the tree can be as
     deep as the subject is.

     Nullable, and deliberately not a foreign key: the agent may record a child
     before the parent it names, and a constraint would reject the write rather
     than let the tree complete itself on the next turn. Readers treat a parent
     that resolves to nothing as a root. */
  `ALTER TABLE concepts ADD COLUMN parent_id TEXT;
   CREATE INDEX concepts_parent ON concepts (project_id, parent_id);`,

  /* Practice tasks: the work the learner actually does.
     
     The prompt has told the agent to set these since the port — a gap with
     success criteria, guidance, and a concept it exercises — and there has been
     nothing to set them with, so it described tasks in prose and they scrolled
     away with the rest of the conversation. A task is not a message: it outlives
     the turn that set it, it has a state the learner moves it through, and it is
     the one thing on screen that says what to do next.
     
     `criteria` is what "done" means, as a list rather than a paragraph, because
     the learner ticks them off and the agent checks against them. */
  `CREATE TABLE tasks (
     project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     task_id     TEXT NOT NULL,
     title       TEXT NOT NULL,
     brief       TEXT NOT NULL DEFAULT '',
     criteria    TEXT NOT NULL DEFAULT '[]',
     concepts    TEXT NOT NULL DEFAULT '[]',
     files       TEXT NOT NULL DEFAULT '[]',
     status      TEXT NOT NULL DEFAULT 'open',
     outcome     TEXT NOT NULL DEFAULT '',
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     PRIMARY KEY (project_id, task_id)
   );
   CREATE INDEX tasks_project ON tasks (project_id, created_at);`,

  /* Undo points.
     
     Editing an earlier message means the turns after it never happened, and
     those turns wrote files, concepts, tasks and a path. Rewinding the
     conversation without rewinding all of that would leave the learner with
     code the transcript no longer explains — so a snapshot is taken before
     every turn the learner starts, and it covers both.
     
     Files are content-addressed: the manifest is paths and hashes, the bytes
     live once each in `snapshot_blobs` and are shared by every snapshot holding
     that version. The rest of the state is small enough to store whole, and
     storing it whole means a restore is an assignment rather than a replay.
     
     Blobs are deliberately not scoped to a project. Two projects from the same
     template share most of their files, and a hash is a hash. */
  `CREATE TABLE snapshots (
     project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     message_id  TEXT NOT NULL,
     files       TEXT NOT NULL DEFAULT '[]',
     concepts    TEXT NOT NULL DEFAULT '[]',
     tasks       TEXT NOT NULL DEFAULT '[]',
     path_nodes  TEXT NOT NULL DEFAULT '[]',
     current_path_node TEXT,
     created_at  TEXT NOT NULL,
     PRIMARY KEY (project_id, message_id)
   );
   CREATE TABLE snapshot_blobs (
     hash    TEXT PRIMARY KEY,
     content BLOB NOT NULL
   );`,

  /* What sync reads.
     
     Every other table already records when it last changed, because the agent
     writes them a row at a time and the undo points need it. Projects did not:
     a project row was written once and then poked — renamed, pinned, archived —
     with nothing recording that it had moved. Sync asks exactly that question,
     so the column has to exist before it can be answered.
     
     Backfilled from `created_at` rather than left null: an existing project has
     certainly not changed since it was made, and null would make it look newer
     than everything on the other machine.
     
     Deletion becomes a state for the same reason it is one in the cloud. A row
     that is simply gone cannot tell another device that it was deleted rather
     than never seen, so the next pull would hand it straight back. */
  `ALTER TABLE projects ADD COLUMN updated_at TEXT;
   UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL;
   ALTER TABLE projects ADD COLUMN deleted_at TEXT;
   ALTER TABLE agent_messages ADD COLUMN deleted_at TEXT;
   CREATE INDEX projects_updated ON projects (updated_at);`,

  /* What a concept change actually was.

     `concept_events` has recorded every reading since the first migration and
     nothing has ever read it back — so the history was there and invisible, and
     the level was the only part of it the row could name. A concept usually
     changes in ways a level does not describe: the note gets rewritten, the
     summary reworded, the concept moved under a parent. Those are the entries a
     learner recognises when they look at what happened to their own note, so
     the fields the call rewrote are stored beside the level it set.
     
     Empty for every event written before this, which is honest: those changes
     happened and nobody wrote down which parts they touched. */
  `ALTER TABLE concept_events ADD COLUMN changed TEXT NOT NULL DEFAULT '[]';
   CREATE INDEX concept_events_concept ON concept_events (project_id, concept_id, created_at);`,
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

/** Re-exported so the store's callers do not have to know that the path's shape
 *  is defined beside the service that plans it. */
export type { PathNode } from "../learning/pathService.js";

export type ConceptRecord = {
  conceptId: string;
  /** The concept this one sits under, if any. A tree of understanding rather
   *  than a list: the parent is what makes "this is a special case of that"
   *  something the interface can show. Null for a root, and for a parent that
   *  no longer exists. */
  parentId: string | null;
  title: string;
  masteryLevel: 0 | 1 | 2 | 3 | 4 | 5;
  confidence: string;
  /** The evidence behind the current level — what the learner said or did. */
  note: string;
  /** What the idea is, in a couple of sentences. */
  summary: string;
  /** The whole note, as Markdown: the encyclopedia entry the learner reads. */
  content: string;
  /** Real references. Kept because a concept the learner can only read here is
   *  a dead end, and the agent is better placed than they are to find the good
   *  page. */
  docs: Array<{ title: string; url: string }>;
  tags: string[];
  firstSeenAt: string;
  updatedAt: string;
};

/** One entry in a concept's history: what a single `record-concept` call did to
 *  it. The learner's own change log for a note they own. */
export type ConceptEvent = {
  eventId: string;
  conceptId: string;
  /** How the reading moved. `referenced` is a call that left the level where it
   *  was — the agent came back to the idea and did not change its mind. */
  kind: "introduced" | "leveled-up" | "leveled-down" | "referenced";
  /** Null for the first reading, which had nothing before it. */
  previousLevel: number | null;
  masteryLevel: number;
  /** The agent's own sentence on why, when it gave one. */
  reason: string;
  /** Which written parts the call rewrote: `title`, `summary`, `content`,
   *  `note`, `docs`, `tags`, `parent`. Empty when only the level moved, and for
   *  events recorded before this was kept. */
  changed: ConceptField[];
  createdAt: string;
};

export type ConceptField = "title" | "summary" | "content" | "note" | "docs" | "tags" | "parent";

/**
 * One practice task.
 *
 * `status` is the learner's side of it and `outcome` is the agent's: a task goes
 * open → submitted when they say they have done it, and the agent moves it to
 * passed or back to open with a note saying what is still missing. Keeping the
 * two apart is what lets the card say "in review" rather than guess.
 */
export type TaskRecord = {
  taskId: string;
  title: string;
  /** What to build and why, as Markdown. */
  brief: string;
  /** What "done" means, one line each. */
  criteria: string[];
  /** Concept ids this exercises, so a task is always tied to something taught. */
  concepts: string[];
  /** Project-relative paths the work belongs in. */
  files: string[];
  status: "open" | "submitted" | "passed";
  /** The agent's verdict, shown under the task once it has one. */
  outcome: string;
  createdAt: string;
  updatedAt: string;
};

/** A project's state before one turn: its files, and everything the database
 *  owns that a turn can change. */
export type Snapshot = {
  messageId: string;
  files: SnapshotFile[];
  concepts: ConceptRecord[];
  tasks: TaskRecord[];
  pathNodes: PathNode[];
  currentPathNode: string | null;
  createdAt: string;
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

  /**
   * Empties the device of the account that was signed in.
   *
   * There is no account column anywhere in this schema, and that is a decision
   * rather than an omission: Construct is local-first, works signed out, and a
   * device holds one learner's work at a time. The cost of that decision is
   * paid exactly here — everything left behind is served to whoever signs in
   * next, which is how a second account arrived to find the first one's
   * projects and was never asked a single intake question.
   *
   * Ordered by dependency and wrapped in one transaction, because a half-wiped
   * device is worse than either state: rows referencing a project that is gone
   * would fail to read, and the learner cannot repair that from the app.
   *
   * What is deliberately *not* touched is the files. Spar's workspaces belong
   * to Spar and go with the account; a Construct project is a folder of the
   * learner's own code, in a directory they chose. Signing out of an app must
   * never delete somebody's source, so this forgets projects without deleting
   * them — the folder stays where it is, and signing back in reattaches.
   *
   * The settings that go are the ones that describe the account rather than the
   * machine: the profile, whether intake was done, and both sync cursors. The
   * cursors especially — left behind, the next account's first sync would ask
   * for "everything since" a timestamp belonging to somebody else's history and
   * be handed almost nothing. Theme, provider choice and the projects folder
   * stay, because they are true of this computer whoever is using it.
   */
  clearAccountData(): void {
    this.database.exec("BEGIN");
    try {
      for (const table of ["snapshot_blobs", "snapshots", "concept_events", "agent_messages", "path_nodes", "tasks", "concepts", "projects"]) {
        this.database.prepare(`DELETE FROM ${table}`).run();
      }
      const forget = this.database.prepare("DELETE FROM settings WHERE key = ?");
      for (const key of ["learner-profile", "learner-onboarded", "sync-cursor", "sync-cursor-local"]) forget.run(key);
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw new Error("Construct could not clear this device.", { cause });
    }
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
          WHERE deleted_at IS NULL
         ORDER BY (pinned_at IS NOT NULL) DESC,
                  COALESCE(opened_at, created_at) DESC,
                  (opened_at IS NOT NULL) DESC,
                  rowid DESC`,
      )
      .all() as ProjectRow[];
    return rows.map((row) => toSummary(row));
  }

  readProject(projectId: string): ProjectSummary | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").get(projectId) as ProjectRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** The project occupying a directory, if any. Import is idempotent because of
   *  this: adopting the same directory twice reopens it rather than making a
   *  second row that would fight the first over the same files. */
  readProjectAt(directory: string): ProjectSummary | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE directory = ? AND deleted_at IS NULL").get(directory) as ProjectRow | undefined;
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
    this.database.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), projectId);
  }

  setPinned(projectId: string, pinned: boolean): void {
    this.database.prepare("UPDATE projects SET pinned_at = ?, updated_at = ? WHERE id = ?").run(pinned ? new Date().toISOString() : null, new Date().toISOString(), projectId);
  }

  setArchived(projectId: string, archived: boolean): void {
    this.database.prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?").run(archived ? new Date().toISOString() : null, new Date().toISOString(), projectId);
  }

  /** Stamps the project as opened, which is also what orders the project list.
   *  Recency is the only ordering that stays right without being maintained. */
  /** Deliberately does not stamp `updated_at`. Which machine looked at a
   *  project last is not news the others need, and stamping it would make
   *  merely opening a project a thing to sync. */
  markOpened(projectId: string): void {
    this.database.prepare("UPDATE projects SET opened_at = ? WHERE id = ?").run(new Date().toISOString(), projectId);
  }

  /** Forgets the project. The directory on disk is left exactly as it is —
   *  those files are the learner's work, and Construct did not write most of
   *  them. */
  deleteProject(projectId: string): void {
    /* The conversation and the concept history go with it. ON DELETE CASCADE
       would do this too, but only with foreign keys enforced on every
       connection, and a thread orphaned from its project is unreachable data
       still counted against the file.

       The concept tables were missing here, and not harmlessly: their foreign
       key made deleting any project that had taught the learner anything fail
       outright — which is every project that has been used. Caught by the atlas
       test, which is the first thing that ever deleted a project with concepts
       in it. */
    this.database.prepare("DELETE FROM agent_messages WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM concept_events WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM path_nodes WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM concepts WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
    this.database.prepare("DELETE FROM snapshots WHERE project_id = ?").run(projectId);

    /* The project row stays, as a tombstone.
       
       A row that is simply gone cannot tell another machine that it was
       deleted rather than never seen, so the next pull would hand the project
       straight back — and the one after that, forever. Everything that made it
       big is gone above; what is left is an id, a name and the fact that it
       should not exist. Readers filter on `deleted_at`. */
    const now = new Date().toISOString();
    this.database.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, projectId);
  }

  /* ---- Agent conversation ------------------------------------------------ */

  listMessages(projectId: string): AgentMessage[] {
    const rows = this.database
      .prepare("SELECT * FROM agent_messages WHERE project_id = ? ORDER BY created_at, rowid")
      .all(projectId) as Array<{ id: string; role: string; body: string; activity: string; created_at: string }>;

    const messages = rows.map((row) => ({
      id: row.id,
      role: row.role as AgentMessage["role"],
      body: row.body,
      createdAt: row.created_at,
      activity: parseActivity(row.activity),
    }));

    /* The pre-gate kickoff could store the same system notice from two
       concurrent starts. It is runtime bookkeeping, not learner-authored data;
       show it once while leaving repeated learner/agent messages untouched. */
    const systemBodies = new Set<string>();
    const visible: AgentMessage[] = [];
    for (const message of messages) {
      if (message.role === "system") {
        if (systemBodies.has(message.body)) continue;
        systemBodies.add(message.body);
      }

      const previous = visible[visible.length - 1];
      /* A learner retry created while the prior turn was stuck has no agent
         reply between it and the original. Treat that exact consecutive shape
         as one input, so repaired history does not tell the model "go" twice. */
      if (message.role === "learner" && previous?.role === "learner" && previous.body === message.body) continue;
      visible.push(message);
    }
    return visible;
  }

  /* ---- The path ---------------------------------------------------------- */

  listPathNodes(projectId: string): PathNode[] {
    const rows = this.database
      .prepare("SELECT * FROM path_nodes WHERE project_id = ? ORDER BY sort_order, rowid")
      .all(projectId) as Array<Record<string, string | number>>;

    return rows.map((row) => ({
      id: String(row.node_id),
      title: String(row.title),
      summary: String(row.summary ?? ""),
      status: String(row.status) as PathNode["status"],
      order: Number(row.sort_order),
      kind: String(row.kind) as PathNode["kind"],
      concepts: parseJson<string[]>(String(row.concepts ?? "[]"), []),
      exitCriteria: parseJson<string[]>(String(row.exit_criteria ?? "[]"), []),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  currentPathNode(projectId: string): string | null {
    const row = this.database.prepare("SELECT current_path_node FROM projects WHERE id = ?").get(projectId) as
      | { current_path_node: string | null }
      | undefined;
    return row?.current_path_node ?? null;
  }

  /**
   * Replaces the whole path in one transaction.
   *
   * Replace rather than merge, because a revision is the agent's new opinion of
   * the *whole* plan — steps get reordered, renamed and dropped — and a merge
   * would leave the abandoned ones behind with no way to tell them from the
   * live ones. What survives a replacement is decided a level up, in
   * `PathService`, which is where the rule that finished work stays finished
   * lives.
   */
  replacePath(projectId: string, nodes: PathNode[], currentNodeId: string | null): void {
    /* Explicit BEGIN/COMMIT rather than a `transaction()` helper: `node:sqlite`'s
       DatabaseSync has no such method — that is better-sqlite3's API — and a
       half-written path is worse than no path, so the boundary has to be real. */
    this.database.exec("BEGIN");
    try {
      this.database.prepare("DELETE FROM path_nodes WHERE project_id = ?").run(projectId);
      const insert = this.database.prepare(
        `INSERT INTO path_nodes (project_id, node_id, title, summary, status, sort_order, kind, concepts, exit_criteria, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of nodes) {
        insert.run(
          projectId,
          node.id,
          node.title,
          node.summary,
          node.status,
          node.order,
          node.kind,
          JSON.stringify(node.concepts),
          JSON.stringify(node.exitCriteria),
          node.createdAt,
          node.updatedAt,
        );
      }
      this.database.prepare("UPDATE projects SET current_path_node = ?, updated_at = ? WHERE id = ?").run(currentNodeId, new Date().toISOString(), projectId);
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  /* ---- Concepts ---------------------------------------------------------- */

  /**
   * Forgets one concept, and its history with it.
   *
   * The learner's own call, and it has to exist: the agent files a concept from
   * whatever the conversation touched, so a stray one — a typo it heard as a
   * topic, an idea that turned out to belong to a different project — is
   * inevitable, and an atlas you cannot correct is an atlas you stop trusting.
   *
   * The events go too. Keeping them would leave a level history for a concept
   * that no longer exists, which is unreachable data that still counts against
   * the file.
   */
  deleteConcept(projectId: string, conceptId: string): void {
    this.database.prepare("DELETE FROM concept_events WHERE project_id = ? AND concept_id = ?").run(projectId, conceptId);
    this.database.prepare("DELETE FROM concepts WHERE project_id = ? AND concept_id = ?").run(projectId, conceptId);
  }


  listConcepts(projectId: string): ConceptRecord[] {
    const rows = this.database
      .prepare(
        /* Most recently moved first. A concept the agent just taught is the one
           the learner is holding in their head, so it leads. */
        "SELECT * FROM concepts WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC",
      )
      .all(projectId) as Array<Record<string, string | number>>;

    return rows.map(conceptFromRow);
  }

  /**
   * Every concept in every project, newest first, each carrying its project.
   *
   * Joined rather than looped per project: the atlas asks for all of them at
   * once, and a query per project is a query per project the day the learner has
   * forty of them.
   */
  listAllConcepts(): Array<ConceptRecord & { projectId: string; projectName: string }> {
    const rows = this.database
      .prepare(
        `SELECT concepts.*, projects.name AS project_name
           FROM concepts
           JOIN projects ON projects.id = concepts.project_id
          ORDER BY concepts.updated_at DESC, concepts.rowid DESC`,
      )
      .all() as Array<Record<string, string | number>>;

    return rows.map((row) => ({ ...conceptFromRow(row), projectId: String(row.project_id), projectName: String(row.project_name) }));
  }

  /**
   * Records what the agent observed about one concept.
   *
   * Upsert rather than insert: a concept is taught, practised and assessed over
   * many turns, and each of those is a new reading of the same thing. The event
   * log keeps the history that the row itself overwrites, so a level that moved
   * down is still explicable afterwards.
   */
  recordConcept(input: {
    projectId: string;
    conceptId: string;
    /** Undefined leaves whatever parent is already recorded; null detaches it
     *  to a root. The two have to be distinguishable, because most calls are
     *  level updates that say nothing about where the concept sits. */
    parentId?: string | null;
    title: string;
    masteryLevel: number;
    confidence: string;
    note: string;
    reason: string;
    summary: string;
    content: string;
    docs: Array<{ title: string; url: string }>;
    tags: string[];
  }): ConceptEvent {
    const now = new Date().toISOString();
    /* The whole row, not just the level: what changed is the question the
       history has to answer, and a diff needs the side that is already there. */
    const existing = this.database
      .prepare("SELECT mastery_level, parent_id, title, summary, content, note, docs, tags FROM concepts WHERE project_id = ? AND concept_id = ?")
      .get(input.projectId, input.conceptId) as Record<string, string | number | null> | undefined;

    const level = Math.min(5, Math.max(0, Math.round(input.masteryLevel)));
    const changed = conceptChanges(existing, input);

    /* The written content is only overwritten when the agent sends something.
       A later turn that just moves the level must not blank the explanation the
       learner has been reading — COALESCE keeps whatever is already there. */
    this.database
      .prepare(
        `INSERT INTO concepts (project_id, concept_id, parent_id, title, mastery_level, confidence, note, summary, why, example, docs, tags, content, common_mistake, language, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, concept_id) DO UPDATE SET
           title = excluded.title,
           mastery_level = excluded.mastery_level,
           confidence = excluded.confidence,
           note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE concepts.note END,
           summary = CASE WHEN excluded.summary <> '' THEN excluded.summary ELSE concepts.summary END,
           why = CASE WHEN excluded.why <> '' THEN excluded.why ELSE concepts.why END,
           example = CASE WHEN excluded.example <> '' THEN excluded.example ELSE concepts.example END,
           docs = CASE WHEN excluded.docs <> '[]' THEN excluded.docs ELSE concepts.docs END,
           tags = CASE WHEN excluded.tags <> '[]' THEN excluded.tags ELSE concepts.tags END,
           content = CASE WHEN excluded.content <> '' THEN excluded.content ELSE concepts.content END,
           common_mistake = CASE WHEN excluded.common_mistake <> '' THEN excluded.common_mistake ELSE concepts.common_mistake END,
           language = CASE WHEN excluded.language <> '' THEN excluded.language ELSE concepts.language END,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        input.conceptId,
        input.parentId && input.parentId !== input.conceptId ? input.parentId : null,
        input.title,
        level,
        input.confidence,
        input.note,
        input.summary,
        "",
        "",
        JSON.stringify(input.docs),
        JSON.stringify(input.tags),
        input.content,
        "",
        "",
        now,
        now,
      );

    /* Placed separately, and only when the call said something about it.
       
       Folding this into the upsert would mean either clobbering the parent on
       every level update — most calls carry no parent and would orphan a
       concept the agent placed three turns ago — or a conditional that cannot
       tell "leave it alone" from "detach it". A second statement says exactly
       what was meant. */
    if (input.parentId !== undefined) {
      this.database
        .prepare("UPDATE concepts SET parent_id = ? WHERE project_id = ? AND concept_id = ?")
        /* Never its own parent: a self-edge hides the concept from every reader
           that walks down from the roots. */
        .run(input.parentId && input.parentId !== input.conceptId ? input.parentId : null, input.projectId, input.conceptId);
    }

    const before = existing === undefined ? null : Number(existing.mastery_level);
    const kind: ConceptEvent["kind"] =
      before === null ? "introduced" : level > before ? "leveled-up" : level < before ? "leveled-down" : "referenced";
    const eventId = randomUUID();

    this.database
      .prepare("INSERT INTO concept_events (id, project_id, concept_id, kind, previous_level, mastery_level, reason, changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, input.projectId, input.conceptId, kind, before, level, input.reason, JSON.stringify(changed), now);

    /* Handed back rather than only filed. The transcript draws this call as a
       card, and "L2 → L3, because they explained the depth test unprompted" is
       the whole point of the card — it cannot be recovered from the arguments,
       because only the store knows what was there before. */
    return { eventId, conceptId: input.conceptId, kind, previousLevel: before, masteryLevel: level, reason: input.reason, changed, createdAt: now };
  }

  /**
   * One concept's history, newest first.
   *
   * Every reading the agent has taken of this idea, which is a different account
   * of the project from the transcript: the transcript says what was said, and
   * this says what it was taken to mean.
   */
  listConceptEvents(projectId: string, conceptId: string): ConceptEvent[] {
    const rows = this.database
      .prepare("SELECT * FROM concept_events WHERE project_id = ? AND concept_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(projectId, conceptId) as Array<Record<string, string | number | null>>;

    return rows.map((row) => ({
      eventId: String(row.id),
      conceptId: String(row.concept_id),
      kind: (["introduced", "leveled-up", "leveled-down", "referenced"] as const).includes(row.kind as never)
        ? (row.kind as ConceptEvent["kind"])
        : "referenced",
      previousLevel: row.previous_level === null ? null : Number(row.previous_level),
      masteryLevel: Number(row.mastery_level ?? 0),
      reason: String(row.reason ?? ""),
      changed: parseJson<ConceptField[]>(String(row.changed ?? "[]"), []).filter((field): field is ConceptField =>
        (CONCEPT_FIELDS as readonly string[]).includes(field),
      ),
      createdAt: String(row.created_at),
    }));
  }

  /* ---- Practice tasks ---------------------------------------------------- */

  listTasks(projectId: string): TaskRecord[] {
    const rows = this.database
      /* Oldest first, the order they were set in: the task list is a history of
         what has been asked, and the current one is the end of it. */
      .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at, rowid")
      .all(projectId) as Array<Record<string, string | number>>;

    return rows.map((row) => ({
      taskId: String(row.task_id),
      title: String(row.title),
      brief: String(row.brief ?? ""),
      criteria: parseJson<string[]>(String(row.criteria ?? "[]"), []),
      concepts: parseJson<string[]>(String(row.concepts ?? "[]"), []),
      files: parseJson<string[]>(String(row.files ?? "[]"), []),
      status: (["open", "submitted", "passed"] as const).includes(row.status as never)
        ? (row.status as TaskRecord["status"])
        : "open",
      outcome: String(row.outcome ?? ""),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  /** Writes a task, or updates the one with this id. The agent sets these, so
   *  one call has to serve both "here is a new task" and "here is that task
   *  again, corrected". */
  saveTask(projectId: string, task: Omit<TaskRecord, "createdAt" | "updatedAt">): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO tasks (project_id, task_id, title, brief, criteria, concepts, files, status, outcome, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, task_id) DO UPDATE SET
           title = excluded.title,
           brief = excluded.brief,
           criteria = excluded.criteria,
           concepts = excluded.concepts,
           files = excluded.files,
           status = excluded.status,
           outcome = excluded.outcome,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        task.taskId,
        task.title,
        task.brief,
        JSON.stringify(task.criteria),
        JSON.stringify(task.concepts),
        JSON.stringify(task.files),
        task.status,
        task.outcome,
        now,
        now,
      );
  }

  /** Moves a task's state without touching what it asks for. The learner
   *  submitting and the agent judging both land here. */
  setTaskStatus(projectId: string, taskId: string, status: TaskRecord["status"], outcome?: string): void {
    const now = new Date().toISOString();
    if (outcome === undefined) {
      this.database
        .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE project_id = ? AND task_id = ?")
        .run(status, now, projectId, taskId);
      return;
    }
    this.database
      .prepare("UPDATE tasks SET status = ?, outcome = ?, updated_at = ? WHERE project_id = ? AND task_id = ?")
      .run(status, outcome, now, projectId, taskId);
  }

  /* ---- Sync ---------------------------------------------------------------
     
     Two halves and one rule. `changedSince` is what this machine has to say;
     `applyRemote` is what it has been told. The rule is last-write-wins on
     `updated_at`, applied in SQL rather than by comparing in JavaScript first —
     a read-then-write would let a concurrent local edit land between the two
     and be silently overwritten by the row it was newer than. */

  /** Everything written here since the cursor, in the shape the protocol uses.
   *  `directory` is deliberately absent: it is an absolute path on this machine
   *  and means nothing on another. */
  changedSince(since: string | null): SyncPush {
    const after = since ?? "";
    const rows = <T>(sql: string): T[] => this.database.prepare(sql).all(after) as T[];

    return {
      projects: rows<Record<string, string | null>>(
        `SELECT id, name, goal, language, pinned_at, archived_at, current_path_node, deleted_at, created_at, updated_at
           FROM projects WHERE COALESCE(updated_at, created_at) > ?`,
      ).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        goal: String(row.goal),
        language: String(row.language),
        pinnedAt: row.pinned_at ?? null,
        archivedAt: row.archived_at ?? null,
        currentPathNode: row.current_path_node ?? null,
        deletedAt: row.deleted_at ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at ?? row.created_at),
      })),

      /* Messages have no `updated_at` of their own: they are written once and
         never edited, so when they were created is when they last changed. The
         one thing that moves is the tombstone, and that is carried by sending
         the row again. */
      messages: rows<Record<string, string | null>>(
        `SELECT id, project_id, role, body, activity, deleted_at, created_at
           FROM agent_messages WHERE created_at > ? OR (deleted_at IS NOT NULL AND deleted_at > ?)`.replace("?", "?"),
      ).map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        role: String(row.role),
        body: String(row.body),
        activity: parseJson<unknown[]>(String(row.activity ?? "[]"), []),
        deletedAt: row.deleted_at ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.deleted_at ?? row.created_at),
      })),

      concepts: rows<Record<string, string | number | null>>(
        "SELECT * FROM concepts WHERE updated_at > ?",
      ).map((row) => ({
        projectId: String(row.project_id),
        conceptId: String(row.concept_id),
        parentId: row.parent_id ? String(row.parent_id) : null,
        title: String(row.title),
        masteryLevel: Number(row.mastery_level),
        confidence: String(row.confidence ?? ""),
        note: String(row.note ?? ""),
        summary: String(row.summary ?? ""),
        content: String(row.content ?? ""),
        docs: parseJson<Array<{ title: string; url: string }>>(String(row.docs ?? "[]"), []),
        tags: parseJson<string[]>(String(row.tags ?? "[]"), []),
        firstSeenAt: String(row.first_seen_at),
        updatedAt: String(row.updated_at),
      })),

      tasks: rows<Record<string, string | null>>("SELECT * FROM tasks WHERE updated_at > ?").map((row) => ({
        projectId: String(row.project_id),
        taskId: String(row.task_id),
        title: String(row.title),
        brief: String(row.brief ?? ""),
        criteria: parseJson<string[]>(String(row.criteria ?? "[]"), []),
        concepts: parseJson<string[]>(String(row.concepts ?? "[]"), []),
        files: parseJson<string[]>(String(row.files ?? "[]"), []),
        status: String(row.status ?? "open"),
        outcome: String(row.outcome ?? ""),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),

      pathNodes: rows<Record<string, string | number | null>>("SELECT * FROM path_nodes WHERE updated_at > ?").map((row) => ({
        projectId: String(row.project_id),
        nodeId: String(row.node_id),
        title: String(row.title),
        summary: String(row.summary ?? ""),
        status: String(row.status ?? "planned"),
        sortOrder: Number(row.sort_order ?? 0),
        kind: String(row.kind ?? "custom"),
        concepts: parseJson<string[]>(String(row.concepts ?? "[]"), []),
        exitCriteria: parseJson<string[]>(String(row.exit_criteria ?? "[]"), []),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
    };
  }

  /**
   * Writes what another machine has done.
   *
   * Every statement carries its own `WHERE excluded is newer` guard, so a pull
   * that arrives while this machine is mid-edit cannot undo the edit. A project
   * that has never been seen here arrives without a directory — the caller
   * decides where it lands, because that is the one field the cloud does not
   * carry.
   */
  applyRemote(pull: SyncPush, directoryFor: (project: { id: string; name: string }) => string): void {
    this.atomically(() => {
      for (const row of pull.projects) {
        const existing = this.database.prepare("SELECT id FROM projects WHERE id = ?").get(row.id);
        if (!existing) {
          this.database
            .prepare(
              `INSERT INTO projects (id, name, goal, directory, language, created_at, opened_at, pinned_at, archived_at, current_path_node, deleted_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
            )
            .run(
              row.id,
              row.name,
              row.goal,
              directoryFor(row),
              row.language,
              row.createdAt,
              row.pinnedAt,
              row.archivedAt,
              row.currentPathNode,
              row.deletedAt ?? null,
              row.updatedAt,
            );
          continue;
        }
        this.database
          .prepare(
            `UPDATE projects SET name = ?, goal = ?, language = ?, pinned_at = ?, archived_at = ?, current_path_node = ?, deleted_at = ?, updated_at = ?
              WHERE id = ? AND COALESCE(updated_at, created_at) < ?`,
          )
          .run(
            row.name,
            row.goal,
            row.language,
            row.pinnedAt,
            row.archivedAt,
            row.currentPathNode,
            row.deletedAt ?? null,
            row.updatedAt,
            row.id,
            row.updatedAt,
          );
      }

      for (const row of pull.messages) {
        this.database
          .prepare(
            `INSERT INTO agent_messages (id, project_id, role, body, activity, created_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`,
          )
          .run(row.id, row.projectId, row.role, row.body, JSON.stringify(row.activity ?? []), row.createdAt, row.deletedAt ?? null);
      }

      for (const row of pull.concepts) {
        this.database
          .prepare(
            `INSERT INTO concepts (project_id, concept_id, parent_id, title, mastery_level, confidence, note, summary, docs, tags, content, why, example, common_mistake, language, first_seen_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?, ?)
             ON CONFLICT(project_id, concept_id) DO UPDATE SET
               parent_id = excluded.parent_id, title = excluded.title, mastery_level = excluded.mastery_level,
               confidence = excluded.confidence, note = excluded.note, summary = excluded.summary,
               docs = excluded.docs, tags = excluded.tags, content = excluded.content, updated_at = excluded.updated_at
             WHERE concepts.updated_at < excluded.updated_at`,
          )
          .run(
            row.projectId,
            row.conceptId,
            row.parentId,
            row.title,
            row.masteryLevel,
            row.confidence,
            row.note,
            row.summary,
            JSON.stringify(row.docs),
            JSON.stringify(row.tags),
            row.content,
            row.firstSeenAt,
            row.updatedAt,
          );
      }

      for (const row of pull.tasks) {
        this.database
          .prepare(
            `INSERT INTO tasks (project_id, task_id, title, brief, criteria, concepts, files, status, outcome, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, task_id) DO UPDATE SET
               title = excluded.title, brief = excluded.brief, criteria = excluded.criteria,
               concepts = excluded.concepts, files = excluded.files, status = excluded.status,
               outcome = excluded.outcome, updated_at = excluded.updated_at
             WHERE tasks.updated_at < excluded.updated_at`,
          )
          .run(
            row.projectId,
            row.taskId,
            row.title,
            row.brief,
            JSON.stringify(row.criteria),
            JSON.stringify(row.concepts),
            JSON.stringify(row.files),
            row.status,
            row.outcome,
            row.createdAt,
            row.updatedAt,
          );
      }

      for (const row of pull.pathNodes) {
        this.database
          .prepare(
            `INSERT INTO path_nodes (project_id, node_id, title, summary, status, sort_order, kind, concepts, exit_criteria, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, node_id) DO UPDATE SET
               title = excluded.title, summary = excluded.summary, status = excluded.status,
               sort_order = excluded.sort_order, kind = excluded.kind, concepts = excluded.concepts,
               exit_criteria = excluded.exit_criteria, updated_at = excluded.updated_at
             WHERE path_nodes.updated_at < excluded.updated_at`,
          )
          .run(
            row.projectId,
            row.nodeId,
            row.title,
            row.summary,
            row.status,
            row.sortOrder,
            row.kind,
            JSON.stringify(row.concepts),
            JSON.stringify(row.exitCriteria),
            row.createdAt,
            row.updatedAt,
          );
      }
    });
  }

  /* ---- Undo points -------------------------------------------------------- */

  /**
   * Records the project's state before a turn, keyed to the message that starts
   * it.
   *
   * One statement, one transaction: a manifest with blobs missing is a snapshot
   * that cannot be restored, and restoring a half-written one would delete the
   * files it failed to record. The blobs go in first for the same reason.
   */
  saveSnapshot(input: {
    projectId: string;
    messageId: string;
    files: SnapshotFile[];
    blobs: Map<string, Buffer>;
    concepts: ConceptRecord[];
    tasks: TaskRecord[];
    pathNodes: PathNode[];
    currentPathNode: string | null;
  }): void {
    const blob = this.database.prepare("INSERT OR IGNORE INTO snapshot_blobs (hash, content) VALUES (?, ?)");
    const manifest = this.database.prepare(
      `INSERT INTO snapshots (project_id, message_id, files, concepts, tasks, path_nodes, current_path_node, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, message_id) DO NOTHING`,
    );

    this.atomically(() => {
      for (const [hash, content] of input.blobs) blob.run(hash, content);
      manifest.run(
        input.projectId,
        input.messageId,
        JSON.stringify(input.files),
        JSON.stringify(input.concepts),
        JSON.stringify(input.tasks),
        JSON.stringify(input.pathNodes),
        input.currentPathNode,
        new Date().toISOString(),
      );
    });
  }

  snapshot(projectId: string, messageId: string): Snapshot | null {
    const row = this.database
      .prepare("SELECT * FROM snapshots WHERE project_id = ? AND message_id = ?")
      .get(projectId, messageId) as Record<string, string | null> | undefined;
    if (!row) return null;

    return {
      messageId,
      files: parseJson<SnapshotFile[]>(String(row.files ?? "[]"), []),
      concepts: parseJson<ConceptRecord[]>(String(row.concepts ?? "[]"), []),
      tasks: parseJson<TaskRecord[]>(String(row.tasks ?? "[]"), []),
      pathNodes: parseJson<PathNode[]>(String(row.path_nodes ?? "[]"), []),
      currentPathNode: row.current_path_node ?? null,
      createdAt: String(row.created_at),
    };
  }

  /** Which messages have an undo point, so the transcript can offer the edit
   *  only where it can actually be honoured. */
  snapshotMessageIds(projectId: string): string[] {
    return (this.database.prepare("SELECT message_id FROM snapshots WHERE project_id = ?").all(projectId) as Array<{ message_id: string }>)
      .map((row) => row.message_id);
  }

  readBlob(hash: string): Buffer | null {
    /* `node:sqlite` hands a BLOB back as a Uint8Array, not a Buffer. Both write
       the same bytes, so restoring worked either way — but every other reader
       gets a value whose `toString()` is a list of numbers, which is the sort of
       thing that is only ever noticed once it has corrupted something. */
    const row = this.database.prepare("SELECT content FROM snapshot_blobs WHERE hash = ?").get(hash) as
      | { content: Uint8Array }
      | undefined;
    return row ? Buffer.from(row.content) : null;
  }

  /**
   * Puts everything the database owns back to a snapshot, and drops the turns
   * after it.
   *
   * One transaction, because a conversation rewound without its concepts — or
   * the other way round — is a project that disagrees with itself. The files are
   * restored by the caller either side of this; they are the one part that
   * cannot join the transaction.
   */
  rewindTo(projectId: string, snapshot: Snapshot): void {
    this.atomically(() => {
      /* Everything from the edited message onward, the message itself included:
         it is about to be re-sent in its corrected form. */
      this.database
        .prepare(
          `DELETE FROM agent_messages
            WHERE project_id = ?
              AND created_at >= (SELECT created_at FROM agent_messages WHERE id = ?)`,
        )
        .run(projectId, snapshot.messageId);

      this.database.prepare("DELETE FROM snapshots WHERE project_id = ? AND created_at >= ?").run(projectId, snapshot.createdAt);

      this.database.prepare("DELETE FROM concepts WHERE project_id = ?").run(projectId);
      this.database.prepare("DELETE FROM concept_events WHERE project_id = ?").run(projectId);
      for (const concept of snapshot.concepts) {
        this.database
          .prepare(
            `INSERT INTO concepts (project_id, concept_id, parent_id, title, mastery_level, confidence, note, summary, docs, tags, content, why, example, common_mistake, language, first_seen_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?, ?)`,
          )
          .run(
            projectId,
            concept.conceptId,
            concept.parentId,
            concept.title,
            concept.masteryLevel,
            concept.confidence,
            concept.note,
            concept.summary,
            JSON.stringify(concept.docs),
            JSON.stringify(concept.tags),
            concept.content,
            concept.firstSeenAt,
            concept.updatedAt,
          );
      }

      this.database.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
      for (const task of snapshot.tasks) {
        this.database
          .prepare(
            `INSERT INTO tasks (project_id, task_id, title, brief, criteria, concepts, files, status, outcome, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            projectId,
            task.taskId,
            task.title,
            task.brief,
            JSON.stringify(task.criteria),
            JSON.stringify(task.concepts),
            JSON.stringify(task.files),
            task.status,
            task.outcome,
            task.createdAt,
            task.updatedAt,
          );
      }

      this.database.prepare("DELETE FROM path_nodes WHERE project_id = ?").run(projectId);
      for (const node of snapshot.pathNodes) {
        this.database
          .prepare(
            `INSERT INTO path_nodes (project_id, node_id, title, summary, status, sort_order, kind, concepts, exit_criteria, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            projectId,
            node.id,
            node.title,
            node.summary,
            node.status,
            node.order,
            node.kind,
            JSON.stringify(node.concepts),
            JSON.stringify(node.exitCriteria),
            node.createdAt,
            node.updatedAt,
          );
      }

      this.database.prepare("UPDATE projects SET current_path_node = ? WHERE id = ?").run(snapshot.currentPathNode, projectId);
    });
  }

  /**
   * Runs a group of writes as one.
   *
   * `node:sqlite` has no `transaction()` helper, and these two are exactly the
   * places that need one: a manifest without its blobs cannot be restored, and
   * a conversation rewound without its concepts is a project that disagrees
   * with itself. Rolling back on the way out is what makes a failure leave
   * nothing behind rather than half of it.
   */
  private atomically(work: () => void): void {
    this.database.exec("BEGIN");
    try {
      work();
      this.database.exec("COMMIT");
    } catch (cause) {
      this.database.exec("ROLLBACK");
      throw cause;
    }
  }

  appendMessage(projectId: string, message: AgentMessage): void {
    /* Upsert, not insert.
     *
     * A turn in flight writes itself to this table repeatedly under one id, so
     * that quitting mid-turn keeps what the agent had already said instead of
     * throwing the whole reply away. The row is the same row each time; only
     * the body and the trail of what it did grow. */
    this.database
      .prepare(
        `INSERT INTO agent_messages (id, project_id, role, body, activity, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, activity = excluded.activity`,
      )
      .run(message.id, projectId, message.role, message.body, JSON.stringify(message.activity), message.createdAt);
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** A row written by an older build, or corrupted, still has a readable message
 *  body — losing the activity trail is far better than losing the turn. */
function parseActivity(value: string): AgentMessage["activity"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? collapseLegacyDuplicates(collapseReasoning(parsed as AgentMessage["activity"])) : [];
  } catch {
    return [];
  }
}

/** The old Pi stream adapter delivered each completed tool call through two
 * executable protocol paths. Both copies were written next to one another with
 * identical payloads. Collapse that exact legacy shape on read; repeated calls
 * with different arguments or results remain distinct. */
function collapseLegacyDuplicates(steps: AgentMessage["activity"]): AgentMessage["activity"] {
  const repaired: AgentMessage["activity"] = [];
  for (const step of steps) {
    const tail = repaired[repaired.length - 1];
    if (step.kind === "tool" && tail?.kind === "tool" && JSON.stringify(step) === JSON.stringify(tail)) continue;
    repaired.push({ ...step });
  }
  return repaired;
}

/**
 * Joins consecutive reasoning steps back into one thought.
 *
 * Turns recorded while the writer stored one step per streamed token are on
 * disk with a thought split across hundreds of them, and the transcript renders
 * every step as its own "Thought for 1s" row — a wall of stubs with the tool
 * calls lost somewhere inside it. The writer no longer does that; this repairs
 * what it already wrote, so existing conversations read correctly rather than
 * staying broken for the life of the project.
 */
function collapseReasoning(steps: AgentMessage["activity"]): AgentMessage["activity"] {
  const collapsed: AgentMessage["activity"] = [];
  for (const step of steps) {
    const tail = collapsed[collapsed.length - 1];
    if (step.kind === "reasoning" && tail?.kind === "reasoning") {
      tail.text += step.text;
      /* The larger of the two, not the sum: the writer already stores the
         running total on the step it is extending. Turns recorded before it did
         carry zero on every fragment and stay at zero — that duration was never
         measured, and inventing one would be worse than showing none. */
      tail.seconds = Math.max(tail.seconds, step.seconds);
    }
    else collapsed.push({ ...step });
  }
  return collapsed;
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

export const CONCEPT_FIELDS = ["title", "summary", "content", "note", "docs", "tags", "parent"] as const;

/**
 * Which written parts of a concept a call actually rewrote.
 *
 * Only the parts it *sent*: `record-concept` is allowed to carry the level
 * alone, and the upsert deliberately keeps whatever prose is already there when
 * a field arrives empty. So an empty field is "leave it" rather than "clear it",
 * and counting it as a change would report every level bump as a rewrite of the
 * whole note.
 *
 * A field sent with exactly what is already stored is not a change either. The
 * agent re-sends the title on nearly every call, and a history that said "title"
 * against all of them would be a history of the calling convention.
 */
function conceptChanges(
  existing: Record<string, string | number | null> | undefined,
  input: { parentId?: string | null; title: string; note: string; summary: string; content: string; docs: Array<{ title: string; url: string }>; tags: string[] },
): ConceptField[] {
  /* A concept that did not exist has no diff to show. "Introduced" already says
     that everything about it is new. */
  if (!existing) return [];

  const changes: ConceptField[] = [];
  const moved = (field: ConceptField, sent: string, before: unknown) => {
    if (sent && sent !== String(before ?? "")) changes.push(field);
  };

  moved("title", input.title.trim(), existing.title);
  moved("summary", input.summary.trim(), existing.summary);
  moved("content", input.content.trim(), existing.content);
  moved("note", input.note.trim(), existing.note);
  if (input.docs.length > 0 && JSON.stringify(input.docs) !== String(existing.docs ?? "[]")) changes.push("docs");
  if (input.tags.length > 0 && JSON.stringify(input.tags) !== String(existing.tags ?? "[]")) changes.push("tags");
  /* Absent means "leave it where it is", so only an explicit parentId counts —
     including an explicit null, which is a move back to the top. */
  if (input.parentId !== undefined && (input.parentId || null) !== (existing.parent_id || null)) changes.push("parent");

  return changes;
}

/** One concept row, as a record. Shared by the per-project read and the atlas so
 *  a column added to the table is read in one place. */
function conceptFromRow(row: Record<string, string | number>): ConceptRecord {
  return {
    conceptId: String(row.concept_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    title: String(row.title),
    masteryLevel: Math.min(5, Math.max(0, Number(row.mastery_level))) as ConceptRecord["masteryLevel"],
    confidence: String(row.confidence),
    note: String(row.note ?? ""),
    summary: String(row.summary ?? ""),
    content: String(row.content ?? ""),
    docs: parseJson<Array<{ title: string; url: string }>>(String(row.docs ?? "[]"), []),
    tags: parseJson<string[]>(String(row.tags ?? "[]"), []),
    firstSeenAt: String(row.first_seen_at),
    updatedAt: String(row.updated_at),
  };
}
