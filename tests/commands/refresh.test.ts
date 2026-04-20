import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { runRefresh } from '../../src/commands/refresh.js';
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

function card(id: string, market: number): Card {
  return {
    id,
    name: id,
    number: id.split('-').slice(-1).join(''),
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en' },
    prices: { market, currency: 'USD', source: 'tcgplayer' },
  };
}

describe('runRefresh', () => {
  it('prices: issues one batch per 50 owned ids', async () => {
    const db = openTestDb();
    const cards: Card[] = [];
    for (let i = 1; i <= 60; i++) {
      const c = card(`sv4-${i}`, i);
      putCachedCard(db, c);
      addOwned(db, { card_id: c.id });
      cards.push(c);
    }
    const { fetch, calls } = mockFetch([
      { match: '/cards?q=', body: { data: cards } },
    ]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const stderr = new Buf();
    await runRefresh({ prices: true, db, client, stderr });
    // Two batches (50 + 10).
    expect(calls).toHaveLength(2);
  });

  it('refuses without a flag', async () => {
    const db = openTestDb();
    const { fetch } = mockFetch([]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    await expect(runRefresh({ db, client })).rejects.toThrow(/--prices/);
  });
});
