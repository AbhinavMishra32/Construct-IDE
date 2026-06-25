import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");

export type IDisposable = { dispose(): void };
export type Event<T> = (listener: (event: T) => void) => IDisposable;

export const enum StorageScope {
  APPLICATION = -1,
  PROFILE = 0,
  WORKSPACE = 1
}

export const enum StorageTarget {
  USER = 0,
  MACHINE = 1
}

export const enum WillSaveStateReason {
  NONE = 0,
  SHUTDOWN = 1,
  PERIODIC = 2
}

export type StorageValue = string | boolean | number | null | undefined | object;

export type StorageScopeRef =
  | { scope: StorageScope.APPLICATION }
  | { scope: StorageScope.PROFILE; profileId?: string }
  | { scope: StorageScope.WORKSPACE; workspaceId: string };

export type StorageUpdateRequest = {
  readonly insert?: Map<string, string>;
  readonly delete?: Set<string>;
  readonly targets?: Map<string, StorageTarget>;
};

export interface IStorageProvider {
  readonly id: string;
  initialize(): void | Promise<void>;
  getItems(scopeKey: string): Map<string, string>;
  getTargets(scopeKey: string): Map<string, StorageTarget>;
  updateItems(scopeKey: string, request: StorageUpdateRequest): void | Promise<void>;
  optimize(scopeKey: string): void | Promise<void>;
  close(): void | Promise<void>;
}

export type StorageSyncOperation = {
  id: string;
  providerId: string;
  scopeKey: string;
  key: string;
  operation: "set" | "delete";
  target: StorageTarget | null;
  createdAt: string;
};

export interface IStorageSyncProvider {
  readonly id: string;
  readonly kind: "local" | "construct-cloud";
  enqueue(operation: StorageSyncOperation): Promise<void>;
  flush(): Promise<void>;
}

export interface IStorageValueChangeEvent {
  readonly scope: StorageScope;
  readonly scopeKey: string;
  readonly key: string;
  readonly target: StorageTarget | undefined;
  readonly external?: boolean;
}

export interface IStorageTargetChangeEvent {
  readonly scope: StorageScope;
  readonly scopeKey: string;
}

export interface IWillSaveStateEvent {
  readonly reason: WillSaveStateReason;
}

export interface IStorageEntry {
  readonly key: string;
  readonly value: StorageValue;
  readonly scope: StorageScopeRef;
  readonly target: StorageTarget;
}

export interface IStorageService {
  readonly _serviceBrand: undefined;
  readonly onDidChangeTarget: Event<IStorageTargetChangeEvent>;
  readonly onWillSaveState: Event<IWillSaveStateEvent>;
  onDidChangeValue(scope: StorageScope, key?: string): Event<IStorageValueChangeEvent>;
  initialize(): Promise<void>;
  get(key: string, scope: StorageScopeRef, fallbackValue: string): string;
  get(key: string, scope: StorageScopeRef, fallbackValue?: string): string | undefined;
  getBoolean(key: string, scope: StorageScopeRef, fallbackValue: boolean): boolean;
  getBoolean(key: string, scope: StorageScopeRef, fallbackValue?: boolean): boolean | undefined;
  getNumber(key: string, scope: StorageScopeRef, fallbackValue: number): number;
  getNumber(key: string, scope: StorageScopeRef, fallbackValue?: number): number | undefined;
  getObject<T>(key: string, scope: StorageScopeRef, fallbackValue: T): T;
  getObject<T>(key: string, scope: StorageScopeRef, fallbackValue?: T): T | undefined;
  store(key: string, value: StorageValue, scope: StorageScopeRef, target: StorageTarget): void;
  storeAll(entries: IStorageEntry[], external?: boolean): void;
  remove(key: string, scope: StorageScopeRef): void;
  keys(scope: StorageScopeRef, target?: StorageTarget): string[];
  flush(reason?: WillSaveStateReason): Promise<void>;
  whenFlushed(): Promise<void>;
  optimize(scope?: StorageScopeRef): Promise<void>;
  close(): Promise<void>;
}

type ConstructStorageOptions = {
  flushDelayMs?: number;
  periodicFlushIntervalMs?: number;
};

type StoredRow = {
  scope: string;
  key: string;
  value: string;
  target: number;
};

export const APPLICATION_SCOPE: StorageScopeRef = { scope: StorageScope.APPLICATION };
export const DEFAULT_PROFILE_SCOPE: StorageScopeRef = { scope: StorageScope.PROFILE, profileId: "default" };

