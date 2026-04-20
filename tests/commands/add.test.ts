import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { runAdd } from '../../src/commands/add.js';
import { openTestDb } from '../helpers/db.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { putCachedCard } from '../../src/db/cache.js';
import { listOwned, totalQuantityFor } from '../../src/db/collection.js';
import type { Card } from '../../src/scrydex/schemas.js';

class Buf extends Writable {
  chunks: string[] = [];
  override _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(c.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

function clientFromFixture(fixture: string, match: string): ScrydexClient {
  const { fetch } = mockFetch([{ match, fixture }]);
  return new ScrydexClient({
    api_key: 'k',
    team_id: 't',
    fetch,
    baseUrl: 'https://api.example.test/pokemon/v1/',
  });
}

const charizard: Card = {
  id: 'sv4-23',
  name: 'Charizard ex',
  number: '23',
  rarity: 'Double Rare',
  language_code: 'en',
  set: { id: 'sv4', name: 'Paradox Rift', language_code: 'en' },
};

describe('poke add', () => {
  it('adds a cached card with quantity', async () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    const out = new Buf();
    const client = clientFromFixture('card-sv4-23.json', '/cards/sv4-23');
    await runAdd('sv4-23', { qty: 2, db, client, out });
    expect(totalQuantityFor(db, 'sv4-23')).toBe(2);
    const lines = out.text().trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record.owned.quantity).toBe(2);
  });

  it('uses DB when <set>:<number> resolves locally', async () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    // Mock returns an unrelated 599 for any URL — asserts no network.
    const { fetch, calls } = mockFetch([]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const out = new Buf();
    await runAdd('sv4:23', { db, client, out });
    expect(calls).toHaveLength(0);
    expect(totalQuantityFor(db, 'sv4-23')).toBe(1);
  });

  it('resolves <set>:<number> via search when not cached', async () => {
    const db = openTestDb();
    const { fetch, calls } = mockFetch([
      {
        match: 'q=set.id',
        body: {
          data: [charizard],
          total_count: 1,
          page: 1,
          page_size: 2,
        },
      },
    ]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    await runAdd('sv4:23', { db, client, out: new Buf() });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(listOwned(db)).toHaveLength(1);
    expect(listOwned(db)[0]!.card_id).toBe('sv4-23');
  });

  it('stores price in cents', async () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    const client = clientFromFixture('card-sv4-23.json', '/cards/sv4-23');
    await runAdd('sv4-23', { price: 12.34, db, client, out: new Buf() });
    const row = listOwned(db)[0]!;
    expect(row.acquired_price_cents).toBe(1234);
  });
});
