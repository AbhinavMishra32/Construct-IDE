CREATE TABLE "construct_user_feature_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "construct_user_feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "construct_user_feature_flags_user_id_key_key"
ON "construct_user_feature_flags"("user_id", "key");

CREATE INDEX "construct_user_feature_flags_user_id_updated_at_idx"
ON "construct_user_feature_flags"("user_id", "updated_at");

ALTER TABLE "construct_user_feature_flags"
ADD CONSTRAINT "construct_user_feature_flags_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "construct_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