export function workspaceStorageScope(workspaceId: string): StorageScopeRef {
  return { scope: StorageScope.WORKSPACE, workspaceId };
}

export function storageScopeKey(ref: StorageScopeRef): string {
  if (ref.scope === StorageScope.APPLICATION) return "application";
  if (ref.scope === StorageScope.PROFILE) return `profile:${ref.profileId?.trim() || "default"}`;
  return `workspace:${ref.workspaceId.trim()}`;
}

export function storageScopeFromKey(scopeKey: string): StorageScope {
  if (scopeKey.startsWith("workspace:")) return StorageScope.WORKSPACE;
  if (scopeKey.startsWith("profile:")) return StorageScope.PROFILE;
  return StorageScope.APPLICATION;
}

export class ConstructStorageService implements IStorageService {
  declare readonly _serviceBrand: undefined;

  private readonly _onDidChangeValue = new Emitter<IStorageValueChangeEvent>();
  private readonly _onDidChangeTarget = new Emitter<IStorageTargetChangeEvent>();
  private readonly _onWillSaveState = new Emitter<IWillSaveStateEvent>();
  private readonly scopes = new Map<string, ConstructStorageBucket>();
  private readonly syncProviders = new Map<string, IStorageSyncProvider>();
  private initialized = false;
  private periodicFlushTimer: NodeJS.Timeout | null = null;

  readonly onDidChangeTarget = this._onDidChangeTarget.event;
  readonly onWillSaveState = this._onWillSaveState.event;

  constructor(
    private readonly provider: IStorageProvider,
    private readonly options: ConstructStorageOptions = {}
  ) {}

  registerSyncProvider(provider: IStorageSyncProvider): void {
    this.syncProviders.set(provider.id, provider);
  }

