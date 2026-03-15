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
