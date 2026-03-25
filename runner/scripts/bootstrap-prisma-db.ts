import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const runnerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(runnerRoot, "..");

loadEnv(projectRoot);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to bootstrap the Prisma backend schema.");
}

const sql = neon(databaseUrl);

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'local-user'
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT ''
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT ''
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS learning_style TEXT
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS current_step_id TEXT
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS current_step_title TEXT
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS current_step_index INTEGER
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 0
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS completed_step_ids TEXT NOT NULL DEFAULT '[]'
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS last_attempt_status TEXT
`;

await sql`
  ALTER TABLE construct_blueprints
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprints_user_active_idx
  ON construct_blueprints (user_id, is_active)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprints_user_updated_idx
  ON construct_blueprints (user_id, updated_at DESC)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprints_user_opened_idx
  ON construct_blueprints (user_id, last_opened_at DESC)
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_blueprint_builds (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    goal TEXT NOT NULL,
    learning_style TEXT,
    detected_language TEXT,
    detected_domain TEXT,
    status TEXT NOT NULL,
    current_stage TEXT,
    current_stage_title TEXT,
    current_stage_status TEXT,
    last_error TEXT,
    langsmith_project TEXT,
    trace_url TEXT,
    planning_session_json TEXT,
    answers_json TEXT NOT NULL DEFAULT '[]',
    plan_json TEXT,
    blueprint_json TEXT,
    blueprint_draft_json TEXT,
    support_files_json TEXT NOT NULL DEFAULT '[]',
    canonical_files_json TEXT NOT NULL DEFAULT '[]',
    learner_files_json TEXT NOT NULL DEFAULT '[]',
    hidden_tests_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    last_event_at TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_blueprint_build_stages (
    id TEXT PRIMARY KEY,
    build_id TEXT NOT NULL REFERENCES construct_blueprint_builds(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    input_json TEXT,
    output_json TEXT,
    metadata_json TEXT,
    trace_url TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (build_id, stage)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_blueprint_build_events (
    id TEXT PRIMARY KEY,
    build_id TEXT NOT NULL REFERENCES construct_blueprint_builds(id) ON DELETE CASCADE,
    job_id TEXT,
    kind TEXT,
    stage TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    level TEXT NOT NULL,
    payload_json TEXT,
    trace_url TEXT,
    timestamp TIMESTAMPTZ NOT NULL
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprint_builds_user_updated_idx
  ON construct_blueprint_builds (user_id, updated_at DESC)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprint_builds_user_status_idx
  ON construct_blueprint_builds (user_id, status)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprint_builds_user_last_event_idx
  ON construct_blueprint_builds (user_id, last_event_at DESC)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprint_build_stages_build_updated_idx
  ON construct_blueprint_build_stages (build_id, updated_at DESC)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_blueprint_build_events_build_timestamp_idx
  ON construct_blueprint_build_events (build_id, timestamp DESC)
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_password_credentials (
    user_id TEXT PRIMARY KEY REFERENCES construct_users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES construct_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_auth_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES construct_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT,
    token_expires_at TIMESTAMPTZ,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_user_id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS construct_provider_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES construct_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    status TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    has_secret BOOLEAN NOT NULL DEFAULT FALSE,
    secret_encrypted TEXT,
    refresh_token_encrypted TEXT,
    last4 TEXT,
    base_url TEXT,
    external_account_id TEXT,
    external_email TEXT,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT,
    expires_at TIMESTAMPTZ,
    last_validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider, auth_type)
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_auth_sessions_user_revoked_idx
  ON construct_auth_sessions (user_id, revoked_at)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_auth_sessions_user_expires_idx
  ON construct_auth_sessions (user_id, expires_at DESC)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_auth_identities_user_provider_idx
  ON construct_auth_identities (user_id, provider)
`;

await sql`
  CREATE INDEX IF NOT EXISTS construct_provider_connections_user_provider_idx
  ON construct_provider_connections (user_id, provider)
`;

console.log("Construct Prisma backend schema bootstrapped.");

function loadEnv(rootDirectory: string): void {
  if (typeof process.loadEnvFile !== "function") {
    return;
  }

  for (const fileName of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(path.join(rootDirectory, fileName));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
}
