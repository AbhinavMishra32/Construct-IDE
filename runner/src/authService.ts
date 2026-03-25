import { randomUUID, createHash, randomBytes, createCipheriv, createDecipheriv, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  AuthIdentityProviderSchema,
  AuthLoginRequestSchema,
  AuthProviderOptionSchema,
  AuthSessionCreateResponseSchema,
  AuthSessionViewSchema,
  AuthSignupRequestSchema,
  ConnectedProviderAuthTypeSchema,
  ConnectedProviderSchema,
  DeleteProviderConnectionRequestSchema,
  ProviderConnectionSchema,
  ProviderConnectionsResponseSchema,
  UpdateUserAccountRequestSchema,
  UpsertProviderConnectionRequestSchema,
  UserAccountSchema,
  UserAuthSessionSchema
} from "@construct/shared";
import { z } from "zod";

import { getPrismaClient } from "./prisma";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_IV_BYTES = 12;
const AUTH_MASTER_KEY_PATH = path.join(".construct", "state", "auth-master-key");

type ProviderOption = ReturnType<typeof AuthProviderOptionSchema.parse>;
type AuthSessionView = z.infer<typeof AuthSessionViewSchema>;
type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export class AuthError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export type AuthenticatedSession = NonNullable<AuthSessionView["session"]>;

export type AuthenticatedSessionResult = ReturnType<typeof AuthSessionCreateResponseSchema.parse>;

