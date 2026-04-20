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
  {
    version: 2,
    name: 'collection',
    sql: `
      CREATE TABLE IF NOT EXISTS owned_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        condition TEXT NOT NULL DEFAULT 'NM',
        foil INTEGER NOT NULL DEFAULT 0,
        acquired_at TEXT NOT NULL,
        acquired_price_cents INTEGER,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_owned_card_id ON owned_cards(card_id);
    `,
  },
  {
    version: 3,
    name: 'tags',
    sql: `
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS owned_tags (
        owned_id INTEGER NOT NULL REFERENCES owned_cards(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (owned_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_owned_tags_tag ON owned_tags(tag_id);
    `,
  },
];

export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
