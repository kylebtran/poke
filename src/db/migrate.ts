import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbFile, configDir } from '../config/paths.js';
import { MIGRATIONS, CURRENT_VERSION } from './migrations.js';

/**
 * Always-on migration runner. `openDatabase()` is the ONLY way the rest of
 * the codebase opens a connection — it guarantees:
 *
 *   - The config dir exists.
 *   - `PRAGMA journal_mode = WAL` for multi-reader concurrency (spec §7
 *     "Concurrency"); skipped for `:memory:`.
 *   - `PRAGMA foreign_keys = ON`.
 *   - Every migration in `src/db/migrations.ts` has been applied.
 */

export type DB = Database.Database;
export { CURRENT_VERSION };

export interface OpenOptions {
  path?: string;
  walMode?: boolean;
  verbose?: boolean;
}

export function openDatabase(opts: OpenOptions = {}): DB {
  const path = opts.path ?? dbFile();
  if (path !== ':memory:') {
    const dir = dirname(path);
    mkdirSync(dir === '' ? configDir() : dir, { recursive: true, mode: 0o700 });
  }
  const db = new Database(path);
  const wal = opts.walMode ?? path !== ':memory:';
  if (wal) {
    try {
      db.pragma('journal_mode = WAL');
    } catch {
      // Non-fatal — readers still work, we just lose concurrency.
    }
  }
  db.pragma('foreign_keys = ON');
  migrate(db, opts.verbose ?? false);
  return db;
}

export function migrate(db: DB, verbose = false): number {
  ensureVersionTable(db);
  const current = currentVersion(db);
  let applied = current;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      setVersion(db, m.version);
    });
    tx();
    applied = m.version;
    if (verbose) process.stderr.write(`migrated: ${m.version}_${m.name}\n`);
  }
  return applied;
}

function ensureVersionTable(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
  const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare(`INSERT INTO schema_version (version) VALUES (0)`).run();
  }
}

function currentVersion(db: DB): number {
  const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

function setVersion(db: DB, v: number): void {
  db.prepare(`UPDATE schema_version SET version = ?`).run(v);
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
