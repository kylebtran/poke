import type { DB } from '../db/migrate.js';

/**
 * Rarity → tier mapping. Spec §5: rarities are opaque strings from
 * Scrydex; tiers are a rendering/grouping concept that lives in the
 * `rarities` table. Defaults are populated on first observation; user
 * overrides take precedence.
 */

export type Tier =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'ultra'
  | 'secret'
  | 'promo'
  | 'unknown';

export const ALL_TIERS: readonly Tier[] = [
  'common',
  'uncommon',
  'rare',
  'ultra',
  'secret',
  'promo',
  'unknown',
];

/**
 * Default rarity→tier guesses per language. These seed the `rarities`
 * table on first sight; users can override any row via `poke config set
 * rarity-tier <rarity> <tier>`.
 */
export const DEFAULT_RARITY_TIERS: Record<string, Record<string, Tier>> = {
  en: {
    Common: 'common',
    Uncommon: 'uncommon',
    Rare: 'rare',
    'Rare Holo': 'rare',
    'Double Rare': 'rare',
    'Ultra Rare': 'ultra',
    'Illustration Rare': 'ultra',
    'Special Illustration Rare': 'secret',
    'Hyper Rare': 'secret',
    'Shiny Rare': 'ultra',
    'Shiny Ultra Rare': 'secret',
    Promo: 'promo',
  },
  ja: {
    通常: 'common',
    U: 'uncommon',
    R: 'rare',
    RR: 'rare',
    RRR: 'ultra',
    SAR: 'secret',
    UR: 'secret',
    SR: 'secret',
    AR: 'ultra',
    PROMO: 'promo',
  },
};

function defaultTier(lang: string, rarity: string): Tier {
  return DEFAULT_RARITY_TIERS[lang]?.[rarity] ?? 'unknown';
}

/**
 * Resolve the tier for a (language, rarity) pair. On a miss, the default
 * is inserted into the `rarities` table with `source='default'` so the
 * row is visible to `poke config list rarity-tier` (and the user can
 * override it).
 */
export function tierOf(db: DB, lang: string, rarity: string): Tier {
  const row = db
    .prepare(`SELECT tier FROM rarities WHERE language_code = ? AND rarity_name = ?`)
    .get(lang, rarity) as { tier: Tier } | undefined;
  if (row) return row.tier;
  const seed = defaultTier(lang, rarity);
  db.prepare(
    `INSERT OR IGNORE INTO rarities (language_code, rarity_name, tier, source)
       VALUES (?, ?, ?, 'default')`,
  ).run(lang, rarity, seed);
  return seed;
}

/** User override. Replaces any existing row. */
export function setUserTier(db: DB, lang: string, rarity: string, tier: Tier): void {
  db.prepare(
    `INSERT INTO rarities (language_code, rarity_name, tier, source)
       VALUES (?, ?, ?, 'user')
       ON CONFLICT (language_code, rarity_name) DO UPDATE SET
         tier = excluded.tier,
         source = 'user'`,
  ).run(lang, rarity, tier);
}

export function isTier(value: string): value is Tier {
  return (ALL_TIERS as readonly string[]).includes(value);
}
