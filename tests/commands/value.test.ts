import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runValue } from '../../src/commands/value.js';
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

function inputs(...items: CardRecord[]) {
  return [{ label: '<test>', stream: stream(...items) }];
}

describe('runValue pure reducer', () => {
  it('sums market * quantity, counts unavailable', async () => {
    const out = new Buf();
    await runValue({
      inputs: inputs(mk('a', 10, 2), mk('b', 5, 1), mk('c', null, 3)),
      out,
      format: 'ndjson',
    });
    const record = JSON.parse(out.text().trim());
    expect(record._schema).toBe('poke.value/v1');
    expect(record.total_cents).toBe(10 * 100 * 2 + 5 * 100 * 1);
    expect(record.unavailable).toBe(1);
    expect(record.n_cards).toBe(3);
  });

  it('--group-by set buckets correctly', async () => {
    const out = new Buf();
    await runValue({
      inputs: inputs(mk('a', 10, 1, 'sv4'), mk('b', 5, 1, 'sv4'), mk('c', 20, 1, 'sv10_ja')),
      out,
      groupBy: 'set',
      format: 'ndjson',
    });
    const records = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(2);
    const bySet = Object.fromEntries(records.map((r) => [r.group, r]));
    expect(bySet.sv4.total_cents).toBe(1500);
    expect(bySet.sv10_ja.total_cents).toBe(2000);
  });

  it('empty stream yields $0 total with 0 cards', async () => {
    const out = new Buf();
    await runValue({ inputs: inputs(), out, format: 'ndjson' });
    const record = JSON.parse(out.text().trim());
    expect(record.total_cents).toBe(0);
    expect(record.n_cards).toBe(0);
  });
});

describe('runValue file arguments', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'poke-value-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads records from a named file', async () => {
    const path = join(tmp, 'input.ndjson');
    writeFileSync(
      path,
      [mk('a', 10, 2), mk('b', 5, 1)].map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    const out = new Buf();
    await runValue({ files: [path], out, format: 'ndjson' });
    const record = JSON.parse(out.text().trim());
    expect(record.total_cents).toBe(2500);
  });
});
