import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, CURRENT_VERSION } from '../../src/db/migrate.js';

let tmp: string | undefined;

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

describe('migrations', () => {
  it('creates all expected tables on a fresh memory DB', () => {
    const db = openDatabase({ path: ':memory:', walMode: false });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['cards', 'price_snapshots', 'rarities', 'schema_version', 'sets']),
    );
  });

  it('records CURRENT_VERSION in schema_version after migration', () => {
    const db = openDatabase({ path: ':memory:', walMode: false });
    const v = db.prepare(`SELECT version FROM schema_version`).get() as { version: number };
    expect(v.version).toBe(CURRENT_VERSION);
  });

  it('is idempotent — re-running does not duplicate anything', () => {
    const db = openDatabase({ path: ':memory:', walMode: false });
    // Run migrate logic a second time by re-calling the helper on same DB.
    // We accomplish this by re-invoking the top-level exec through another
    // fresh connection wouldn't be same DB; simulate by ensuring the
    // per-migration guard works via the public API: reopen on disk path.
    tmp = mkdtempSync(join(tmpdir(), 'poke-mig-'));
    const path = join(tmp, 'c.db');
    const d1 = openDatabase({ path, walMode: false });
    d1.close();
    const d2 = openDatabase({ path, walMode: false });
    const rows = d2.prepare(`SELECT version FROM schema_version`).all() as { version: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(CURRENT_VERSION);
    d2.close();
  });

  it('enables WAL on a file-backed DB', () => {
    tmp = mkdtempSync(join(tmpdir(), 'poke-wal-'));
    const path = join(tmp, 'c.db');
    const db = openDatabase({ path });
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
    db.close();
  });
});
