import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { putCachedCard } from '../../src/db/cache.js';
import { ensurePricesFresh, BATCH_SIZE } from '../../src/scrydex/prices.js';
import type { Card } from '../../src/scrydex/schemas.js';

function card(id: string, market: number): Card {
  return {
    id,
    name: id,
    number: id.split('-').slice(-1).join(''),
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en' },
    prices: {
      market,
      currency: 'USD',
      source: 'tcgplayer',
    },
  };
}

function makeClient(fetchFn: typeof fetch): ScrydexClient {
  return new ScrydexClient({
    api_key: 'k',
    team_id: 't',
    fetch: fetchFn,
    baseUrl: 'https://api.example.test/pokemon/v1/',
  });
}

describe('ensurePricesFresh', () => {
  it('fetches when no snapshot exists, persists to DB', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 10));
    const { fetch, calls } = mockFetch([
      {
        match: '/cards?q=',
        body: { data: [card('sv4-1', 10)], total_count: 1, page: 1, page_size: 50 },
      },
    ]);
    const result = await ensurePricesFresh(db, makeClient(fetch), ['sv4-1']);
    expect(calls).toHaveLength(1);
    const snap = result.get('sv4-1')!;
    expect(snap.market_cents).toBe(1000);
    // Persisted.
    const row = db
      .prepare(`SELECT raw_market_cents FROM price_snapshots WHERE card_id = ?`)
      .get('sv4-1') as { raw_market_cents: number } | undefined;
    expect(row?.raw_market_cents).toBe(1000);
  });

  it('chunks ids by BATCH_SIZE', async () => {
    const db = openTestDb();
    const ids: string[] = [];
    const cards: Card[] = [];
    for (let i = 1; i <= 120; i++) {
      const c = card(`sv4-${i}`, i);
      putCachedCard(db, c);
      cards.push(c);
      ids.push(c.id);
    }
    let requestN = 0;
    const { fetch, calls } = mockFetch([
      {
        match: '/cards?q=',
        // We use a custom body per call via `body` but mockFetch can't
        // introspect the call — we just return a superset and accept that
        // ensurePricesFresh keeps its own bookkeeping via card.id.
        body: { data: cards, total_count: cards.length, page: 1, page_size: 120 },
      },
    ]);
    void requestN;
    await ensurePricesFresh(db, makeClient(fetch), ids);
    // 120 ids / 50 per batch → 3 chunks → 3 HTTP calls.
    expect(calls).toHaveLength(Math.ceil(ids.length / BATCH_SIZE));
  });

  it('respects TTL — fresh snapshot avoids network', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 10));
    const { fetch, calls } = mockFetch([
      {
        match: '/cards?q=',
        body: { data: [card('sv4-1', 10)], total_count: 1, page: 1, page_size: 50 },
      },
    ]);
    const client = makeClient(fetch);
    await ensurePricesFresh(db, client, ['sv4-1']); // fetch #1
    await ensurePricesFresh(db, client, ['sv4-1']); // cached within TTL
    expect(calls).toHaveLength(1);
  });

  it('noRefresh returns stale snapshot without fetching', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 10));
    // Seed a snapshot with a 10-year-old fetched_at.
    db.prepare(
      `INSERT INTO price_snapshots (card_id, fetched_at, currency, raw_market_cents, source)
         VALUES (?, ?, ?, ?, ?)`,
    ).run('sv4-1', '2016-01-01T00:00:00Z', 'USD', 500, 'tcgplayer');
    const { fetch, calls } = mockFetch([]);
    const result = await ensurePricesFresh(db, makeClient(fetch), ['sv4-1'], { noRefresh: true });
    expect(calls).toHaveLength(0);
    const snap = result.get('sv4-1')!;
    expect(snap.stale).toBe(true);
    expect(snap.market_cents).toBe(500);
  });

  it('handles null market gracefully', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 10));
    const withoutMarket: Card = {
      id: 'sv4-1',
      name: 'x',
      language_code: 'en',
      set: { id: 'sv4', language_code: 'en' },
      prices: { currency: 'USD', source: 'tcgplayer' },
    };
    const { fetch } = mockFetch([{ match: '/cards?q=', body: { data: [withoutMarket] } }]);
    const result = await ensurePricesFresh(db, makeClient(fetch), ['sv4-1']);
    expect(result.get('sv4-1')!.market_cents).toBeNull();
  });
});
