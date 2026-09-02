import { createRequire } from "node:module";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

/**
 * `node:sqlite` is a builtin, but it is only reachable through `createRequire`
 * from an ESM main process — and reaching it that way is deliberate. Construct
 * v0.7 already stored everything through it, so the schema, the migration
 * history, and the operational behaviour under Electron are all proven here.
 *
 * The alternative would have been better-sqlite3, which the seeded Spar shell
 * brought with it. That is a native module: it needs rebuilding against every
 * Electron ABI, it has to be unpacked from the asar, and it is one more thing
 * that can fail on a user's machine at install time. A builtin has none of
 * those failure modes.
 */
const requireBuiltin = createRequire(import.meta.url);
const { DatabaseSync } = requireBuiltin("node:sqlite") as typeof import("node:sqlite");

export type Database = NodeDatabaseSync;

/**
 * Opens the database and applies every migration that has not run yet.
 *
 * Migrations are an append-only list, applied inside one transaction and
 * recorded by index. A half-applied schema is the one failure mode that leaves
 * a learner's history unreadable, so the transaction is not optional.
 */
export function openDatabase(file: string, migrations: readonly string[]): Database {
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (idx INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");

  const applied = new Set(
    (database.prepare("SELECT idx FROM schema_migrations").all() as Array<{ idx: number }>).map((row) => row.idx),
  );

  for (const [index, statement] of migrations.entries()) {
    if (applied.has(index)) continue;
    database.exec("BEGIN");
    try {
      database.exec(statement);
      database.prepare("INSERT INTO schema_migrations (idx, applied_at) VALUES (?, ?)").run(index, new Date().toISOString());
      database.exec("COMMIT");
    } catch (cause) {
      database.exec("ROLLBACK");
      throw new Error(`Construct could not apply database migration ${index}.`, { cause });
    }
  }

  return database;
}