export class ConstructAuthService {
  private readonly prisma = getPrismaClient();
  private readonly rootDirectory: string;
  private masterKeyPromise: Promise<Buffer> | null = null;

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory;
  }

  async getSessionView(sessionToken: string | null | undefined): Promise<AuthSessionView> {
    if (!process.env.DATABASE_URL?.trim()) {
      return this.emptySessionView();
    }

    if (!sessionToken) {
      return this.emptySessionView();
    }

    const sessionRow = await this.prisma.authSession.findUnique({
      where: {
        tokenHash: hashSessionToken(sessionToken)
      },
      include: {
        user: true
      }
    });

    if (!sessionRow || sessionRow.revokedAt || sessionRow.expiresAt.getTime() <= Date.now()) {
      return this.emptySessionView();
    }

    const touchedSession = await this.prisma.authSession.update({
      where: {
        id: sessionRow.id
      },
      data: {
        lastSeenAt: new Date()
      },
      include: {
        user: true
      }
    });

    return this.buildSessionView(touchedSession.user, touchedSession);
  }

  async signUp(input: unknown): Promise<AuthenticatedSessionResult> {
    this.assertDatabaseReady();
    const parsed = AuthSignupRequestSchema.parse(input);
    const normalizedEmail = normalizeEmail(parsed.email);
    const existing = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail
      }
    });

    if (existing) {
      throw new AuthError("An account with that email already exists.", 409);
    }

    const { salt, hash } = await hashPassword(parsed.password);
    const userId = randomUUID();
    const sessionToken = generateSessionToken();
    const sessionHash = hashSessionToken(sessionToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    const created = await this.prisma.user.create({
      data: {
        id: userId,
        email: normalizedEmail,
        displayName: parsed.displayName.trim(),
        passwordCredential: {
          create: {
            passwordHash: hash,
            passwordSalt: salt
          }
        },
        authIdentities: {
          create: {
            id: randomUUID(),
            provider: "password",
            providerUserId: normalizedEmail,
            email: normalizedEmail,
            displayName: parsed.displayName.trim()
          }
        },
        authSessions: {
          create: {
            id: randomUUID(),
            tokenHash: sessionHash,
            lastSeenAt: now,
            expiresAt
          }
        }
      },
      include: {
        authSessions: {
          where: {
            tokenHash: sessionHash
          },
          take: 1
        }
      }
    });

    const session = created.authSessions[0];
    if (!session) {
      throw new AuthError("Failed to create the initial account session.", 500);
    }

    return AuthSessionCreateResponseSchema.parse({
      ...(await this.buildSessionView(created, session)),
      sessionToken
    });
  }

  async login(input: unknown): Promise<AuthenticatedSessionResult> {
    this.assertDatabaseReady();
    const parsed = AuthLoginRequestSchema.parse(input);
    const normalizedEmail = normalizeEmail(parsed.email);
    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail
      },
      include: {
        passwordCredential: true
      }
    });

    if (!user?.passwordCredential) {
      throw new AuthError("No password account exists for that email.", 404);
    }

    const validPassword = await verifyPassword(parsed.password, {
      salt: user.passwordCredential.passwordSalt,
      hash: user.passwordCredential.passwordHash
    });

    if (!validPassword) {
      throw new AuthError("Incorrect email or password.", 401);
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const session = await this.prisma.authSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenHash,
        lastSeenAt: now,
        expiresAt
      }
    });

    await this.prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        lastLoginAt: now
      }
    });

    return AuthSessionCreateResponseSchema.parse({
      ...(await this.buildSessionView(
        {
          ...user,
          lastLoginAt: now
        },
        session
      )),
      sessionToken
    });
  }

  async logout(sessionToken: string | null | undefined): Promise<{ ok: true }> {
    this.assertDatabaseReady();
    if (!sessionToken) {
      return {
        ok: true
      };
    }

    await this.prisma.authSession.updateMany({
      where: {
        tokenHash: hashSessionToken(sessionToken),
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return {
      ok: true
    };
  }

  async updateAccount(userId: string, input: unknown): Promise<AuthSessionView> {
    this.assertDatabaseReady();
    const parsed = UpdateUserAccountRequestSchema.parse(input);
    const user = await this.prisma.user.update({
      where: {
        id: userId
      },
      data: {
        displayName: parsed.displayName.trim()
      }
    });

    return AuthSessionViewSchema.parse({
      user: toUserAccount(user),
      session: null,
      identities: await this.listLinkedIdentities(user.id),
      providerOptions: buildAuthProviderOptions(),
      connections: await this.listConnections(user.id)
    });
  }

  async upsertProviderConnection(userId: string, input: unknown): Promise<{ connections: ProviderConnection[] }> {
    this.assertDatabaseReady();
    const parsed = UpsertProviderConnectionRequestSchema.parse(input);
    const now = new Date();

    if (parsed.authType === "api-key") {
      await this.prisma.providerConnection.upsert({
        where: {
          userId_provider_authType: {
            userId,
            provider: parsed.provider,
            authType: parsed.authType
          }
        },
        create: {
          id: randomUUID(),
          userId,
          provider: parsed.provider,
          authType: parsed.authType,
          status: "configured",
          label: parsed.label?.trim() || defaultConnectionLabel(parsed.provider, parsed.authType),
          hasSecret: true,
          secretEncrypted: await this.encryptSecret(parsed.apiKey.trim()),
          last4: parsed.apiKey.trim().slice(-4),
          baseUrl: normalizeOptionalString(parsed.baseUrl),
          lastValidatedAt: now
        },
        update: {
          status: "configured",
          label: parsed.label?.trim() || defaultConnectionLabel(parsed.provider, parsed.authType),
          hasSecret: true,
          secretEncrypted: await this.encryptSecret(parsed.apiKey.trim()),
          last4: parsed.apiKey.trim().slice(-4),
          baseUrl: normalizeOptionalString(parsed.baseUrl),
          lastValidatedAt: now
        }
      });
    } else {
      await this.prisma.providerConnection.upsert({
        where: {
          userId_provider_authType: {
            userId,
            provider: parsed.provider,
            authType: parsed.authType
          }
        },
        create: {
          id: randomUUID(),
          userId,
          provider: parsed.provider,
          authType: parsed.authType,
          status: "configured",
          label: parsed.label?.trim() || defaultConnectionLabel(parsed.provider, parsed.authType),
          hasSecret: true,
          secretEncrypted: await this.encryptSecret(parsed.accessToken.trim()),
          refreshTokenEncrypted: parsed.refreshToken
            ? await this.encryptSecret(parsed.refreshToken.trim())
            : null,
          baseUrl: normalizeOptionalString(parsed.baseUrl),
          externalAccountId: normalizeOptionalString(parsed.externalAccountId),
          externalEmail: normalizeOptionalString(parsed.externalEmail),
          scopesJson: JSON.stringify(parsed.scopes),
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          lastValidatedAt: now
        },
        update: {
          status: "configured",
          label: parsed.label?.trim() || defaultConnectionLabel(parsed.provider, parsed.authType),
          hasSecret: true,
          secretEncrypted: await this.encryptSecret(parsed.accessToken.trim()),
          refreshTokenEncrypted: parsed.refreshToken
            ? await this.encryptSecret(parsed.refreshToken.trim())
            : null,
          baseUrl: normalizeOptionalString(parsed.baseUrl),
          externalAccountId: normalizeOptionalString(parsed.externalAccountId),
          externalEmail: normalizeOptionalString(parsed.externalEmail),
          scopesJson: JSON.stringify(parsed.scopes),
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          lastValidatedAt: now
        }
      });
    }

    return ProviderConnectionsResponseSchema.parse({
      connections: await this.listConnections(userId)
    });
  }

  async deleteProviderConnection(userId: string, input: unknown): Promise<{ connections: ProviderConnection[] }> {
    this.assertDatabaseReady();
    const parsed = DeleteProviderConnectionRequestSchema.parse(input);

    await this.prisma.providerConnection.deleteMany({
      where: {
        userId,
        provider: parsed.provider,
        authType: parsed.authType
      }
    });

    return ProviderConnectionsResponseSchema.parse({
      connections: await this.listConnections(userId)
    });
  }

  async listProviderConnections(userId: string): Promise<{ connections: ProviderConnection[] }> {
    this.assertDatabaseReady();
    return ProviderConnectionsResponseSchema.parse({
      connections: await this.listConnections(userId)
    });
  }

  async resolveProviderSecret(input: {
    userId: string;
    provider: z.infer<typeof ConnectedProviderSchema>;
    authType?: z.infer<typeof ConnectedProviderAuthTypeSchema>;
  }): Promise<{ secret: string | null; baseUrl: string | null }> {
    if (!process.env.DATABASE_URL?.trim()) {
      return {
        secret: null,
        baseUrl: null
      };
    }

    const connection = await this.prisma.providerConnection.findUnique({
      where: {
        userId_provider_authType: {
          userId: input.userId,
          provider: input.provider,
          authType: input.authType ?? "api-key"
        }
      }
    });

    if (!connection?.secretEncrypted || connection.status !== "configured") {
      return {
        secret: null,
        baseUrl: connection?.baseUrl ?? null
      };
    }

    return {
      secret: await this.decryptSecret(connection.secretEncrypted),
      baseUrl: connection.baseUrl ?? null
    };
  }

  private async buildSessionView(
    user: {
      id: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
      lastLoginAt: Date | null;
    },
    session: {
      id: string;
      userId: string;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
    }
  ): Promise<AuthSessionView> {
    return AuthSessionViewSchema.parse({
      user: toUserAccount(user),
      session: UserAuthSessionSchema.parse({
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString()
      }),
      identities: await this.listLinkedIdentities(user.id),
      providerOptions: buildAuthProviderOptions(),
      connections: await this.listConnections(user.id)
    });
  }

  private emptySessionView(): AuthSessionView {
    return AuthSessionViewSchema.parse({
      user: null,
      session: null,
      identities: [],
      providerOptions: buildAuthProviderOptions(),
      connections: []
    });
  }

  private async listLinkedIdentities(userId: string) {
    const identities = await this.prisma.authIdentity.findMany({
      where: {
        userId
      },
      orderBy: [
        {
          linkedAt: "asc"
        },
        {
          updatedAt: "asc"
        }
      ]
    });

    return identities.map((identity) => ({
      id: identity.id,
      provider: AuthIdentityProviderSchema.parse(identity.provider),
      providerUserId: identity.providerUserId,
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
      linkedAt: identity.linkedAt.toISOString(),
      updatedAt: identity.updatedAt.toISOString()
    }));
  }

  private async listConnections(userId: string): Promise<ProviderConnection[]> {
    const connections = await this.prisma.providerConnection.findMany({
      where: {
        userId
      },
      orderBy: [
        {
          provider: "asc"
        },
        {
          createdAt: "asc"
        }
      ]
    });

    return connections.map((connection) =>
      ProviderConnectionSchema.parse({
        id: connection.id,
        provider: ConnectedProviderSchema.parse(connection.provider),
        authType: ConnectedProviderAuthTypeSchema.parse(connection.authType),
        status: connection.status,
        label: connection.label || defaultConnectionLabel(connection.provider, connection.authType),
        hasSecret: connection.hasSecret,
        last4: connection.last4 ?? null,
        baseUrl: connection.baseUrl ?? null,
        externalAccountId: connection.externalAccountId ?? null,
        externalEmail: connection.externalEmail ?? null,
        scopes: parseScopes(connection.scopesJson),
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
        lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null
      })
    );
  }

  private async getMasterKey(): Promise<Buffer> {
    if (!this.masterKeyPromise) {
      this.masterKeyPromise = this.readOrCreateMasterKey();
    }

    return this.masterKeyPromise;
  }

  private async readOrCreateMasterKey(): Promise<Buffer> {
    const configuredKey = process.env.CONSTRUCT_APP_SECRET?.trim();
    if (configuredKey) {
      return deriveEncryptionKey(Buffer.from(configuredKey, "utf8"));
    }

    const keyPath = path.join(this.rootDirectory, AUTH_MASTER_KEY_PATH);
    if (existsSync(keyPath)) {
      const raw = (await readFile(keyPath, "utf8")).trim();
      return Buffer.from(raw, "base64url");
    }

    const key = randomBytes(ENCRYPTION_KEY_BYTES);
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, `${key.toString("base64url")}\n`, "utf8");
    return key;
  }

  private async encryptSecret(secret: string): Promise<string> {
    const key = await this.getMasterKey();
    const iv = randomBytes(ENCRYPTION_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  private async decryptSecret(payload: string): Promise<string> {
    const [version, ivPart, tagPart, cipherPart] = payload.split(":");
    if (version !== "v1" || !ivPart || !tagPart || !cipherPart) {
      throw new AuthError("Stored provider secret is unreadable.", 500);
    }

    const key = await this.getMasterKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivPart, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherPart, "base64url")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  private assertDatabaseReady(): void {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new AuthError(
        "DATABASE_URL is required for the Construct account system and encrypted provider settings.",
        500
      );
    }
  }
}

function buildAuthProviderOptions(): ProviderOption[] {
  return [
    AuthProviderOptionSchema.parse({
      id: "password",
      kind: "password",
      label: "Email and password",
      description: "Create a native Construct account for local auth and saved provider settings.",
      enabled: true,
      comingSoon: false,
      buttonLabel: "Continue with email"
    }),
    AuthProviderOptionSchema.parse({
      id: "openai",
      kind: "oauth",
      label: "OpenAI",
      description: "Connect your OpenAI or ChatGPT subscription once provider OAuth is enabled.",
      enabled: false,
      comingSoon: true,
      buttonLabel: "Continue with OpenAI"
    }),
    AuthProviderOptionSchema.parse({
      id: "codex",
      kind: "oauth",
      label: "Codex",
      description: "Link Codex identity and billing later without typing raw API keys into the app.",
      enabled: false,
      comingSoon: true,
      buttonLabel: "Continue with Codex"
    })
  ];
}

function toUserAccount(user: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}) {
  return UserAccountSchema.parse({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return {
    salt,
    hash: derivedKey.toString("base64url")
  };
}

async function verifyPassword(
  password: string,
  input: { salt: string; hash: string }
): Promise<boolean> {
  const expected = Buffer.from(input.hash, "base64url");
  const actual = (await scrypt(password, input.salt, expected.length)) as Buffer;

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

function defaultConnectionLabel(provider: string, authType: string): string {
  if (authType === "oauth") {
    return `${provider} OAuth`;
  }

  return `${provider} API key`;
}

function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function deriveEncryptionKey(seed: Buffer): Buffer {
  return createHash("sha256").update(seed).digest().subarray(0, ENCRYPTION_KEY_BYTES);
}
