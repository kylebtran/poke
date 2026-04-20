import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { runValue } from '../../src/commands/value.js';
import { SCHEMA_ID, type CardRecord } from '../../src/domain/card.js';
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

function mk(id: string, market: number | null, qty = 1, set_id = 'sv4'): CardRecord {
  const rec: CardRecord = {
    _schema: SCHEMA_ID,
    id,
    name: id,
    set_id,
    lang: 'en',
    rarity: 'Rare',
    owned: { quantity: qty, condition: 'NM', foil: false, tags: [] },
    price: null,
  };
  if (market !== null) {
    rec.price = {
      currency: 'USD',
      market,
      source: 'tcgplayer',
      fetched_at: '2026-04-20T00:00:00Z',
    };
  }
  return rec;
}

function stream(...items: CardRecord[]): Readable {
  return Readable.from(Buffer.from(items.map((i) => JSON.stringify(i)).join('\n') + '\n'));
}

describe('runValue with stdin', () => {
  it('sums market * quantity, counts unavailable', async () => {
    const stdin = stream(mk('a', 10, 2), mk('b', 5, 1), mk('c', null, 3));
    const out = new Buf();
    await runValue({ stdin, out, format: 'ndjson' });
    const line = out.text().trim();
    const record = JSON.parse(line);
    expect(record._schema).toBe('poke.value/v1');
    expect(record.total_cents).toBe(10 * 100 * 2 + 5 * 100 * 1);
    expect(record.unavailable).toBe(1);
    expect(record.n_cards).toBe(3);
  });

  it('--group-by set buckets correctly', async () => {
    const stdin = stream(
      mk('a', 10, 1, 'sv4'),
      mk('b', 5, 1, 'sv4'),
      mk('c', 20, 1, 'sv10_ja'),
    );
    const out = new Buf();
    await runValue({ stdin, out, groupBy: 'set', format: 'ndjson' });
    const records = out.text().trim().split('\n').map((l) => JSON.parse(l));
    expect(records).toHaveLength(2);
    const bySet = Object.fromEntries(records.map((r) => [r.group, r]));
    expect(bySet.sv4.total_cents).toBe(1500);
    expect(bySet.sv10_ja.total_cents).toBe(2000);
  });
});

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

describe('runValue with no stdin (reads DB)', () => {
  it('values the full collection via auto-refresh', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 10));
    addOwned(db, { card_id: 'sv4-1', quantity: 2 });
    const { fetch, calls } = mockFetch([
      {
        match: '/cards?q=',
        body: { data: [card('sv4-1', 10)] },
      },
    ]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const out = new Buf();
    // Force `collect` into the DB path by setting process.stdin.isTTY=true
    // effectively — we pass `stdin: undefined` and rely on the fact that
    // vitest runs without a TTY. Actually under vitest process.stdin has
    // isTTY undefined, so the code path auto-picks "readStdinRecords".
    // The cleanest fix is to hand the command an empty stdin placeholder
    // NOT via opts.stdin (which would route to readStdinRecords). Instead
    // we monkey-patch process.stdin.isTTY for this test.
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await runValue({ db, client, out, format: 'ndjson' });
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
    }
    const record = JSON.parse(out.text().trim());
    expect(record.total_cents).toBe(2000); // $10 * 2
    expect(calls).toHaveLength(1);
  });
});
