import { openDatabase, type DB } from '../../src/db/migrate.js';

/**
 * Convenience factory for tests. Returns a migrated in-memory DB.
 * WAL is skipped because SQLite rejects it on `:memory:`.
 */
export function openTestDb(): DB {
  return openDatabase({ path: ':memory:', walMode: false });
}
