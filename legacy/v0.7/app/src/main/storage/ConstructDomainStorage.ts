import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as NodeDatabaseSync, SQLInputValue } from "node:sqlite";

import type { ConstructFlowPathNode, ConstructFlowSession } from "../../shared/constructFlow";
import {
  createDefaultLearningState,
  knowledgeKey,
  type AssistanceEventRecord,
  type ConceptEngagement,
  type ConceptUnderstanding,
  type ConstructConceptArtifactAudit,
  type ConstructConceptProjectEvent,
  type ConstructInteractSession,
  type ConstructLearningState,
  type GeneratedLiveStep,
  type KnowledgeBaseRecord,
  type ProjectLearningState,
  type RecallAttemptRecord
} from "../../shared/constructLearning";
import {
  isFlowProject,
  type ProjectLearnedConceptSummary,
  type ProjectSummary,
  type StoredFlowProject,
  type StoredProject,
  type StoredTapeProject
} from "../projects/ConstructProjectTypes";

const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");

type Json = string | null;

type ProjectRow = {
  id: string;
  kind: "flow" | "tape";
  title: string;
  description: string;
  progress: number;
  last_opened_at: string | null;
  workspace_path: string;
  active_file_path: string | null;
  file_tree_expanded_json: Json;
  completed_at: string | null;
  source_path: string | null;
  source: string | null;
  original_source: string | null;
  authoring_fixes_json: Json;
  program_json: Json;
  current_step_index: number | null;
  current_block_index: number | null;
  typing_progress_json: Json;
  edit_anchors_json: Json;
  assistance_json: Json;
  verification_results_json: Json;
  completed_blocks_json: Json;
  flow_goal: string | null;
  flow_stack_preference: string | null;
  flow_autonomy_preference: string | null;
  flow_permissions_preference: string | null;
  flow_project_settings_json: Json;
  flow_memory_directory: string | null;
  flow_thread_id: string | null;
  flow_research_enabled: number | null;
  flow_research_completed_at: string | null;
  flow_current_path_node_id: string | null;
  flow_path_created_at: string | null;
  flow_path_updated_at: string | null;
  flow_created_at: string | null;
  flow_updated_at: string | null;
};

type FlowSessionRow = {
  id: string;
  project_id: string;
  thread_id: string;
  origin: string | null;
  question_response_json: Json;
  status: ConstructFlowSession["status"];
  citations_json: Json;
  context_compaction_json: Json;
  context_window_json: Json;
  created_at: string;
  updated_at: string;
  duration_ms: number | null;
  step_count: number | null;
  finish_reason: string | null;
  error_message: string | null;
};

type FlowMessageRow = {
  id: string;
  original_id: string | null;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  position: number;
};

type FlowToolCallRow = {
  id: string;
  original_id: string | null;
  session_id: string;
  name: string;
  title: string;
  reason: string;
  input_json: Json;
  output_preview: string | null;
  response_json: Json;
  status: "running" | "completed" | "error";
  created_at: string;
  completed_at: string | null;
  position: number;
};

type FlowTimelineRow = {
  id: string;
  original_id: string | null;
  session_id: string;
  kind: string;
  status: "running" | "completed" | "error";
  title: string | null;
  detail: string | null;
  text: string | null;
  tool_call_id: string | null;
  name: string | null;
  reason: string | null;
  input_json: Json;
  output_preview: string | null;
  summary: string | null;
  before_tokens: number | null;
  after_tokens: number | null;
  summarized_message_count: number | null;
  preserved_message_count: number | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  position: number;
};

type PayloadRow = {
  id: string;
  payload_json: string;
  position?: number;
};

type LearningMetaRow = {
  key: string;
  value: string;
};

type KnowledgeConceptRow = {
  project_id: string;
  concept_id: string;
  title: string;
  kind: string;
  language: string | null;
  technology: string | null;
  saved_at: string | null;
  updated_at: string | null;
  payload_json: string;
};

export type ReadProjectsOptions = {
  includeFlowSessions?: boolean;
};

export class ConstructDomainStorage {
  private db: NodeDatabaseSync | null = null;

  constructor(private readonly databasePath: string) {}

