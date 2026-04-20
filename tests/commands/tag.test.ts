import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { runTagOne, runTagStream } from '../../src/commands/tag.js';
import { tagsForCardId } from '../../src/db/tags.js';
import { toRecord } from '../../src/commands/list.js';
import { listOwned } from '../../src/db/collection.js';
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

function card(id: string, rarity = 'Rare'): Card {
  return {
    id,
    name: id,
    number: id.split('-').slice(-1).join(''),
    rarity,
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en' },
  };
}

describe('runTagOne (arg mode)', () => {
  it('tags and untags a card', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1'));
    addOwned(db, { card_id: 'sv4-1' });
    const stderr = new Buf();
    await runTagOne('sv4-1', 'grail', { db, stderr });
    expect(tagsForCardId(db, 'sv4-1')).toEqual(['grail']);
    await runTagOne('sv4-1', 'grail', { db, remove: true, stderr });
    expect(tagsForCardId(db, 'sv4-1')).toEqual([]);
    expect(stderr.text()).toContain("tagged 'grail'");
    expect(stderr.text()).toContain("removed tag 'grail'");
  });
});

describe('runTagStream', () => {
  function stream(records: unknown[]): Readable {
    const lines = records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n');
    return Readable.from(Buffer.from(lines + '\n'));
  }

  it('tags every record read from stdin; reports summary', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1'));
    putCachedCard(db, card('sv4-2'));
    addOwned(db, { card_id: 'sv4-1' });
    addOwned(db, { card_id: 'sv4-2' });
    const listed = listOwned(db).map(toRecord);
    const stderr = new Buf();
    const stats = await runTagStream({
      add: 'grail',
      stdin: stream(listed),
      stderr,
      db,
    });
    expect(stats.tagged).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stderr.text()).toContain('tagged 2, skipped 0');
    expect(tagsForCardId(db, 'sv4-1')).toEqual(['grail']);
    expect(tagsForCardId(db, 'sv4-2')).toEqual(['grail']);
  });

  it('skips unknown card_ids but continues', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1'));
    addOwned(db, { card_id: 'sv4-1' });
    const listed = listOwned(db).map(toRecord);
    // Add an NDJSON line whose card_id has no owned rows.
    const orphan = {
      _schema: 'poke.card/v1',
      id: 'sv4-999',
      name: 'orphan',
      set_id: 'sv4',
      lang: 'en',
    };
    const stderr = new Buf();
    const stats = await runTagStream({
      add: 'grail',
      stdin: stream([...listed, orphan]),
      stderr,
      db,
    });
    expect(stats.tagged).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stderr.text()).toContain('skip sv4-999');
    expect(stderr.text()).toContain('tagged 1, skipped 1');
  });

  it('handles malformed lines via graceful degradation', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1'));
    addOwned(db, { card_id: 'sv4-1' });
    const listed = listOwned(db).map(toRecord);
    const stderr = new Buf();
    const stats = await runTagStream({
      add: 'grail',
      stdin: stream(['not-json', ...listed, '{"not":"a record"}']),
      stderr,
      db,
    });
    expect(stats.tagged).toBe(1);
    expect(stats.malformed).toBe(2);
    expect(stderr.text()).toContain('skipped 2 malformed records');
  });
});
