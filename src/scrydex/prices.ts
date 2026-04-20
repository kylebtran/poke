import type { ScrydexClient } from './client.js';
import { searchCards } from './cards.js';
import type { DB } from '../db/migrate.js';
import type { Card } from './schemas.js';
import { load } from '../config/settings.js';

/**
 * Price batching + auto-refresh (spec §7).
 *
 * - `BATCH_SIZE` stale ids per Scrydex search query (`id:(a OR b OR ...)`).
 * - Single transaction per chunk when persisting snapshots.
 * - `ensurePricesFresh` is the entry point any price-rendering command
 *   calls before materializing its output.
 */

export const BATCH_SIZE = 50;

export interface PriceSnapshot {
  card_id: string;
  fetched_at: string;
  currency: string;
  market_cents: number | null;
  low_cents: number | null;
  mid_cents: number | null;
  high_cents: number | null;
  source: string;
  stale?: boolean;
}

export interface EnsureOptions {
  ttlMs?: number;
  noRefresh?: boolean;
  lang?: string;
  /** Treat every id as stale regardless of TTL. */
  force?: boolean;
  /** Progress callback (e.g. for ora spinner). */
  onBatch?: (chunk: number, chunks: number) => void;
}

/**
 * Return a map of card_id → latest snapshot. When a snapshot is missing
 * or stale, and `noRefresh` is false, a batched Scrydex call is made and
 * new snapshots are persisted.
 */
export async function ensurePricesFresh(
  db: DB,
  client: ScrydexClient | null,
  ids: readonly string[],
  opts: EnsureOptions = {},
): Promise<Map<string, PriceSnapshot | null>> {
  const ttlMs = opts.ttlMs ?? defaultPriceTtlMs();
  const result = new Map<string, PriceSnapshot | null>();
  if (ids.length === 0) return result;

  // Load current latest snapshots for every id.
  const latest = loadLatestSnapshots(db, ids);

  const stale: string[] = [];
  const now = Date.now();
  for (const id of ids) {
    const snap = latest.get(id) ?? null;
    if (opts.force || snap === null || isStaleAt(snap.fetched_at, ttlMs, now)) {
      stale.push(id);
      result.set(id, snap ? { ...snap, stale: true } : null);
    } else {
      result.set(id, snap);
    }
  }

  if (opts.noRefresh || stale.length === 0 || client === null) {
    return result;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    chunks.push(stale.slice(i, i + BATCH_SIZE));
  }

  const fetchedAt = new Date().toISOString();
  let chunkIdx = 0;
  for (const chunk of chunks) {
    chunkIdx++;
    opts.onBatch?.(chunkIdx, chunks.length);
    const q = `id:(${chunk.join(' OR ')})`;
    const cards = await searchCards(client, q, {
      ...(opts.lang ? { lang: opts.lang } : {}),
      limit: chunk.length,
      include: 'prices',
    });
    persistSnapshots(db, cards, fetchedAt);
    // Update the result map with fresh values.
    for (const c of cards) {
      const snap = toSnapshot(c, fetchedAt);
      result.set(c.id, snap);
    }
  }

  // Any id we tried to refresh but got no card back stays with its old
  // (stale) snapshot in `result`. Callers render "(stale)" or "—".
  return result;
}

/** Load the latest snapshot per card_id (one DB round-trip). */
function loadLatestSnapshots(db: DB, ids: readonly string[]): Map<string, PriceSnapshot> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.card_id, p.fetched_at, p.currency, p.raw_market_cents,
              p.raw_low_cents, p.raw_mid_cents, p.raw_high_cents, p.source
         FROM price_snapshots p
         JOIN (
           SELECT card_id, MAX(fetched_at) AS max_f
             FROM price_snapshots
             WHERE card_id IN (${placeholders})
             GROUP BY card_id
         ) latest ON latest.card_id = p.card_id AND latest.max_f = p.fetched_at`,
    )
    .all(...(ids as string[])) as {
    card_id: string;
    fetched_at: string;
    currency: string;
    raw_market_cents: number | null;
    raw_low_cents: number | null;
    raw_mid_cents: number | null;
    raw_high_cents: number | null;
    source: string;
  }[];
  const out = new Map<string, PriceSnapshot>();
  for (const r of rows) {
    out.set(r.card_id, {
      card_id: r.card_id,
      fetched_at: r.fetched_at,
      currency: r.currency,
      market_cents: r.raw_market_cents,
      low_cents: r.raw_low_cents,
      mid_cents: r.raw_mid_cents,
      high_cents: r.raw_high_cents,
      source: r.source,
    });
  }
  return out;
}

function persistSnapshots(db: DB, cards: Card[], fetchedAt: string): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO price_snapshots
       (card_id, fetched_at, currency, raw_market_cents, raw_low_cents,
        raw_mid_cents, raw_high_cents, graded_psa10_cents, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: Card[]) => {
    for (const c of items) {
      const snap = toSnapshot(c, fetchedAt);
      insert.run(
        c.id,
        fetchedAt,
        snap.currency,
        snap.market_cents,
        snap.low_cents,
        snap.mid_cents,
        snap.high_cents,
        null, // graded PSA10 — not mapped yet
        snap.source,
      );
    }
  });
  tx(cards);
}

function toSnapshot(card: Card, fetchedAt: string): PriceSnapshot {
  const tcg = card.prices?.tcgplayer ?? card.prices;
  const currency = String(tcg?.currency ?? card.prices?.currency ?? 'USD');
  const source = String(tcg?.source ?? card.prices?.source ?? 'tcgplayer');
  return {
    card_id: card.id,
    fetched_at: fetchedAt,
    currency,
    market_cents: toCents(tcg?.market ?? card.prices?.market),
    low_cents: toCents(tcg?.low ?? card.prices?.low),
    mid_cents: toCents(tcg?.mid ?? card.prices?.mid),
    high_cents: toCents(tcg?.high ?? card.prices?.high),
    source,
  };
}

function toCents(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function isStaleAt(fetchedAt: string, ttlMs: number, now: number): boolean {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > ttlMs;
}

function defaultPriceTtlMs(): number {
  const hours = load().price_ttl_hours;
  return hours * 60 * 60 * 1000;
}

/** Return snapshot.market_cents expressed as dollars, or null. */
export function marketDollars(snap: PriceSnapshot | null | undefined): number | null {
  if (!snap || snap.market_cents === null) return null;
  return snap.market_cents / 100;
}

/** Helper for list/value to build the record `price` block. */
export function snapshotToRecordPrice(snap: PriceSnapshot | null): {
  currency: string;
  market: number | null;
  source: string;
  fetched_at: string;
  stale?: boolean;
} | null {
  if (!snap) return null;
  return {
    currency: snap.currency,
    market: snap.market_cents === null ? null : snap.market_cents / 100,
    source: snap.source,
    fetched_at: snap.fetched_at,
    ...(snap.stale ? { stale: true } : {}),
  };
}