  async initialize(): Promise<void> {
    if (this.db) return;
    await mkdir(path.dirname(this.databasePath), { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA cache_size = -20000;

      CREATE TABLE IF NOT EXISTS construct_projects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('tape', 'flow')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        workspace_path TEXT NOT NULL,
        active_file_path TEXT,
        file_tree_expanded_json TEXT NOT NULL DEFAULT '[]',
        completed_at TEXT,
        source_path TEXT,
        source TEXT,
        original_source TEXT,
        authoring_fixes_json TEXT,
        program_json TEXT,
        current_step_index INTEGER,
        current_block_index INTEGER,
        typing_progress_json TEXT,
        edit_anchors_json TEXT,
        assistance_json TEXT,
        verification_results_json TEXT,
        completed_blocks_json TEXT,
        flow_goal TEXT,
        flow_stack_preference TEXT,
        flow_autonomy_preference TEXT,
        flow_permissions_preference TEXT,
        flow_project_settings_json TEXT,
        flow_memory_directory TEXT,
        flow_thread_id TEXT,
        flow_research_enabled INTEGER,
        flow_research_completed_at TEXT,
        flow_current_path_node_id TEXT,
        flow_path_created_at TEXT,
        flow_path_updated_at TEXT,
        flow_created_at TEXT,
        flow_updated_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_construct_projects_kind ON construct_projects(kind, last_opened_at);

      CREATE TABLE IF NOT EXISTS construct_flow_path_nodes (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL REFERENCES construct_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        node_order INTEGER NOT NULL,
        kind TEXT,
        learner_level TEXT,
        concepts_json TEXT,
        task_ids_json TEXT,
        entry_criteria_json TEXT,
        exit_criteria_json TEXT,
        research_notes_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_path_nodes_project ON construct_flow_path_nodes(project_id, node_order);

      CREATE TABLE IF NOT EXISTS construct_flow_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES construct_projects(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        origin TEXT,
        question_response_json TEXT,
        status TEXT NOT NULL,
        citations_json TEXT,
        context_compaction_json TEXT,
        context_window_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        duration_ms INTEGER,
        step_count INTEGER,
        finish_reason TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_sessions_project_time ON construct_flow_sessions(project_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_construct_flow_sessions_status ON construct_flow_sessions(project_id, status, updated_at);

      CREATE TABLE IF NOT EXISTS construct_flow_messages (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_messages_session ON construct_flow_messages(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_flow_tool_calls (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        input_json TEXT,
        output_preview TEXT,
        response_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_tool_calls_session ON construct_flow_tool_calls(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_flow_timeline_parts (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        detail TEXT,
        text TEXT,
        tool_call_id TEXT,
        name TEXT,
        reason TEXT,
        input_json TEXT,
        output_preview TEXT,
        summary TEXT,
        before_tokens INTEGER,
        after_tokens INTEGER,
        summarized_message_count INTEGER,
        preserved_message_count INTEGER,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_timeline_session ON construct_flow_timeline_parts(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_flow_agent_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_agent_events_session ON construct_flow_agent_events(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_flow_actions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_actions_session ON construct_flow_actions(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_flow_practice_tasks (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        path_node_id TEXT,
        language TEXT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        submitted_at TEXT,
        payload_json TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_practice_tasks_session ON construct_flow_practice_tasks(session_id, position);
      CREATE INDEX IF NOT EXISTS idx_construct_flow_practice_tasks_status ON construct_flow_practice_tasks(project_id, status, created_at);

      CREATE TABLE IF NOT EXISTS construct_flow_concept_exercises (
        id TEXT PRIMARY KEY,
        original_id TEXT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES construct_flow_sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_flow_concept_exercises_session ON construct_flow_concept_exercises(session_id, position);

      CREATE TABLE IF NOT EXISTS construct_learning_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS construct_learning_global_concepts (
        concept_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS construct_learning_assistance_events (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_learning_assistance_project ON construct_learning_assistance_events(project_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_learning_projects (
        project_id TEXT PRIMARY KEY,
        current_step_index INTEGER,
        current_block_index INTEGER,
        current_block_id TEXT
      );
      CREATE TABLE IF NOT EXISTS construct_project_concept_understanding (
        project_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(project_id, concept_id)
      );
      CREATE TABLE IF NOT EXISTS construct_project_concept_relations (
        project_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        project_title TEXT,
        introduced_at TEXT,
        first_referenced_at TEXT,
        last_referenced_at TEXT,
        mastery_level INTEGER,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(project_id, concept_id)
      );
      CREATE TABLE IF NOT EXISTS construct_project_concept_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_project_concept_events_project ON construct_project_concept_events(project_id, concept_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_project_artifact_audits (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_project_artifact_audits_project ON construct_project_artifact_audits(project_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_knowledge_concepts (
        project_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        language TEXT,
        technology TEXT,
        saved_at TEXT,
        updated_at TEXT,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(project_id, concept_id)
      );
      CREATE INDEX IF NOT EXISTS idx_construct_knowledge_concepts_project ON construct_knowledge_concepts(project_id, title);
      CREATE TABLE IF NOT EXISTS construct_project_concept_engagement (
        project_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        first_opened_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        open_count INTEGER NOT NULL,
        PRIMARY KEY(project_id, concept_id)
      );
      CREATE TABLE IF NOT EXISTS construct_project_interact_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_project_interact_sessions_project ON construct_project_interact_sessions(project_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_project_recall_attempts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_project_recall_attempts_project ON construct_project_recall_attempts(project_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_project_planned_overlays (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS construct_project_generated_live_steps (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_construct_project_generated_live_steps_project ON construct_project_generated_live_steps(project_id, created_at);
      CREATE TABLE IF NOT EXISTS construct_project_generated_live_step_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    ensureColumn(db, "construct_flow_path_nodes", "original_id", "TEXT");
    ensureColumn(db, "construct_flow_messages", "original_id", "TEXT");
    ensureColumn(db, "construct_flow_tool_calls", "original_id", "TEXT");
    ensureColumn(db, "construct_flow_timeline_parts", "original_id", "TEXT");
    ensureColumn(db, "construct_flow_practice_tasks", "original_id", "TEXT");
    ensureColumn(db, "construct_flow_concept_exercises", "original_id", "TEXT");
    this.db = db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  hasProjects(): boolean {
    const row = this.dbOrThrow().prepare("SELECT 1 AS found FROM construct_projects LIMIT 1").get() as { found?: number } | undefined;
    return row?.found === 1;
  }

  readProjects(options: ReadProjectsOptions = {}): StoredProject[] {
    const db = this.dbOrThrow();
    const rows = db.prepare("SELECT * FROM construct_projects ORDER BY COALESCE(last_opened_at, flow_updated_at, updated_at) DESC, id").all() as ProjectRow[];
    return rows.map((row) => this.rowToProject(row, options.includeFlowSessions !== false));
  }

  readProject(projectId: string, options: ReadProjectsOptions = {}): StoredProject | null {
    const row = this.dbOrThrow().prepare("SELECT * FROM construct_projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    return row ? this.rowToProject(row, options.includeFlowSessions !== false) : null;
  }

  readProjectSummaries(): ProjectSummary[] {
    const db = this.dbOrThrow();
    const rows = db.prepare(`
      SELECT
        p.*,
        COUNT(s.id) AS flow_session_count,
        MAX(s.updated_at) AS flow_last_session_at
      FROM construct_projects p
      LEFT JOIN construct_flow_sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY COALESCE(p.last_opened_at, p.flow_updated_at, p.updated_at) DESC, p.id
    `).all() as Array<ProjectRow & { flow_session_count: number; flow_last_session_at: string | null }>;
    const learnedConcepts = this.readProjectLearnedConceptSummaries();
    return rows.map((row) => this.rowToSummary(row, learnedConcepts.get(row.id) ?? []));
  }

  writeProjects(projects: StoredProject[]): void {
    const db = this.dbOrThrow();
    const keep = new Set(projects.map((project) => project.id));
    this.transaction(() => {
      for (const project of projects) {
        this.writeProject(project, { includeFlowSessions: true, includeProjectRecord: true, pruneStaleFlowSessions: true }, false);
      }
      const existing = db.prepare("SELECT id FROM construct_projects").all() as Array<{ id: string }>;
      const remove = db.prepare("DELETE FROM construct_projects WHERE id = ?");
      for (const row of existing) {
        if (!keep.has(row.id)) remove.run(row.id);
      }
    });
  }

  writeProject(project: StoredProject, options: {
    changedFlowSessionId?: string;
    includeFlowSessions?: boolean;
    includeProjectRecord?: boolean;
    pruneStaleFlowSessions?: boolean;
  } = {}, wrap = true): void {
    const run = () => {
      if (options.includeProjectRecord !== false) {
        this.upsertProject(project);
        if (isFlowProject(project)) {
          this.replacePathNodes(project.id, project.flow.pathNodes ?? []);
        }
      } else if (!this.readProject(project.id, { includeFlowSessions: false })) {
        this.upsertProject(project);
      }

      if (isFlowProject(project)) {
        const sessions = options.includeFlowSessions === false && options.changedFlowSessionId
          ? project.flow.sessions.filter((session) => session.id === options.changedFlowSessionId)
          : options.includeFlowSessions === false
            ? []
            : project.flow.sessions;
        for (const session of sessions) {
          this.upsertFlowSession(project.id, session);
        }
        if (options.pruneStaleFlowSessions !== false && options.includeFlowSessions !== false) {
          this.pruneFlowSessions(project.id, new Set(project.flow.sessions.map((session) => session.id)));
        }
      } else {
        this.pruneFlowSessions(project.id, new Set());
      }
    };

    if (wrap) {
      this.transaction(run);
    } else {
      run();
    }
  }

  readLearningState(): ConstructLearningState | null {
    const metaRows = this.dbOrThrow().prepare("SELECT key, value FROM construct_learning_meta").all() as LearningMetaRow[];
    if (metaRows.length === 0) return null;
    const meta = new Map(metaRows.map((row) => [row.key, row.value]));
    const state = createDefaultLearningState(meta.get("deviceId") ?? "domain-storage");
    state.learner.id = meta.get("learnerId") ?? state.learner.id;
    state.learner.preferences = parseJson(meta.get("preferences"), state.learner.preferences);
    state.sync = parseJson(meta.get("sync"), state.sync);

    for (const row of this.rows<{ concept_id: string; payload_json: string }>("SELECT concept_id, payload_json FROM construct_learning_global_concepts")) {
      state.learner.globalConceptUnderstanding[row.concept_id] = parseJson(row.payload_json, {} as ConceptUnderstanding);
    }
    const assistanceRows = this.rows<{ project_id: string | null; payload_json: string }>(
      "SELECT project_id, payload_json FROM construct_learning_assistance_events ORDER BY created_at, id"
    );
    state.learner.assistanceEvents = assistanceRows.map((row) => parseJson(row.payload_json, {} as AssistanceEventRecord));

    for (const row of this.rows<{ project_id: string; current_step_index: number | null; current_block_index: number | null; current_block_id: string | null }>("SELECT * FROM construct_learning_projects")) {
      state.projects[row.project_id] = createProjectLearningState(row.project_id);
      if (row.current_step_index != null && row.current_block_index != null) {
        state.projects[row.project_id].currentPosition = {
          stepIndex: row.current_step_index,
          blockIndex: row.current_block_index,
          blockId: row.current_block_id ?? undefined
        };
      }
    }

    for (const row of this.rows<{ project_id: string; concept_id: string; payload_json: string }>("SELECT * FROM construct_project_concept_understanding")) {
      const project = ensureLearningProject(state, row.project_id);
      project.conceptUnderstanding[row.concept_id] = parseJson(row.payload_json, {} as ConceptUnderstanding);
    }
    for (const row of this.rows<{ project_id: string; concept_id: string; payload_json: string }>("SELECT * FROM construct_project_concept_relations")) {
      const project = ensureLearningProject(state, row.project_id);
      project.conceptRelations ??= {};
      project.conceptRelations[row.concept_id] = parseJson(row.payload_json, {} as NonNullable<ProjectLearningState["conceptRelations"]>[string]);
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_concept_events ORDER BY created_at, id")) {
      const project = ensureLearningProject(state, row.project_id);
      project.conceptEvents ??= [];
      project.conceptEvents.push(parseJson(row.payload_json, {} as ConstructConceptProjectEvent));
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_artifact_audits ORDER BY created_at, id")) {
      const project = ensureLearningProject(state, row.project_id);
      project.artifactAudits ??= [];
      project.artifactAudits.push(parseJson(row.payload_json, {} as ConstructConceptArtifactAudit));
    }
    for (const row of this.rows<KnowledgeConceptRow>("SELECT * FROM construct_knowledge_concepts")) {
      const record = parseJson(row.payload_json, {} as KnowledgeBaseRecord);
      state.knowledgeBase.concepts[knowledgeKey(row.project_id, row.concept_id)] = record;
    }
    for (const row of this.rows<{ project_id: string; concept_id: string; first_opened_at: string; last_opened_at: string; open_count: number }>("SELECT * FROM construct_project_concept_engagement")) {
      const project = ensureLearningProject(state, row.project_id);
      project.conceptEngagement[row.concept_id] = {
        conceptId: row.concept_id,
        firstOpenedAt: row.first_opened_at,
        lastOpenedAt: row.last_opened_at,
        openCount: row.open_count
      };
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_interact_sessions ORDER BY created_at, id")) {
      ensureLearningProject(state, row.project_id).constructInteractSessions.push(parseJson(row.payload_json, {} as ConstructInteractSession));
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_recall_attempts ORDER BY created_at, id")) {
      ensureLearningProject(state, row.project_id).recallAttempts.push(parseJson(row.payload_json, {} as RecallAttemptRecord));
    }
    for (const row of assistanceRows) {
      if (row.project_id) {
        ensureLearningProject(state, row.project_id).assistanceEvents.push(parseJson(row.payload_json, {} as AssistanceEventRecord));
      }
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_planned_overlays")) {
      ensureLearningProject(state, row.project_id).plannedOverlays.push(parseJson(row.payload_json, {} as ProjectLearningState["plannedOverlays"][number]));
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_generated_live_steps ORDER BY created_at, id")) {
      ensureLearningProject(state, row.project_id).generatedLiveSteps.push(parseJson(row.payload_json, {} as GeneratedLiveStep));
    }
    for (const row of this.rows<{ project_id: string; payload_json: string }>("SELECT project_id, payload_json FROM construct_project_generated_live_step_runs ORDER BY created_at, id")) {
      ensureLearningProject(state, row.project_id).generatedLiveStepRuns.push(parseJson(row.payload_json, {} as ProjectLearningState["generatedLiveStepRuns"][number]));
    }
    return state;
  }

  writeLearningState(state: ConstructLearningState): void {
    this.transaction(() => {
      this.dbOrThrow().exec(`
        DELETE FROM construct_learning_meta;
        DELETE FROM construct_learning_global_concepts;
        DELETE FROM construct_learning_assistance_events;
        DELETE FROM construct_learning_projects;
        DELETE FROM construct_project_concept_understanding;
        DELETE FROM construct_project_concept_relations;
        DELETE FROM construct_project_concept_events;
        DELETE FROM construct_project_artifact_audits;
        DELETE FROM construct_knowledge_concepts;
        DELETE FROM construct_project_concept_engagement;
        DELETE FROM construct_project_interact_sessions;
        DELETE FROM construct_project_recall_attempts;
        DELETE FROM construct_project_planned_overlays;
        DELETE FROM construct_project_generated_live_steps;
        DELETE FROM construct_project_generated_live_step_runs;
      `);
      const meta = this.dbOrThrow().prepare("INSERT INTO construct_learning_meta(key, value) VALUES (?, ?)");
      meta.run("version", String(state.version));
      meta.run("learnerId", state.learner.id);
      meta.run("deviceId", state.sync.deviceId);
      meta.run("preferences", toJson(state.learner.preferences));
      meta.run("sync", toJson(state.sync));

      const globalConcept = this.dbOrThrow().prepare("INSERT INTO construct_learning_global_concepts(concept_id, payload_json) VALUES (?, ?)");
      for (const [conceptId, concept] of Object.entries(state.learner.globalConceptUnderstanding)) {
        globalConcept.run(conceptId, toJson(concept));
      }

      const projectInsert = this.dbOrThrow().prepare(`
        INSERT INTO construct_learning_projects(project_id, current_step_index, current_block_index, current_block_id)
        VALUES (?, ?, ?, ?)
      `);
      for (const [projectId, project] of Object.entries(state.projects)) {
        projectInsert.run(
          projectId,
          project.currentPosition?.stepIndex ?? null,
          project.currentPosition?.blockIndex ?? null,
          project.currentPosition?.blockId ?? null
        );
        this.insertProjectLearningRows(projectId, project);
      }
      this.insertLearningAssistanceEvents(state);

      const knowledge = this.dbOrThrow().prepare(`
        INSERT INTO construct_knowledge_concepts(project_id, concept_id, title, kind, language, technology, saved_at, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const record of Object.values(state.knowledgeBase.concepts)) {
        knowledge.run(
          record.sourceProjectId,
          record.id,
          record.title,
          record.kind,
          record.language ?? null,
          record.technology ?? null,
          record.savedAt ?? null,
          record.lastModifiedAt ?? record.masteryUpdatedAt ?? record.savedAt ?? null,
          toJson(record)
        );
      }
    });
  }

  removeLegacyProjectRows(): void {
    const db = this.dbOrThrow();
    db.prepare("DELETE FROM storage_items WHERE scope = 'application' AND key IN ('construct.projects', 'construct.projects.index')").run();
    db.prepare("DELETE FROM storage_items WHERE scope = 'application' AND (key LIKE 'construct.project.%' OR key LIKE 'construct.flow.sessions.%' OR key LIKE 'construct.flow.session.%')").run();
  }

  removeLegacyLearningRow(): void {
    this.dbOrThrow().prepare("DELETE FROM storage_items WHERE scope = 'application' AND key = 'construct.learningState'").run();
  }

  private upsertProject(project: StoredProject): void {
    const row = projectToRow(project);
    this.dbOrThrow().prepare(`
      INSERT INTO construct_projects(
        id, kind, title, description, progress, last_opened_at, workspace_path, active_file_path,
        file_tree_expanded_json, completed_at, source_path, source, original_source, authoring_fixes_json,
        program_json, current_step_index, current_block_index, typing_progress_json, edit_anchors_json,
        assistance_json, verification_results_json, completed_blocks_json, flow_goal, flow_stack_preference,
        flow_autonomy_preference, flow_permissions_preference, flow_project_settings_json, flow_memory_directory,
        flow_thread_id, flow_research_enabled, flow_research_completed_at, flow_current_path_node_id,
        flow_path_created_at, flow_path_updated_at, flow_created_at, flow_updated_at, updated_at
      ) VALUES (
        @id, @kind, @title, @description, @progress, @last_opened_at, @workspace_path, @active_file_path,
        @file_tree_expanded_json, @completed_at, @source_path, @source, @original_source, @authoring_fixes_json,
        @program_json, @current_step_index, @current_block_index, @typing_progress_json, @edit_anchors_json,
        @assistance_json, @verification_results_json, @completed_blocks_json, @flow_goal, @flow_stack_preference,
        @flow_autonomy_preference, @flow_permissions_preference, @flow_project_settings_json, @flow_memory_directory,
        @flow_thread_id, @flow_research_enabled, @flow_research_completed_at, @flow_current_path_node_id,
        @flow_path_created_at, @flow_path_updated_at, @flow_created_at, @flow_updated_at, CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        description = excluded.description,
        progress = excluded.progress,
        last_opened_at = excluded.last_opened_at,
        workspace_path = excluded.workspace_path,
        active_file_path = excluded.active_file_path,
        file_tree_expanded_json = excluded.file_tree_expanded_json,
        completed_at = excluded.completed_at,
        source_path = excluded.source_path,
        source = excluded.source,
        original_source = excluded.original_source,
        authoring_fixes_json = excluded.authoring_fixes_json,
        program_json = excluded.program_json,
        current_step_index = excluded.current_step_index,
        current_block_index = excluded.current_block_index,
        typing_progress_json = excluded.typing_progress_json,
        edit_anchors_json = excluded.edit_anchors_json,
        assistance_json = excluded.assistance_json,
        verification_results_json = excluded.verification_results_json,
        completed_blocks_json = excluded.completed_blocks_json,
        flow_goal = excluded.flow_goal,
        flow_stack_preference = excluded.flow_stack_preference,
        flow_autonomy_preference = excluded.flow_autonomy_preference,
        flow_permissions_preference = excluded.flow_permissions_preference,
        flow_project_settings_json = excluded.flow_project_settings_json,
        flow_memory_directory = excluded.flow_memory_directory,
        flow_thread_id = excluded.flow_thread_id,
        flow_research_enabled = excluded.flow_research_enabled,
        flow_research_completed_at = excluded.flow_research_completed_at,
        flow_current_path_node_id = excluded.flow_current_path_node_id,
        flow_path_created_at = excluded.flow_path_created_at,
        flow_path_updated_at = excluded.flow_path_updated_at,
        flow_created_at = excluded.flow_created_at,
        flow_updated_at = excluded.flow_updated_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(sqlRow(row));
  }

  private replacePathNodes(projectId: string, nodes: ConstructFlowPathNode[]): void {
    const db = this.dbOrThrow();
    db.prepare("DELETE FROM construct_flow_path_nodes WHERE project_id = ?").run(projectId);
    const insert = db.prepare(`
      INSERT INTO construct_flow_path_nodes(
        id, original_id, project_id, title, summary, status, node_order, kind, learner_level, concepts_json, task_ids_json,
        entry_criteria_json, exit_criteria_json, research_notes_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    nodes.forEach((node, index) => insert.run(
      projectScopedRowId(node.id, projectId, index),
      node.id,
      projectId,
      node.title,
      node.summary,
      node.status,
      node.order,
      node.kind ?? null,
      node.learnerLevel ?? null,
      nullableJson(node.concepts),
      nullableJson(node.taskIds),
      nullableJson(node.entryCriteria),
      nullableJson(node.exitCriteria),
      nullableJson(node.researchNotes),
      node.createdAt,
      node.updatedAt,
      node.completedAt ?? null
    ));
  }

  private upsertFlowSession(projectId: string, session: ConstructFlowSession): void {
    const db = this.dbOrThrow();
    db.prepare(`
      INSERT INTO construct_flow_sessions(
        id, project_id, thread_id, origin, question_response_json, status, citations_json, context_compaction_json,
        context_window_json, created_at, updated_at, duration_ms, step_count, finish_reason, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        thread_id = excluded.thread_id,
        origin = excluded.origin,
        question_response_json = excluded.question_response_json,
        status = excluded.status,
        citations_json = excluded.citations_json,
        context_compaction_json = excluded.context_compaction_json,
        context_window_json = excluded.context_window_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        duration_ms = excluded.duration_ms,
        step_count = excluded.step_count,
        finish_reason = excluded.finish_reason,
        error_message = excluded.error_message
    `).run(
      session.id,
      projectId,
      session.threadId,
      session.origin ?? null,
      nullableJson(session.questionResponse),
      session.status,
      nullableJson(session.citations),
      nullableJson(session.contextCompaction),
      nullableJson(session.contextWindow),
      session.createdAt,
      session.updatedAt,
      session.durationMs ?? null,
      session.stepCount ?? null,
      session.finishReason ?? null,
      session.errorMessage ?? null
    );

    deleteSessionChildren(db, session.id);
    insertPositioned(db, "construct_flow_messages", session.messages, (message, index) => [
      sessionScopedRowId(message.id, session.id, index), message.id, projectId, session.id, message.role, message.content, message.createdAt, index
    ]);
    insertPositioned(db, "construct_flow_tool_calls", session.toolCalls, (toolCall, index) => [
      sessionScopedRowId(toolCall.id, session.id, index), toolCall.id, projectId, session.id, toolCall.name, toolCall.title, toolCall.reason,
      nullableJson(toolCall.input), toolCall.outputPreview ?? null, nullableJson(toolCall.response),
      toolCall.status, toolCall.createdAt, toolCall.completedAt ?? null, index
    ]);
    insertPositioned(db, "construct_flow_timeline_parts", session.timeline ?? [], (part, index) => timelineValues(part, projectId, session.id, index));
    insertPayloadRows(db, "construct_flow_agent_events", projectId, session.id, session.agentEvents ?? []);
    insertPayloadRows(db, "construct_flow_actions", projectId, session.id, session.actions ?? []);
    insertPositioned(db, "construct_flow_practice_tasks", session.practiceTasks ?? [], (task, index) => [
      sessionScopedRowId(task.id, session.id, index), task.id, projectId, session.id, task.pathNodeId ?? null, task.language ?? null, task.title, task.prompt,
      task.status, task.createdAt, task.submittedAt ?? null, toJson(task), index
    ]);
    insertPositioned(db, "construct_flow_concept_exercises", session.conceptExercises ?? [], (exercise, index) => [
      sessionScopedRowId(exercise.id, session.id, index), exercise.id, projectId, session.id, exercise.title, exercise.status, exercise.createdAt, toJson(exercise), index
    ]);
  }

  private pruneFlowSessions(projectId: string, keepSessionIds: Set<string>): void {
    const db = this.dbOrThrow();
    const sessions = db.prepare("SELECT id FROM construct_flow_sessions WHERE project_id = ?").all(projectId) as Array<{ id: string }>;
    const remove = db.prepare("DELETE FROM construct_flow_sessions WHERE id = ?");
    for (const session of sessions) {
      if (!keepSessionIds.has(session.id)) remove.run(session.id);
    }
  }

  private rowToProject(row: ProjectRow, includeFlowSessions: boolean): StoredProject {
    if (row.kind === "flow") {
      const project: StoredFlowProject = {
        kind: "flow",
        id: row.id,
        title: row.title,
        description: row.description,
        progress: row.progress,
        lastOpenedAt: row.last_opened_at,
        workspacePath: row.workspace_path,
        sourcePath: row.source_path,
        activeFilePath: row.active_file_path,
        fileTreeExpanded: parseJson(row.file_tree_expanded_json, [] as string[]),
        completedAt: row.completed_at,
        flow: {
          goal: row.flow_goal ?? row.description,
          stackPreference: row.flow_stack_preference ?? undefined,
          autonomyPreference: readFlowAutonomy(row.flow_autonomy_preference),
          permissionsPreference: readFlowPermissions(row.flow_permissions_preference),
          projectSettings: parseJson(row.flow_project_settings_json, undefined),
          memoryDirectory: ".construct",
          threadId: row.flow_thread_id ?? row.id,
          researchEnabled: row.flow_research_enabled === 1,
          researchCompletedAt: row.flow_research_completed_at,
          pathNodes: this.readPathNodes(row.id),
          currentPathNodeId: row.flow_current_path_node_id,
          pathCreatedAt: row.flow_path_created_at,
          pathUpdatedAt: row.flow_path_updated_at,
          sessions: includeFlowSessions ? this.readFlowSessions(row.id) : [],
          createdAt: row.flow_created_at ?? row.last_opened_at ?? new Date(0).toISOString(),
          updatedAt: row.flow_updated_at ?? row.last_opened_at ?? new Date(0).toISOString()
        }
      };
      return project;
    }

    return {
      kind: "tape",
      id: row.id,
      title: row.title,
      description: row.description,
      progress: row.progress,
      lastOpenedAt: row.last_opened_at,
      workspacePath: row.workspace_path,
      sourcePath: row.source_path,
      activeFilePath: row.active_file_path,
      fileTreeExpanded: parseJson(row.file_tree_expanded_json, [] as string[]),
      completedAt: row.completed_at,
      source: row.source ?? "",
      originalSource: row.original_source ?? undefined,
      authoringFixes: parseJson(row.authoring_fixes_json, []),
      program: parseJson(row.program_json, { id: row.id, title: row.title, description: row.description, files: [], references: [], targets: [], steps: [] }),
      currentStepIndex: row.current_step_index ?? 0,
      currentBlockIndex: row.current_block_index ?? 0,
      typingProgress: parseJson(row.typing_progress_json, {}),
      editAnchors: parseJson(row.edit_anchors_json, {}),
      assistance: parseJson(row.assistance_json, {}),
      verificationResults: parseJson(row.verification_results_json, {}),
      completedBlocks: parseJson(row.completed_blocks_json, {})
    };
  }

  private rowToSummary(
    row: ProjectRow & { flow_session_count?: number; flow_last_session_at?: string | null },
    learnedConcepts: ProjectLearnedConceptSummary[] = []
  ): ProjectSummary {
    if (row.kind === "flow") {
      return {
        kind: "flow",
        id: row.id,
        title: row.title,
        description: row.description,
        progress: row.progress,
        lastOpenedAt: row.last_opened_at,
        createdAt: row.flow_created_at,
        workspacePath: row.workspace_path,
        sourcePath: row.source_path,
        currentStepIndex: undefined,
        currentBlockIndex: undefined,
        currentStepTitle: null,
        currentBlockKind: null,
        currentBlockLabel: row.flow_goal,
        activeFilePath: row.active_file_path,
        stepCount: undefined,
        blockCount: undefined,
        completedBlockCount: undefined,
        fileCount: undefined,
        conceptCount: learnedConcepts.length,
        referenceCount: undefined,
        verificationPassCount: 0,
        verificationFailCount: 0,
        authoringFixCount: 0,
        completedAt: row.completed_at,
        learnedConcepts,
        flowGoal: row.flow_goal ?? undefined,
        flowMemoryFileCount: 4,
        flowSessionCount: Number(row.flow_session_count ?? 0),
        flowLastActivityAt: row.flow_last_session_at ?? row.flow_updated_at
      };
    }
    const program = parseJson<StoredTapeProject["program"]>(row.program_json, {
      id: row.id,
      title: row.title,
      description: row.description,
      files: [],
      concepts: [],
      references: [],
      targets: [],
      steps: []
    });
    const currentStep = program.steps?.[row.current_step_index ?? 0] ?? null;
    const currentBlock = currentStep?.blocks?.[row.current_block_index ?? 0] ?? null;
    const verificationResults = Object.values(parseJson(row.verification_results_json, {}) as Record<string, { passed: boolean }>);
    const completedBlocks = parseJson(row.completed_blocks_json, {}) as Record<string, boolean>;
    const blockCount = (program.steps ?? []).reduce((total: number, step: { blocks?: unknown[] }) => total + (step.blocks?.length ?? 0), 0);
    const conceptSummaries = learnedConcepts.length > 0 ? learnedConcepts : collectTapeConceptSummaries(program.concepts ?? []);
    return {
      kind: "tape",
      id: row.id,
      title: row.title,
      description: row.description,
      progress: row.progress,
      lastOpenedAt: row.last_opened_at,
      workspacePath: row.workspace_path,
      sourcePath: row.source_path,
      currentStepIndex: row.current_step_index ?? 0,
      currentBlockIndex: row.current_block_index ?? 0,
      currentStepTitle: currentStep?.title ?? null,
      currentBlockKind: currentBlock?.kind ?? null,
      currentBlockLabel: currentBlock?.path ?? currentBlock?.title ?? currentBlock?.task ?? currentBlock?.content?.slice?.(0, 80) ?? null,
      activeFilePath: row.active_file_path,
      stepCount: program.steps?.length ?? 0,
      blockCount,
      completedBlockCount: Object.values(completedBlocks).filter(Boolean).length,
      fileCount: program.files?.length ?? 0,
      conceptCount: conceptSummaries.length,
      referenceCount: program.references?.length ?? 0,
      verificationPassCount: verificationResults.filter((result) => result.passed).length,
      verificationFailCount: verificationResults.filter((result) => !result.passed).length,
      authoringFixCount: parseJson(row.authoring_fixes_json, [] as unknown[]).length,
      completedAt: row.completed_at,
      learnedConcepts: conceptSummaries
    };
  }

  private readProjectLearnedConceptSummaries(): Map<string, ProjectLearnedConceptSummary[]> {
    const latestByConceptId = new Map<string, KnowledgeBaseRecord>();
    for (const row of this.rows<KnowledgeConceptRow>("SELECT * FROM construct_knowledge_concepts")) {
      const record = parseJson(row.payload_json, {} as KnowledgeBaseRecord);
      if (!record.id) continue;
      const current = latestByConceptId.get(record.id);
      if (!current || conceptTimestamp(record) >= conceptTimestamp(current)) {
        latestByConceptId.set(record.id, record);
      }
    }

    const summariesByProject = new Map<string, ProjectLearnedConceptSummary[]>();
    const rows = this.rows<{
      project_id: string;
      concept_id: string;
      last_referenced_at: string | null;
      payload_json: string;
    }>("SELECT project_id, concept_id, last_referenced_at, payload_json FROM construct_project_concept_relations ORDER BY project_id, concept_id");

    for (const row of rows) {
      const concept = latestByConceptId.get(row.concept_id);
      if (!concept) continue;

      const relation = parseJson(row.payload_json, {} as NonNullable<ProjectLearningState["conceptRelations"]>[string]);
      const summary: ProjectLearnedConceptSummary = {
        id: concept.id,
        title: concept.title,
        kind: concept.kind,
        summary: concept.summary,
        language: concept.language,
        technology: concept.technology,
        masteryLevel: relation.masteryLevel ?? concept.masteryLevel,
        masteryText: concept.masteryText,
        lastReferencedAt: relation.lastReferencedAt ?? row.last_referenced_at ?? undefined,
        savedAt: concept.savedAt,
        lastModifiedAt: concept.lastModifiedAt
      };

      const projectSummaries = summariesByProject.get(row.project_id) ?? [];
      projectSummaries.push(summary);
      summariesByProject.set(row.project_id, projectSummaries);
    }

    for (const summaries of summariesByProject.values()) {
      summaries.sort((left, right) => {
        const leftTime = Date.parse(left.lastReferencedAt ?? left.lastModifiedAt ?? left.savedAt ?? "");
        const rightTime = Date.parse(right.lastReferencedAt ?? right.lastModifiedAt ?? right.savedAt ?? "");
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return left.title.localeCompare(right.title);
      });
    }

    return summariesByProject;
  }

  private readPathNodes(projectId: string): ConstructFlowPathNode[] {
    return this.rows<any>("SELECT * FROM construct_flow_path_nodes WHERE project_id = ? ORDER BY node_order, id", projectId)
      .map((row) => ({
        id: row.original_id ?? row.id,
        title: row.title,
        summary: row.summary,
        status: row.status,
        order: row.node_order,
        kind: row.kind ?? undefined,
        learnerLevel: row.learner_level ?? undefined,
        concepts: parseJson(row.concepts_json, undefined),
        taskIds: parseJson(row.task_ids_json, undefined),
        entryCriteria: parseJson(row.entry_criteria_json, undefined),
        exitCriteria: parseJson(row.exit_criteria_json, undefined),
        researchNotes: parseJson(row.research_notes_json, undefined),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at ?? undefined
      }));
  }

  private readFlowSessions(projectId: string): ConstructFlowSession[] {
    const rows = this.rows<FlowSessionRow>(
      "SELECT * FROM construct_flow_sessions WHERE project_id = ? ORDER BY created_at, id",
      projectId
    );
    return rows.map((row) => this.rowToFlowSession(row));
  }

  private rowToFlowSession(row: FlowSessionRow): ConstructFlowSession {
    return {
      id: row.id,
      projectId: row.project_id,
      threadId: row.thread_id,
      origin: readSessionOrigin(row.origin),
      questionResponse: parseJson(row.question_response_json, undefined),
      messages: this.rows<FlowMessageRow>("SELECT * FROM construct_flow_messages WHERE session_id = ? ORDER BY position, created_at, id", row.id)
        .map((message) => ({
          id: message.original_id ?? message.id,
          role: message.role,
          content: message.content,
          createdAt: message.created_at
        })),
      status: row.status,
      toolCalls: this.rows<FlowToolCallRow>("SELECT * FROM construct_flow_tool_calls WHERE session_id = ? ORDER BY position, created_at, id", row.id)
        .map((toolCall) => ({
          id: toolCall.original_id ?? toolCall.id,
          name: toolCall.name,
          title: toolCall.title,
          reason: toolCall.reason,
          input: parseJson(toolCall.input_json, undefined),
          outputPreview: toolCall.output_preview ?? undefined,
          response: parseJson(toolCall.response_json, undefined),
          status: toolCall.status,
          createdAt: toolCall.created_at,
          completedAt: toolCall.completed_at ?? undefined
        })),
      agentEvents: this.payloadRows("construct_flow_agent_events", row.id),
      timeline: this.rows<FlowTimelineRow>("SELECT * FROM construct_flow_timeline_parts WHERE session_id = ? ORDER BY position, created_at, id", row.id)
        .map(timelineRowToPart),
      citations: parseJson(row.citations_json, undefined),
      contextCompaction: parseJson(row.context_compaction_json, undefined),
      contextWindow: parseJson(row.context_window_json, undefined),
      actions: this.payloadRows("construct_flow_actions", row.id),
      practiceTasks: this.payloadRows("construct_flow_practice_tasks", row.id),
      conceptExercises: this.payloadRows("construct_flow_concept_exercises", row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      durationMs: row.duration_ms ?? undefined,
      stepCount: row.step_count ?? undefined,
      finishReason: row.finish_reason ?? undefined,
      errorMessage: row.error_message ?? undefined
    };
  }

  private payloadRows<T>(table: string, sessionId: string): T[] {
    return this.rows<PayloadRow>(`SELECT payload_json FROM ${table} WHERE session_id = ? ORDER BY position, id`, sessionId)
      .map((row) => parseJson(row.payload_json, {} as T));
  }

  private insertLearningAssistanceEvents(state: ConstructLearningState): void {
    const insert = this.dbOrThrow().prepare(`
      INSERT INTO construct_learning_assistance_events(id, project_id, kind, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const events = new Map<string, { projectId: string | null; event: AssistanceEventRecord }>();
    const collect = (fallbackProjectId: string | null, event: AssistanceEventRecord) => {
      const projectId = event.projectId ?? fallbackProjectId;
      events.set(event.id, {
        projectId,
        event: projectId ? { ...event, projectId } : event
      });
    };
    for (const event of state.learner.assistanceEvents) {
      collect(null, event);
    }
    for (const [projectId, project] of Object.entries(state.projects)) {
      for (const event of project.assistanceEvents) {
        collect(projectId, event);
      }
    }
    for (const { projectId, event } of events.values()) {
      insert.run(event.id, projectId, event.kind, event.createdAt, toJson(event));
    }
  }

  private insertProjectLearningRows(projectId: string, project: ProjectLearningState): void {
    const conceptUnderstanding = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_concept_understanding(project_id, concept_id, payload_json) VALUES (?, ?, ?)
    `);
    for (const [conceptId, concept] of Object.entries(project.conceptUnderstanding)) {
      conceptUnderstanding.run(projectId, conceptId, toJson(concept));
    }

    const conceptRelation = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_concept_relations(project_id, concept_id, project_title, introduced_at, first_referenced_at, last_referenced_at, mastery_level, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [conceptId, relation] of Object.entries(project.conceptRelations ?? {})) {
      conceptRelation.run(
        projectId,
        conceptId,
        relation.projectTitle ?? null,
        relation.introducedAt ?? null,
        relation.firstReferencedAt ?? null,
        relation.lastReferencedAt ?? null,
        relation.masteryLevel ?? null,
        toJson(relation)
      );
    }

    const conceptEvent = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_concept_events(id, project_id, concept_id, kind, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const event of project.conceptEvents ?? []) {
      conceptEvent.run(event.id, event.projectId, event.conceptId, event.kind, event.createdAt, toJson(event));
    }

    const audit = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_artifact_audits(id, project_id, created_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of project.artifactAudits ?? []) {
      audit.run(item.id, item.projectId, item.createdAt, toJson(item));
    }

    const engagement = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_concept_engagement(project_id, concept_id, first_opened_at, last_opened_at, open_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of Object.values(project.conceptEngagement)) {
      engagement.run(projectId, item.conceptId, item.firstOpenedAt, item.lastOpenedAt, item.openCount);
    }

    const interactSession = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_interact_sessions(id, project_id, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const session of project.constructInteractSessions) {
      interactSession.run(session.id, projectId, session.createdAt, session.updatedAt ?? null, toJson(session));
    }

    const recallAttempt = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_recall_attempts(id, project_id, created_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const attempt of project.recallAttempts) {
      recallAttempt.run(attempt.id, projectId, attempt.createdAt, toJson(attempt));
    }

    const plannedOverlay = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_planned_overlays(id, project_id, payload_json)
      VALUES (?, ?, ?)
    `);
    for (const overlay of project.plannedOverlays) {
      plannedOverlay.run(overlay.id, projectId, toJson(overlay));
    }

    const generatedStep = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_generated_live_steps(id, project_id, status, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const step of project.generatedLiveSteps) {
      generatedStep.run(step.id, projectId, step.status, step.createdAt, step.updatedAt, toJson(step));
    }

    const generatedRun = this.dbOrThrow().prepare(`
      INSERT INTO construct_project_generated_live_step_runs(id, project_id, created_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const run of project.generatedLiveStepRuns) {
      generatedRun.run(run.id, projectId, run.createdAt, toJson(run));
    }
  }

  private rows<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.dbOrThrow().prepare(sql).all(...params) as T[];
  }

  private transaction(fn: () => void): void {
    const db = this.dbOrThrow();
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    }
  }

  private dbOrThrow(): NodeDatabaseSync {
    if (!this.db) {
      throw new Error("Construct domain storage has not been initialized.");
    }
    return this.db;
  }
}

export function createConstructDomainStorage(databasePath: string): ConstructDomainStorage {
  return new ConstructDomainStorage(databasePath);
}

export function readLegacyJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function ensureColumn(db: NodeDatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function projectToRow(project: StoredProject): ProjectRow {
  if (isFlowProject(project)) {
    return {
      ...baseProjectRow(project, "flow"),
      source_path: project.sourcePath,
      source: null,
      original_source: null,
      authoring_fixes_json: null,
      program_json: null,
      current_step_index: null,
      current_block_index: null,
      typing_progress_json: null,
      edit_anchors_json: null,
      assistance_json: null,
      verification_results_json: null,
      completed_blocks_json: null,
      flow_goal: project.flow.goal,
      flow_stack_preference: project.flow.stackPreference ?? null,
      flow_autonomy_preference: project.flow.autonomyPreference ?? null,
      flow_permissions_preference: project.flow.permissionsPreference ?? null,
      flow_project_settings_json: nullableJson(project.flow.projectSettings),
      flow_memory_directory: ".construct",
      flow_thread_id: project.flow.threadId,
      flow_research_enabled: project.flow.researchEnabled ? 1 : 0,
      flow_research_completed_at: project.flow.researchCompletedAt ?? null,
      flow_current_path_node_id: project.flow.currentPathNodeId ?? null,
      flow_path_created_at: project.flow.pathCreatedAt ?? null,
      flow_path_updated_at: project.flow.pathUpdatedAt ?? null,
      flow_created_at: project.flow.createdAt,
      flow_updated_at: project.flow.updatedAt
    };
  }

  return {
    ...baseProjectRow(project, "tape"),
    source_path: project.sourcePath,
    source: project.source,
    original_source: project.originalSource ?? null,
    authoring_fixes_json: nullableJson(project.authoringFixes ?? []),
    program_json: toJson(project.program),
    current_step_index: project.currentStepIndex,
    current_block_index: project.currentBlockIndex,
    typing_progress_json: toJson(project.typingProgress ?? {}),
    edit_anchors_json: toJson(project.editAnchors ?? {}),
    assistance_json: toJson(project.assistance ?? {}),
    verification_results_json: toJson(project.verificationResults ?? {}),
    completed_blocks_json: toJson(project.completedBlocks ?? {}),
    flow_goal: null,
    flow_stack_preference: null,
    flow_autonomy_preference: null,
    flow_permissions_preference: null,
    flow_project_settings_json: null,
    flow_memory_directory: null,
    flow_thread_id: null,
    flow_research_enabled: null,
    flow_research_completed_at: null,
    flow_current_path_node_id: null,
    flow_path_created_at: null,
    flow_path_updated_at: null,
    flow_created_at: null,
    flow_updated_at: null
  };
}

function sqlRow(row: ProjectRow): Record<string, SQLInputValue> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value ?? null])
  ) as Record<string, SQLInputValue>;
}

function baseProjectRow(project: StoredProject, kind: "flow" | "tape"): Pick<ProjectRow,
  "id" | "kind" | "title" | "description" | "progress" | "last_opened_at" | "workspace_path" |
  "active_file_path" | "file_tree_expanded_json" | "completed_at"
> {
  return {
    id: project.id,
    kind,
    title: project.title,
    description: project.description,
    progress: project.progress,
    last_opened_at: project.lastOpenedAt,
    workspace_path: project.workspacePath,
    active_file_path: project.activeFilePath,
    file_tree_expanded_json: toJson(project.fileTreeExpanded ?? []),
    completed_at: project.completedAt
  };
}

function deleteSessionChildren(db: NodeDatabaseSync, sessionId: string): void {
  for (const table of [
    "construct_flow_messages",
    "construct_flow_tool_calls",
    "construct_flow_timeline_parts",
    "construct_flow_agent_events",
    "construct_flow_actions",
    "construct_flow_practice_tasks",
    "construct_flow_concept_exercises"
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}

function insertPositioned<T>(
  db: NodeDatabaseSync,
  table: string,
  values: T[],
  toValues: (value: T, index: number) => SQLInputValue[]
): void {
  if (!values.length) return;
  const placeholders = {
    construct_flow_messages: "(id, original_id, project_id, session_id, role, content, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    construct_flow_tool_calls: "(id, original_id, project_id, session_id, name, title, reason, input_json, output_preview, response_json, status, created_at, completed_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    construct_flow_timeline_parts: "(id, original_id, project_id, session_id, kind, status, title, detail, text, tool_call_id, name, reason, input_json, output_preview, summary, before_tokens, after_tokens, summarized_message_count, preserved_message_count, created_at, completed_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    construct_flow_practice_tasks: "(id, original_id, project_id, session_id, path_node_id, language, title, prompt, status, created_at, submitted_at, payload_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    construct_flow_concept_exercises: "(id, original_id, project_id, session_id, title, status, created_at, payload_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  }[table];
  if (!placeholders) {
    throw new Error(`Unknown positioned domain table: ${table}`);
  }
  const statement = db.prepare(`INSERT INTO ${table} ${placeholders}`);
  values.forEach((value, index) => statement.run(...toValues(value, index)));
}

function insertPayloadRows<T>(db: NodeDatabaseSync, table: string, projectId: string, sessionId: string, values: T[]): void {
  if (!values.length) return;
  const statement = db.prepare(`INSERT INTO ${table}(id, project_id, session_id, payload_json, position) VALUES (?, ?, ?, ?, ?)`);
  values.forEach((value, index) => statement.run(payloadStorageId(value, sessionId, table, index), projectId, sessionId, toJson(value), index));
}

function payloadStorageId(value: unknown, sessionId: string, table: string, index: number): string {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return `${sessionId}:${index}:${value.id}`;
  }
  return `${sessionId}:${table}:${index}`;
}

function sessionScopedRowId(originalId: string, sessionId: string, index: number): string {
  return `${sessionId}:${index}:${originalId}`;
}

function projectScopedRowId(originalId: string, projectId: string, index: number): string {
  return `${projectId}:${index}:${originalId}`;
}

function timelineValues(part: ConstructFlowSession["timeline"][number], projectId: string, sessionId: string, index: number): SQLInputValue[] {
  const storageId = sessionScopedRowId(part.id, sessionId, index);
  if (part.kind === "tool") {
    return [
      storageId, part.id, projectId, sessionId, part.kind, part.status, part.title, null, null, part.toolCallId,
      part.name, part.reason ?? null, nullableJson(part.input), part.outputPreview ?? null, null, null, null,
      null, null, part.createdAt, part.completedAt ?? null, part.updatedAt ?? null, index
    ];
  }
  if (part.kind === "message") {
    return [
      storageId, part.id, projectId, sessionId, part.kind, part.status, null, null, part.text, null, null, null,
      null, null, null, null, null, null, null, part.createdAt, null, part.updatedAt ?? null, index
    ];
  }
  if (part.kind === "compaction") {
    return [
      storageId, part.id, projectId, sessionId, part.kind, part.status, part.title, part.detail ?? null, null, null, null,
      null, null, null, part.summary ?? null, part.beforeTokens ?? null, part.afterTokens ?? null,
      part.summarizedMessageCount ?? null, part.preservedMessageCount ?? null, part.createdAt,
      part.completedAt ?? null, part.updatedAt ?? null, index
    ];
  }
  return [
    storageId, part.id, projectId, sessionId, part.kind, part.status, part.title, part.detail ?? null, part.text ?? null,
    null, null, null, null, null, null, null, null, null, null, part.createdAt, null, part.updatedAt ?? null, index
  ];
}

function timelineRowToPart(row: FlowTimelineRow): ConstructFlowSession["timeline"][number] {
  const id = row.original_id ?? row.id;
  if (row.kind === "tool") {
    return {
      id,
      kind: "tool",
      toolCallId: row.tool_call_id ?? id,
      name: row.name ?? "tool",
      title: row.title ?? row.name ?? "Tool",
      reason: row.reason ?? undefined,
      status: row.status,
      input: parseJson(row.input_json, undefined),
      outputPreview: row.output_preview ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }
  if (row.kind === "message") {
    return {
      id,
      kind: "message",
      status: row.status,
      text: row.text ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined
    };
  }
  if (row.kind === "compaction") {
    return {
      id,
      kind: "compaction",
      status: row.status,
      title: row.title ?? "Context compaction",
      detail: row.detail ?? undefined,
      summary: row.summary ?? undefined,
      beforeTokens: row.before_tokens ?? undefined,
      afterTokens: row.after_tokens ?? undefined,
      summarizedMessageCount: row.summarized_message_count ?? undefined,
      preservedMessageCount: row.preserved_message_count ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }
  return {
    id,
    kind: "reasoning",
    status: row.status,
    title: row.title ?? "Reasoning",
    detail: row.detail ?? undefined,
    text: row.text ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined
  };
}

function createProjectLearningState(projectId: string): ProjectLearningState {
  return {
    projectId,
    conceptUnderstanding: {},
    conceptRelations: {},
    conceptEvents: [],
    artifactAudits: [],
    constructInteractSessions: [],
    recallAttempts: [],
    assistanceEvents: [],
    conceptEngagement: {},
    plannedOverlays: [],
    generatedLiveSteps: [],
    generatedLiveStepRuns: []
  };
}

function ensureLearningProject(state: ConstructLearningState, projectId: string): ProjectLearningState {
  state.projects[projectId] ??= createProjectLearningState(projectId);
  return state.projects[projectId];
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function collectTapeConceptSummaries(values: unknown[]): ProjectLearnedConceptSummary[] {
  return values
    .map(toProjectLearnedConceptSummary)
    .filter((concept): concept is ProjectLearnedConceptSummary => Boolean(concept))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function toProjectLearnedConceptSummary(value: unknown): ProjectLearnedConceptSummary | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : id ? titleFromConceptId(id) : null;
  if (!id || !title) return null;

  return {
    id,
    title,
    kind: typeof record.kind === "string" && record.kind.trim() ? record.kind.trim() : "concept",
    summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : undefined,
    language: typeof record.language === "string" ? (record.language as ProjectLearnedConceptSummary["language"]) : undefined,
    technology: typeof record.technology === "string" && record.technology.trim() ? record.technology.trim() : undefined,
    masteryLevel: typeof record.masteryLevel === "number" ? (record.masteryLevel as ProjectLearnedConceptSummary["masteryLevel"]) : undefined,
    masteryText: typeof record.masteryText === "string" && record.masteryText.trim() ? record.masteryText.trim() : undefined,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : undefined,
    lastModifiedAt: typeof record.lastModifiedAt === "string" ? record.lastModifiedAt : undefined
  };
}

function conceptTimestamp(record: KnowledgeBaseRecord): number {
  const timestamp = Date.parse(record.lastModifiedAt ?? record.savedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function titleFromConceptId(id: string): string {
  return id
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function nullableJson(value: unknown): string | null {
  return value == null ? null : toJson(value);
}

function readFlowAutonomy(value: string | null): StoredFlowProject["flow"]["autonomyPreference"] {
  return value === "guided" || value === "agentic" || value === "balanced" ? value : "balanced";
}

function readFlowPermissions(value: string | null): StoredFlowProject["flow"]["permissionsPreference"] {
  return value === "workspace" || value === "agentic" || value === "ask" ? value : "ask";
}

function readSessionOrigin(value: string | null): ConstructFlowSession["origin"] {
  return value === "system" || value === "question-response" || value === "task-submission" || value === "user"
    ? value
    : undefined;
}
