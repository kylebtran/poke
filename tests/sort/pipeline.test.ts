import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { runSort } from '../../src/commands/sort.js';
import { SCHEMA_ID, type CardRecord } from '../../src/domain/card.js';

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

function mk(id: string, market: number | null, name: string): CardRecord {
  const base: CardRecord = {
    _schema: SCHEMA_ID,
    id,
    name,
    set_id: 'sv4',
    lang: 'en',
    owned: { quantity: 1, condition: 'NM', foil: false, tags: [] },
    price: null,
  };
  if (market !== null) {
    base.price = {
      currency: 'USD',
      market,
      source: 'tcgplayer',
      fetched_at: '2026-04-20T00:00:00Z',
    };
  }
  return base;
}

function stream(...items: CardRecord[]): Readable {
  return Readable.from(Buffer.from(items.map((i) => JSON.stringify(i)).join('\n') + '\n'));
}

describe('runSort', () => {
  it('sorts by numeric field ascending', async () => {
    const stdin = stream(mk('a', 20, 'A'), mk('b', 10, 'B'), mk('c', 30, 'C'));
    const out = new Buf();
    await runSort({ by: 'price.market', stdin, out, format: 'ndjson' });
    const ids = out.text().trim().split('\n').map((l) => JSON.parse(l).id);
    expect(ids).toEqual(['b', 'a', 'c']);
  });

  it('--desc flips order', async () => {
    const stdin = stream(mk('a', 20, 'A'), mk('b', 10, 'B'));
    const out = new Buf();
    await runSort({ by: 'price.market', desc: true, stdin, out, format: 'ndjson' });
    const ids = out.text().trim().split('\n').map((l) => JSON.parse(l).id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('puts nulls last in both directions', async () => {
    const stdin = stream(mk('a', 20, 'A'), mk('b', null, 'B'), mk('c', 10, 'C'));
    const out = new Buf();
    await runSort({ by: 'price.market', stdin, out, format: 'ndjson' });
    const ids = out.text().trim().split('\n').map((l) => JSON.parse(l).id);
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('locale-compares strings', async () => {
    const stdin = stream(mk('a', 10, 'banana'), mk('b', 10, 'apple'));
    const out = new Buf();
    await runSort({ by: 'name', stdin, out, format: 'ndjson' });
    const names = out.text().trim().split('\n').map((l) => JSON.parse(l).name);
    expect(names).toEqual(['apple', 'banana']);
  });
});
