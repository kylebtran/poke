/**
 * Migrations are expressed as inline SQL strings (rather than .sql files)
 * so the build is a pure `tsc` run with no copy step. Each entry is a
 * `(version, name, sql)` triple; `migrate()` in `migrate.ts` applies them
 * in order once per version.
 *
 * Add new migrations to the bottom; never renumber or edit an applied one.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        language_code TEXT NOT NULL,
        set_id TEXT NOT NULL,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id);
      CREATE INDEX IF NOT EXISTS idx_cards_lang ON cards(language_code);

      CREATE TABLE IF NOT EXISTS sets (
        id TEXT PRIMARY KEY,
        language_code TEXT NOT NULL,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS price_snapshots (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        fetched_at TEXT NOT NULL,
        currency TEXT NOT NULL,
        raw_market_cents INTEGER,
        raw_low_cents INTEGER,
        raw_mid_cents INTEGER,
        raw_high_cents INTEGER,
        graded_psa10_cents INTEGER,
        source TEXT NOT NULL,
        PRIMARY KEY (card_id, fetched_at)
      );
      CREATE INDEX IF NOT EXISTS idx_prices_latest
        ON price_snapshots(card_id, fetched_at DESC);

      CREATE TABLE IF NOT EXISTS rarities (
        language_code TEXT NOT NULL,
        rarity_name TEXT NOT NULL,
        tier TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('default','user')),
        PRIMARY KEY (language_code, rarity_name)
      );
    `,
  },
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
