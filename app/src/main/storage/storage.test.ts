import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPLICATION_SCOPE,
  createConstructStorageService,
  migrateJsonValueToStorage,
  readStorageObjectFromSqliteSync,
  StorageTarget
} from "./storage";

test("SQLite storage caches immediately and persists on flush", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-storage-"));
  const dbPath = path.join(dir, "state.vscdb");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const storage = createConstructStorageService(dbPath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  storage.store("construct.ui.test", { open: true }, APPLICATION_SCOPE, StorageTarget.USER);
  assert.deepEqual(storage.getObject("construct.ui.test", APPLICATION_SCOPE), { open: true });
  assert.equal(readStorageObjectFromSqliteSync({ databasePath: dbPath, key: "construct.ui.test" }), null);

  await storage.flush();
  await storage.close();

  assert.deepEqual(readStorageObjectFromSqliteSync({ databasePath: dbPath, key: "construct.ui.test" }), { open: true });
});

test("legacy JSON values migrate into storage once", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "construct-storage-"));
  const dbPath = path.join(dir, "state.vscdb");
  const legacyPath = path.join(dir, "legacy.json");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(legacyPath, JSON.stringify({ name: "legacy", count: 1 }), "utf8");

  const storage = createConstructStorageService(dbPath, {
    flushDelayMs: 10_000,
    periodicFlushIntervalMs: 60_000
  });
  await storage.initialize();

  const migrated = await migrateJsonValueToStorage({
    storage,
    key: "construct.legacy",
    scope: APPLICATION_SCOPE,
    target: StorageTarget.USER,
    legacyPath,
    normalize: (value: { name: string; count: number }) => ({ ...value, count: value.count + 1 })
  });

  assert.deepEqual(migrated, { name: "legacy", count: 2 });
  assert.deepEqual(storage.getObject("construct.legacy", APPLICATION_SCOPE), { name: "legacy", count: 2 });

  await storage.flush();
  await storage.close();
  assert.deepEqual(readStorageObjectFromSqliteSync({ databasePath: dbPath, key: "construct.legacy" }), { name: "legacy", count: 2 });
});
