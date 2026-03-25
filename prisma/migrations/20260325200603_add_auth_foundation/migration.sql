-- CreateTable
CREATE TABLE "construct_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "construct_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construct_password_credentials" (
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_salt" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "construct_password_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "construct_auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "construct_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construct_auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "scopes_json" TEXT NOT NULL DEFAULT '[]',
    "metadata_json" TEXT,
    "token_expires_at" TIMESTAMPTZ(6),
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "construct_auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construct_provider_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "has_secret" BOOLEAN NOT NULL DEFAULT false,
    "secret_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "last4" TEXT,
    "base_url" TEXT,
    "external_account_id" TEXT,
    "external_email" TEXT,
    "scopes_json" TEXT NOT NULL DEFAULT '[]',
    "metadata_json" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "last_validated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "construct_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "construct_users_email_key" ON "construct_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "construct_auth_sessions_token_hash_key" ON "construct_auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "construct_auth_sessions_user_id_revoked_at_idx" ON "construct_auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "construct_auth_sessions_user_id_expires_at_idx" ON "construct_auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "construct_auth_identities_user_id_provider_idx" ON "construct_auth_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "construct_auth_identities_provider_provider_user_id_key" ON "construct_auth_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "construct_provider_connections_user_id_provider_idx" ON "construct_provider_connections"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "construct_provider_connections_user_id_provider_auth_type_key" ON "construct_provider_connections"("user_id", "provider", "auth_type");

-- AddForeignKey
ALTER TABLE "construct_password_credentials" ADD CONSTRAINT "construct_password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "construct_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construct_auth_sessions" ADD CONSTRAINT "construct_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "construct_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construct_auth_identities" ADD CONSTRAINT "construct_auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "construct_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construct_provider_connections" ADD CONSTRAINT "construct_provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "construct_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

