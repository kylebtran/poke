import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { runList } from '../../src/commands/list.js';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
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

const charizard: Card = {
  id: 'sv4-23',
  name: 'Charizard ex',
  number: '23',
  rarity: 'Double Rare',
  language_code: 'en',
  set: { id: 'sv4', name: 'Paradox Rift', language_code: 'en' },
};

const pineco: Card = {
  id: 'sv10_ja-1',
  name: 'クヌギダマ',
  number: '1',
  rarity: '通常',
  language_code: 'ja',
  set: { id: 'sv10_ja', name: 'Mega Brave', language_code: 'ja' },
};

function seedTwo(db = openTestDb()) {
  putCachedCard(db, charizard);
  putCachedCard(db, pineco);
  addOwned(db, { card_id: 'sv4-23' });
  addOwned(db, { card_id: 'sv10_ja-1' });
  return db;
}

describe('poke list', () => {
  it('NDJSON when stdout is not a TTY — one record per owned row', async () => {
    const db = seedTwo();
    const out = new Buf();
    await runList({ db, out, format: 'ndjson' });
    const lines = out.text().trim().split('\n');
    expect(lines).toHaveLength(2);
    const records = lines.map((l) => JSON.parse(l));
    expect(records.map((r) => r.id).sort()).toEqual(['sv10_ja-1', 'sv4-23']);
    for (const r of records) {
      expect(r._schema).toBe('poke.card/v1');
      expect(r.owned.quantity).toBe(1);
      expect(r.price).toBeNull();
    }
  });

  it('--set filter narrows to one record', async () => {
    const db = seedTwo();
    const out = new Buf();
    await runList({ db, out, format: 'ndjson', set_id: 'sv4' });
    const lines = out.text().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).id).toBe('sv4-23');
  });

  it('--lang ja filter', async () => {
    const db = seedTwo();
    const out = new Buf();
    await runList({ db, out, format: 'ndjson', language: 'ja' });
    const records = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(1);
    expect(records[0].lang).toBe('ja');
  });

  it('empty collection with format=table prints placeholder', async () => {
    const db = openTestDb();
    const out = new Buf();
    await runList({ db, out, format: 'table', noColor: true });
    expect(out.text().trim()).toBe('no owned cards match');
  });

  it('--json emits a single JSON array line', async () => {
    const db = seedTwo();
    const out = new Buf();
    await runList({ db, out, json: true });
    const text = out.text().trim();
    expect(text.startsWith('[')).toBe(true);
    expect(text.endsWith(']')).toBe(true);
    const arr = JSON.parse(text);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
  });
});