  onDidChangeValue(scope: StorageScope, key?: string): Event<IStorageValueChangeEvent> {
    return (listener) => this._onDidChangeValue.event((event) => {
      if (event.scope === scope && (key == null || event.key === key)) {
        listener(event);
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.provider.initialize();
    this.initialized = true;
    this.periodicFlushTimer = setInterval(() => {
      void this.flush(WillSaveStateReason.PERIODIC).catch((error) => {
        console.error("[construct-storage] periodic flush failed", error);
      });
    }, this.options.periodicFlushIntervalMs ?? 60_000);
    this.periodicFlushTimer.unref?.();
  }

  get(key: string, scope: StorageScopeRef, fallbackValue: string): string;
  get(key: string, scope: StorageScopeRef, fallbackValue?: string): string | undefined;
  get(key: string, scope: StorageScopeRef, fallbackValue?: string): string | undefined {
    const value = this.bucket(scope).get(key);
    return value ?? fallbackValue;
  }

  getBoolean(key: string, scope: StorageScopeRef, fallbackValue: boolean): boolean;
  getBoolean(key: string, scope: StorageScopeRef, fallbackValue?: boolean): boolean | undefined;
  getBoolean(key: string, scope: StorageScopeRef, fallbackValue?: boolean): boolean | undefined {
    const value = this.get(key, scope);
    if (value == null) return fallbackValue;
    return value === "true";
  }

  getNumber(key: string, scope: StorageScopeRef, fallbackValue: number): number;
  getNumber(key: string, scope: StorageScopeRef, fallbackValue?: number): number | undefined;
  getNumber(key: string, scope: StorageScopeRef, fallbackValue?: number): number | undefined {
    const value = this.get(key, scope);
    if (value == null) return fallbackValue;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  }

  getObject<T>(key: string, scope: StorageScopeRef, fallbackValue: T): T;
  getObject<T>(key: string, scope: StorageScopeRef, fallbackValue?: T): T | undefined;
  getObject<T>(key: string, scope: StorageScopeRef, fallbackValue?: T): T | undefined {
    const value = this.get(key, scope);
    if (value == null) return fallbackValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallbackValue;
    }
  }

  store(key: string, value: StorageValue, scope: StorageScopeRef, target: StorageTarget): void {
    this.storeAll([{ key, value, scope, target }]);
  }

  storeAll(entries: IStorageEntry[], external = false): void {
    for (const entry of entries) {
      const bucket = this.bucket(entry.scope);
      const scopeKey = storageScopeKey(entry.scope);
      const value = stringifyStorageValue(entry.value);
      if (value == null) {
        if (bucket.delete(entry.key)) {
          this._onDidChangeValue.fire({
            scope: entry.scope.scope,
            scopeKey,
            key: entry.key,
            target: undefined,
            external
          });
          this._onDidChangeTarget.fire({ scope: entry.scope.scope, scopeKey });
          this.enqueueSync(scopeKey, entry.key, "delete", null);
        }
        continue;
      }
      const changed = bucket.set(entry.key, value, entry.target);
      if (changed) {
        const event = {
          scope: entry.scope.scope,
          scopeKey,
          key: entry.key,
          target: entry.target,
          external
        };
        this._onDidChangeValue.fire(event);
        this._onDidChangeTarget.fire({ scope: entry.scope.scope, scopeKey: event.scopeKey });
        this.enqueueSync(event.scopeKey, entry.key, "set", entry.target);
      }
    }
  }

  remove(key: string, scope: StorageScopeRef): void {
    const scopeKey = storageScopeKey(scope);
    if (this.bucket(scope).delete(key)) {
      this._onDidChangeValue.fire({ scope: scope.scope, scopeKey, key, target: undefined });
      this._onDidChangeTarget.fire({ scope: scope.scope, scopeKey });
      this.enqueueSync(scopeKey, key, "delete", null);
    }
  }

  keys(scope: StorageScopeRef, target?: StorageTarget): string[] {
    return this.bucket(scope).keys(target);
  }

  async flush(reason = WillSaveStateReason.NONE): Promise<void> {
    await this.initialize();
    this._onWillSaveState.fire({ reason });
    await Promise.all(Array.from(this.scopes.values()).map((bucket) => bucket.flush(0)));
    await Promise.all(Array.from(this.syncProviders.values()).map((provider) => provider.flush()));
  }

  async whenFlushed(): Promise<void> {
    await Promise.all(Array.from(this.scopes.values()).map((bucket) => bucket.whenFlushed()));
  }

  async optimize(scope?: StorageScopeRef): Promise<void> {
    if (scope) {
      await this.bucket(scope).flush(0);
      await this.provider.optimize(storageScopeKey(scope));
      return;
    }
    await this.flush();
    await this.provider.optimize("*");
  }

  async close(): Promise<void> {
    if (this.periodicFlushTimer) {
      clearInterval(this.periodicFlushTimer);
      this.periodicFlushTimer = null;
    }
    await this.flush(WillSaveStateReason.SHUTDOWN).catch((error) => {
      console.error("[construct-storage] shutdown flush failed", error);
    });
    await this.provider.close();
  }

  private bucket(scope: StorageScopeRef): ConstructStorageBucket {
    const scopeKey = storageScopeKey(scope);
    const existing = this.scopes.get(scopeKey);
    if (existing) return existing;
    const bucket = new ConstructStorageBucket({
      scopeKey,
      provider: this.provider,
      flushDelayMs: this.options.flushDelayMs ?? 100
    });
    this.scopes.set(scopeKey, bucket);
    return bucket;
  }

  private enqueueSync(
    scopeKey: string,
    key: string,
    operation: StorageSyncOperation["operation"],
    target: StorageTarget | null
  ): void {
    for (const provider of this.syncProviders.values()) {
      void provider.enqueue({
        id: randomUUID(),
        providerId: provider.id,
        scopeKey,
        key,
        operation,
        target,
        createdAt: new Date().toISOString()
      }).catch((error) => {
        console.error("[construct-storage] sync enqueue failed", { providerId: provider.id, scopeKey, key, error });
      });
    }
  }
}

class ConstructStorageBucket {
  private readonly items = new Map<string, string>();
  private readonly targets = new Map<string, StorageTarget>();
  private readonly pendingInserts = new Map<string, string>();
  private readonly pendingDeletes = new Set<string>();
  private readonly pendingTargets = new Map<string, StorageTarget>();
  private initialized = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private whenFlushedCallbacks: Array<() => void> = [];

  constructor(private readonly options: {
    scopeKey: string;
    provider: IStorageProvider;
    flushDelayMs: number;
  }) {}

  get(key: string): string | undefined {
    this.initialize();
    return this.items.get(key);
  }

  set(key: string, value: string | undefined, target: StorageTarget): boolean {
    this.initialize();
    if (value == null) {
      return this.delete(key);
    }

    if (this.items.get(key) === value && this.targets.get(key) === target) {
      return false;
    }

    this.items.set(key, value);
    this.targets.set(key, target);
    this.pendingInserts.set(key, value);
    this.pendingTargets.set(key, target);
    this.pendingDeletes.delete(key);
    this.scheduleFlush();
    return true;
  }

  delete(key: string): boolean {
    this.initialize();
    const existed = this.items.delete(key);
    this.targets.delete(key);
    this.pendingInserts.delete(key);
    this.pendingTargets.delete(key);
    if (!existed && !this.pendingInserts.has(key)) {
      return false;
    }
    this.pendingDeletes.add(key);
    this.scheduleFlush();
    return true;
  }

  keys(target?: StorageTarget): string[] {
    this.initialize();
    if (target == null) return Array.from(this.items.keys()).sort();
    return Array.from(this.items.keys()).filter((key) => this.targets.get(key) === target).sort();
  }

  async flush(delay?: number): Promise<void> {
    this.initialize();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (delay != null && delay > 0) {
      this.scheduleFlush(delay);
      return this.whenFlushed();
    }
    return this.flushPending();
  }

  async whenFlushed(): Promise<void> {
    if (!this.hasPending) {
      return this.flushPromise ?? Promise.resolve();
    }
    return new Promise((resolve) => this.whenFlushedCallbacks.push(resolve));
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    const items = this.options.provider.getItems(this.options.scopeKey);
    const targets = this.options.provider.getTargets(this.options.scopeKey);
    for (const [key, value] of items) {
      if (!this.pendingDeletes.has(key) && !this.pendingInserts.has(key)) {
        this.items.set(key, value);
      }
    }
    for (const [key, target] of targets) {
      if (!this.pendingDeletes.has(key) && !this.pendingTargets.has(key)) {
        this.targets.set(key, target);
      }
    }
  }

  private get hasPending(): boolean {
    return this.pendingInserts.size > 0 || this.pendingDeletes.size > 0;
  }

  private scheduleFlush(delay = this.options.flushDelayMs): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending().catch((error) => {
        console.error("[construct-storage] flush failed", { scopeKey: this.options.scopeKey, error });
      });
    }, delay);
    this.flushTimer.unref?.();
  }

  private async flushPending(): Promise<void> {
    this.initialize();
    if (!this.hasPending) {
      this.resolveWhenFlushed();
      return this.flushPromise ?? Promise.resolve();
    }
    if (this.flushPromise) {
      await this.flushPromise;
      if (!this.hasPending) {
        this.resolveWhenFlushed();
        return;
      }
    }

    const request: StorageUpdateRequest = {
      insert: new Map(this.pendingInserts),
      delete: new Set(this.pendingDeletes),
      targets: new Map(this.pendingTargets)
    };
    this.pendingInserts.clear();
    this.pendingDeletes.clear();
    this.pendingTargets.clear();

    this.flushPromise = Promise.resolve()
      .then(() => this.options.provider.updateItems(this.options.scopeKey, request))
      .finally(() => {
        this.flushPromise = null;
        if (!this.hasPending) {
          this.resolveWhenFlushed();
        }
      });
    return this.flushPromise;
  }

  private resolveWhenFlushed(): void {
    while (this.whenFlushedCallbacks.length) {
      this.whenFlushedCallbacks.pop()?.();
    }
  }
}

