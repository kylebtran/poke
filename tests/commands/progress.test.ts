import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard, putCachedSet } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { runProgress } from '../../src/commands/progress.js';
import { runSet } from '../../src/commands/set.js';
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

function card(id: string, rarity: string): Card {
  return {
    id,
    name: id,
    number: id.split('-').slice(-1).join(''),
    rarity,
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en', name: 'Paradox Rift' },
  };
}

function seed() {
  const db = openTestDb();
  putCachedSet(db, { id: 'sv4', name: 'Paradox Rift', language_code: 'en', total: 3 });
  putCachedCard(db, card('sv4-1', 'Common'));
  putCachedCard(db, card('sv4-2', 'Rare'));
  putCachedCard(db, card('sv4-3', 'Special Illustration Rare'));
  addOwned(db, { card_id: 'sv4-1' });
  addOwned(db, { card_id: 'sv4-3' });
  return db;
}

describe('poke progress', () => {
  it('TTY-style line includes set name, bar, totals, segments', async () => {
    const db = seed();
    const out = new Buf();
    await runProgress({ set_id: 'sv4', db, out, format: 'table', noColor: true });
    const line = out.text().trim();
    expect(line).toContain('sv4');
    expect(line).toContain('Paradox Rift');
    expect(line).toContain('2/3');
    expect(line).toContain('(67%)');
    expect(line).toContain('Common 1/1');
    expect(line).toContain('Rare 0/1');
    expect(line).toContain('Special Illustration Rare 1/1');
    expect(line).toMatch(/[█]+[░]+/);
  });

  it('NDJSON mode emits one record per bucket', async () => {
    const db = seed();
    const out = new Buf();
    await runProgress({ set_id: 'sv4', db, out, format: 'ndjson' });
    const records = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r._schema).toBe('poke.progress/v1');
      expect(r.set_id).toBe('sv4');
    }
  });

  it('by=tier regroups', async () => {
    const db = seed();
    const out = new Buf();
    await runProgress({ set_id: 'sv4', db, out, by: 'tier', format: 'ndjson' });
    const records = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const byKey = Object.fromEntries(records.map((r) => [r.key, r]));
    expect(byKey.common.owned).toBe(1);
    expect(byKey.rare.owned).toBe(0);
    expect(byKey.secret.owned).toBe(1);
  });
});

describe('poke set', () => {
  it('emits one NDJSON record per rarity', async () => {
    const db = seed();
    const out = new Buf();
    await runSet('sv4', { db, out, format: 'ndjson' });
    const records = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r._schema).toBe('poke.setprogress/v1');
      expect(r.set_id).toBe('sv4');
    }
  });
});
