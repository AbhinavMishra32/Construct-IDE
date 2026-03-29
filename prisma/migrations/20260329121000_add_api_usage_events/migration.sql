CREATE TABLE IF NOT EXISTS "construct_api_usage_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'llm',
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "stage" TEXT,
  "schema_name" TEXT,
  "mode" TEXT,
  "project_id" TEXT,
  "project_name" TEXT,
  "project_goal" TEXT,
  "build_id" TEXT,
  "session_id" TEXT,
  "job_id" TEXT,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "cost_usd" DOUBLE PRECISION,
  "currency" TEXT,
  "metadata_json" TEXT,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "construct_api_usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "construct_api_usage_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "construct_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "construct_api_usage_events_user_recorded_idx"
  ON "construct_api_usage_events"("user_id", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "construct_api_usage_events_user_provider_recorded_idx"
  ON "construct_api_usage_events"("user_id", "provider", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "construct_api_usage_events_user_project_recorded_idx"
  ON "construct_api_usage_events"("user_id", "project_id", "recorded_at" DESC);

CREATE INDEX IF NOT EXISTS "construct_api_usage_events_user_build_recorded_idx"
  ON "construct_api_usage_events"("user_id", "build_id", "recorded_at" DESC);