export class SQLiteStorageProvider implements IStorageProvider {
  readonly id = "sqlite";

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
      CREATE TABLE IF NOT EXISTS storage_items (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        target INTEGER NOT NULL DEFAULT ${StorageTarget.MACHINE},
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_storage_items_target ON storage_items(scope, target);
      CREATE TABLE IF NOT EXISTS storage_sync_queue (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        operation TEXT NOT NULL,
        target INTEGER,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        flushed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_storage_sync_queue_status ON storage_sync_queue(provider_id, status, created_at);
    `);
    this.db = db;
  }

  getItems(scopeKey: string): Map<string, string> {
    const db = this.requireDb();
    const rows = db.prepare("SELECT key, value FROM storage_items WHERE scope = ?").all(scopeKey) as Array<Pick<StoredRow, "key" | "value">>;
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  getTargets(scopeKey: string): Map<string, StorageTarget> {
    const db = this.requireDb();
    const rows = db.prepare("SELECT key, target FROM storage_items WHERE scope = ?").all(scopeKey) as Array<Pick<StoredRow, "key" | "target">>;
    return new Map(rows.map((row) => [row.key, normalizeStorageTarget(row.target)]));
  }

  async updateItems(scopeKey: string, request: StorageUpdateRequest): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO storage_items(scope, key, value, target, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET
        value = excluded.value,
        target = excluded.target,
        updated_at = excluded.updated_at
      WHERE storage_items.value != excluded.value OR storage_items.target != excluded.target
    `);
    const remove = db.prepare("DELETE FROM storage_items WHERE scope = ? AND key = ?");

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of request.insert ?? []) {
        insert.run(scopeKey, key, value, request.targets?.get(key) ?? StorageTarget.MACHINE, now);
      }
      for (const key of request.delete ?? []) {
        remove.run(scopeKey, key);
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The original write error is more useful than a rollback failure.
      }
      throw error;
    }
  }

  async optimize(scopeKey: string): Promise<void> {
    const db = this.requireDb();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (scopeKey === "*") {
      db.exec("VACUUM");
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  enqueueSync(operation: StorageSyncOperation): void {
    const db = this.requireDb();
    db.prepare(`
      INSERT OR REPLACE INTO storage_sync_queue(id, provider_id, scope, key, operation, target, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      operation.id,
      operation.providerId,
      operation.scopeKey,
      operation.key,
      operation.operation,
      operation.target,
      operation.createdAt
    );
  }

  markSyncFlushed(providerId: string): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE storage_sync_queue
      SET status = 'flushed', flushed_at = ?
      WHERE provider_id = ? AND status = 'pending'
    `).run(new Date().toISOString(), providerId);
  }

  private requireDb(): NodeDatabaseSync {
    if (!this.db) {
      throw new Error("Construct storage provider has not been initialized.");
    }
    return this.db;
  }
}

export class LocalStorageSyncProvider implements IStorageSyncProvider {
  readonly id = "local";
  readonly kind = "local" as const;

  private pending = new Map<string, StorageSyncOperation>();

  constructor(private readonly sqlite?: SQLiteStorageProvider) {}

  async enqueue(operation: StorageSyncOperation): Promise<void> {
    this.pending.set(`${operation.scopeKey}:${operation.key}`, operation);
    this.sqlite?.enqueueSync(operation);
  }

  async flush(): Promise<void> {
    this.pending.clear();
    this.sqlite?.markSyncFlushed(this.id);
  }
}

export class ConstructCloudStorageSyncProvider implements IStorageSyncProvider {
  readonly id = "construct-cloud";
  readonly kind = "construct-cloud" as const;

  private pending: StorageSyncOperation[] = [];

  async enqueue(operation: StorageSyncOperation): Promise<void> {
    this.pending.push(operation);
  }

  async flush(): Promise<void> {
    // Deliberately a provider boundary only. Cloud transport/auth will plug in here.
    this.pending = [];
  }
}

export function createConstructStorageService(databasePath: string, options?: ConstructStorageOptions): ConstructStorageService {
  const sqlite = new SQLiteStorageProvider(databasePath);
  const service = new ConstructStorageService(sqlite, options);
  service.registerSyncProvider(new LocalStorageSyncProvider(sqlite));
  return service;
}

export function readStorageObjectFromSqliteSync<T>(input: {
  databasePath: string;
  key: string;
  scope?: StorageScopeRef;
}): T | null {
  if (!existsSync(input.databasePath)) {
    return null;
  }

  let db: NodeDatabaseSync | null = null;
  try {
    db = new DatabaseSync(input.databasePath, { readOnly: true });
    const row = db.prepare("SELECT value FROM storage_items WHERE scope = ? AND key = ?")
      .get(storageScopeKey(input.scope ?? APPLICATION_SCOPE), input.key) as { value?: string } | undefined;
    if (typeof row?.value !== "string") return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function migrateJsonValueToStorage<T extends StorageValue>(input: {
  storage: IStorageService;
  key: string;
  scope: StorageScopeRef;
  target?: StorageTarget;
  legacyPath: string;
  normalize: (value: T) => T;
}): Promise<T | null> {
  const current = input.storage.getObject<T>(input.key, input.scope);
  if (current != null) {
    return input.normalize(current);
  }
  if (!existsSync(input.legacyPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(input.legacyPath, "utf8")) as T;
    const normalized = input.normalize(parsed);
    input.storage.store(input.key, normalized, input.scope, input.target ?? StorageTarget.USER);
    return normalized;
  } catch {
    return null;
  }
}

function stringifyStorageValue(value: StorageValue): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function normalizeStorageTarget(value: number): StorageTarget {
  return value === StorageTarget.USER ? StorageTarget.USER : StorageTarget.MACHINE;
}

class Emitter<T> {
  private listeners = new Set<(event: T) => void>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(event: T): void {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}
