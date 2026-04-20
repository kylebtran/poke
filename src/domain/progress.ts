import type { DB } from '../db/migrate.js';
import { tierOf, type Tier } from './rarity.js';

/**
 * Progress math: for a given set, count owned distinct cards by rarity
 * (and by tier). "Distinct" means "how many unique card_ids in
 * owned_cards whose cards.set_id = <set>" — we do not count quantity
 * here, since a player having 5 copies of one card is not "5 of 10"
 * completion.
 */

export interface Bucket {
  owned: number;
  total: number;
}

export interface ProgressByKey {
  set_id: string;
  language: string;
  by: 'rarity' | 'tier';
  totals: Record<string, Bucket>;
  grand: Bucket;
}

export function computeProgress(
  db: DB,
  opts: { set_id: string; by: 'rarity' | 'tier' },
): ProgressByKey {
  // Determine language from the cached set or a representative card.
  const lang = languageOfSet(db, opts.set_id);
  // Totals from cards table.
  const cards = db
    .prepare(
      `SELECT id, json_extract(data, '$.rarity') AS rarity
         FROM cards WHERE set_id = ?`,
    )
    .all(opts.set_id) as { id: string; rarity: string | null }[];

  const totals: Record<string, Bucket> = {};
  for (const c of cards) {
    const r = c.rarity ?? 'Unknown';
    const key = opts.by === 'tier' ? (tierOf(db, lang, r) as string) : r;
    if (!totals[key]) totals[key] = { owned: 0, total: 0 };
    totals[key]!.total++;
  }

  // Owned distinct ids.
  const ownedIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT o.card_id FROM owned_cards o
           JOIN cards c ON c.id = o.card_id
           WHERE c.set_id = ?`,
        )
        .all(opts.set_id) as { card_id: string }[]
    ).map((r) => r.card_id),
  );

  for (const c of cards) {
    if (!ownedIds.has(c.id)) continue;
    const r = c.rarity ?? 'Unknown';
    const key = opts.by === 'tier' ? (tierOf(db, lang, r) as string) : r;
    if (!totals[key]) totals[key] = { owned: 0, total: 0 };
    totals[key]!.owned++;
  }

  const grand: Bucket = { owned: 0, total: 0 };
  for (const b of Object.values(totals)) {
    grand.owned += b.owned;
    grand.total += b.total;
  }
  return { set_id: opts.set_id, language: lang, by: opts.by, totals, grand };
}

export function languageOfSet(db: DB, set_id: string): string {
  const s = db.prepare(`SELECT language_code FROM sets WHERE id = ?`).get(set_id) as
    | { language_code: string }
    | undefined;
  if (s) return s.language_code;
  const c = db.prepare(`SELECT language_code FROM cards WHERE set_id = ? LIMIT 1`).get(set_id) as
    | { language_code: string }
    | undefined;
  if (c) return c.language_code;
  if (set_id.endsWith('_ja')) return 'ja';
  return 'en';
}

/** Stable tier ordering for display. */
export function sortedTierKeys(totals: Record<string, Bucket>): string[] {
  const ORDER: Tier[] = ['common', 'uncommon', 'rare', 'ultra', 'secret', 'promo', 'unknown'];
  const keys = Object.keys(totals);
  return keys.sort((a, b) => {
    const ai = ORDER.indexOf(a as Tier);
    const bi = ORDER.indexOf(b as Tier);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });
}
