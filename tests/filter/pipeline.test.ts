import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { runFilter } from '../../src/commands/filter.js';
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

function mk(tier: string, id: string): CardRecord {
  return {
    _schema: SCHEMA_ID,
    id,
    name: `card-${id}`,
    set_id: 'sv4',
    lang: 'en',
    tier,
    owned: { quantity: 1, condition: 'NM', foil: false, tags: [] },
    price: {
      currency: 'USD',
      market: 10,
      source: 'tcgplayer',
      fetched_at: '2026-04-20T00:00:00Z',
    },
  };
}

function stream(...items: unknown[]): Readable {
  const lines = items.map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).join('\n');
  return Readable.from(Buffer.from(lines + '\n'));
}

describe('runFilter stdin pipeline', () => {
  it('keeps matching records and drops others', async () => {
    const stdin = stream(mk('secret', 'a'), mk('rare', 'b'), mk('secret', 'c'));
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('tier=secret', { stdin, out, stderr, format: 'ndjson' });
    expect(stats.kept).toBe(2);
    expect(stats.dropped).toBe(1);
    const lines = out.text().trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['a', 'c']);
    expect(stderr.text()).toBe('');
  });

  it('warns once for malformed lines and continues', async () => {
    const stdin = stream('not-json', mk('rare', 'b'), '{"noschema": true}');
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('tier=rare', { stdin, out, stderr, format: 'ndjson' });
    expect(stats.kept).toBe(1);
    expect(stats.malformed).toBe(2);
    expect(stderr.text()).toContain('skipped 2 malformed');
    // Exit status is 0 — stream degradation is not a crash.
  });

  it('value alias filters correctly', async () => {
    // price 10 × quantity 1 = 10; predicate "value>=10" keeps both.
    const stdin = stream(mk('rare', 'a'), mk('rare', 'b'));
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('value>=10', { stdin, out, stderr, format: 'ndjson' });
    expect(stats.kept).toBe(2);
  });
});
