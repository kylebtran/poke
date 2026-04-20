import type { DB } from './migrate.js';
import type { Card, Set as PokeSet } from '../scrydex/schemas.js';

/**
 * Local cache for Scrydex catalog data (cards, sets). Price snapshots
 * live in their own table and are handled by `src/scrydex/prices.ts`
 * in phase 8. Staleness decisions are made against `fetched_at`.
 */

export const TTL = {
  CARD_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  SET_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export interface CachedCardRow {
  id: string;
  language_code: string;
  set_id: string;
  data: Card;
  fetched_at: string;
}

export interface CachedSetRow {
  id: string;
  language_code: string;
  data: PokeSet;
  fetched_at: string;
}

export function getCachedCard(db: DB, id: string): CachedCardRow | undefined {
  const row = db
    .prepare(`SELECT id, language_code, set_id, data, fetched_at FROM cards WHERE id = ?`)
    .get(id) as
    | { id: string; language_code: string; set_id: string; data: string; fetched_at: string }
    | undefined;
  if (!row) return undefined;
  return { ...row, data: JSON.parse(row.data) as Card };
}

export function putCachedCard(db: DB, card: Card, fetchedAt: Date = new Date()): void {
  const setId = card.set?.id ?? card.set_id ?? inferSetId(card.id);
  const lang = card.language_code ?? card.set?.language_code ?? inferLang(setId) ?? 'en';
  const iso = fetchedAt.toISOString();
  db.prepare(
    `INSERT INTO cards (id, language_code, set_id, data, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         language_code=excluded.language_code,
         set_id=excluded.set_id,
         data=excluded.data,
         fetched_at=excluded.fetched_at`,
  ).run(card.id, lang, setId, JSON.stringify(card), iso);
}

export function getCachedSet(db: DB, id: string): CachedSetRow | undefined {
  const row = db
    .prepare(`SELECT id, language_code, data, fetched_at FROM sets WHERE id = ?`)
    .get(id) as { id: string; language_code: string; data: string; fetched_at: string } | undefined;
  if (!row) return undefined;
  return { ...row, data: JSON.parse(row.data) as PokeSet };
}

export function putCachedSet(db: DB, set: PokeSet, fetchedAt: Date = new Date()): void {
  const lang = set.language_code ?? inferLang(set.id) ?? 'en';
  db.prepare(
    `INSERT INTO sets (id, language_code, data, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         language_code=excluded.language_code,
         data=excluded.data,
         fetched_at=excluded.fetched_at`,
  ).run(set.id, lang, JSON.stringify(set), fetchedAt.toISOString());
}

/** True if `fetchedAt` (ISO string) is older than `ttlMs` relative to `now`. */
export function isStale(
  fetchedAt: string,
  ttlMs: number,
  now: Date = new Date(),
): boolean {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > ttlMs;
}

function inferSetId(cardId: string): string {
  const idx = cardId.lastIndexOf('-');
  return idx > 0 ? cardId.slice(0, idx) : cardId;
}

function inferLang(setId: string): string | undefined {
  if (setId.endsWith('_ja')) return 'ja';
  if (setId.endsWith('_en')) return 'en';
  return undefined;
}
