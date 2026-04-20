import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { addTagToOwnedById } from '../../src/db/tags.js';
import { runExport } from '../../src/commands/export.js';
import { runImport } from '../../src/commands/import.js';
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

function card(id: string): Card {
  return {
    id,
    name: id,
    number: id.split('-').slice(-1).join(''),
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en' },
  };
}

describe('export → import round-trip', () => {
  it('preserves 3 rows with tags, price, note', async () => {
    const src = openTestDb();
    putCachedCard(src, card('sv4-1'));
    putCachedCard(src, card('sv4-2'));
    putCachedCard(src, card('sv4-3'));

    const a = addOwned(src, { card_id: 'sv4-1', quantity: 2, acquired_price_cents: 1234 });
    addTagToOwnedById(src, a.id, 'grail');
    addTagToOwnedById(src, a.id, 'binder');
    const b = addOwned(src, { card_id: 'sv4-2', note: 'hello, world' });
    void b;
    addOwned(src, { card_id: 'sv4-3', foil: true, condition: 'LP' });

    const csv = await runExport({ db: src, stdout: false });

    const dst = openTestDb();
    putCachedCard(dst, card('sv4-1'));
    putCachedCard(dst, card('sv4-2'));
    putCachedCard(dst, card('sv4-3'));
    const stderr = new Buf();
    const res = await runImport('ignored', { db: dst, text: csv, stderr });
    expect(res.imported).toBe(3);
    expect(res.skipped).toBe(0);

    // Dump the imported state in the same CSV form and compare.
    const csv2 = await runExport({ db: dst, stdout: false });
    expect(csv2).toBe(csv);
  });

  it('import skips unknown columns gracefully when header contains them', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1'));
    const csv = [
      'card_id,quantity,condition,foil,acquired_price,tags,note,extra',
      'sv4-1,1,NM,false,,binder,hi,unused',
    ].join('\n');
    const stderr = new Buf();
    const res = await runImport('x', { db, text: csv, stderr });
    expect(res.imported).toBe(1);
  });

  it('import errors when a required header is missing', async () => {
    const db = openTestDb();
    const csv = 'card_id,quantity\nsv4-1,1\n';
    await expect(runImport('x', { db, text: csv })).rejects.toThrow(/header missing/);
  });
});
