-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "construct_state" (
    "key" TEXT NOT NULL,
    "value_json" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "construct_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "construct_blueprints" (
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local-user',
    "goal" TEXT NOT NULL,
    "blueprint_id" TEXT NOT NULL,
    "blueprint_path" TEXT NOT NULL,
    "project_root" TEXT NOT NULL,
    "blueprint_json" TEXT NOT NULL,
    "plan_json" TEXT NOT NULL,
    "bundle_json" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "learning_style" TEXT,
    "current_step_id" TEXT,
    "current_step_title" TEXT,
    "current_step_index" INTEGER,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "completed_step_ids" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "last_attempt_status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_opened_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "construct_blueprints_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "construct_blueprint_builds" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT NOT NULL DEFAULT 'local-user',
    "goal" TEXT NOT NULL,
    "learning_style" TEXT,
    "detected_language" TEXT,
    "detected_domain" TEXT,
    "status" TEXT NOT NULL,
    "current_stage" TEXT,
    "current_stage_title" TEXT,
    "current_stage_status" TEXT,
    "last_error" TEXT,
    "langsmith_project" TEXT,
    "trace_url" TEXT,
    "planning_session_json" TEXT,
    "answers_json" TEXT NOT NULL DEFAULT '[]',
    "plan_json" TEXT,
    "blueprint_json" TEXT,
    "blueprint_draft_json" TEXT,
    "support_files_json" TEXT NOT NULL DEFAULT '[]',
    "canonical_files_json" TEXT NOT NULL DEFAULT '[]',
    "learner_files_json" TEXT NOT NULL DEFAULT '[]',
    "hidden_tests_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),

    CONSTRAINT "construct_blueprint_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construct_blueprint_build_stages" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "input_json" TEXT,
    "output_json" TEXT,
    "metadata_json" TEXT,
    "trace_url" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "construct_blueprint_build_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construct_blueprint_build_events" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "job_id" TEXT,
    "kind" TEXT,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "level" TEXT NOT NULL,
    "payload_json" TEXT,
    "trace_url" TEXT,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "construct_blueprint_build_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "construct_blueprints_blueprint_path_key" ON "construct_blueprints"("blueprint_path");

-- CreateIndex
CREATE INDEX "construct_blueprints_user_id_is_active_idx" ON "construct_blueprints"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "construct_blueprints_user_id_updated_at_idx" ON "construct_blueprints"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "construct_blueprints_user_id_last_opened_at_idx" ON "construct_blueprints"("user_id", "last_opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "construct_blueprint_builds_session_id_key" ON "construct_blueprint_builds"("session_id");

-- CreateIndex
CREATE INDEX "construct_blueprint_builds_user_id_updated_at_idx" ON "construct_blueprint_builds"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "construct_blueprint_builds_user_id_status_idx" ON "construct_blueprint_builds"("user_id", "status");

-- CreateIndex
CREATE INDEX "construct_blueprint_builds_user_id_last_event_at_idx" ON "construct_blueprint_builds"("user_id", "last_event_at");

-- CreateIndex
CREATE INDEX "construct_blueprint_build_stages_build_id_updated_at_idx" ON "construct_blueprint_build_stages"("build_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "construct_blueprint_build_stages_build_id_stage_key" ON "construct_blueprint_build_stages"("build_id", "stage");

-- CreateIndex
CREATE INDEX "construct_blueprint_build_events_build_id_timestamp_idx" ON "construct_blueprint_build_events"("build_id", "timestamp");

-- AddForeignKey
ALTER TABLE "construct_blueprint_build_stages" ADD CONSTRAINT "construct_blueprint_build_stages_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "construct_blueprint_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construct_blueprint_build_events" ADD CONSTRAINT "construct_blueprint_build_events_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "construct_blueprint_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

