import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { runList } from '../../src/commands/list.js';
import { runProgress } from '../../src/commands/progress.js';
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
    set: { id: 'sv4', language_code: 'en' },
  };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[/;

describe('color routing', () => {
  it('list: ANSI present when color=true, absent when color=false', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 'Common'));
    addOwned(db, { card_id: 'sv4-1' });

    const on = new Buf();
    await runList({ db, out: on, format: 'table', color: true });
    expect(ANSI.test(on.text())).toBe(true);

    const off = new Buf();
    await runList({ db, out: off, format: 'table', noColor: true });
    expect(ANSI.test(off.text())).toBe(false);
  });

  it('progress: bar colorizer keyed by completion bucket', async () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 'Common'));
    const out = new Buf();
    await runProgress({ set_id: 'sv4', db, out, format: 'table', color: true });
    expect(ANSI.test(out.text())).toBe(true);
  });
});
