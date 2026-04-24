import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function inputs(...items: unknown[]) {
  return [{ label: '<test>', stream: stream(...items) }];
}

describe('runFilter stdin pipeline', () => {
  it('keeps matching records and drops others', async () => {
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('tier=secret', {
      inputs: inputs(mk('secret', 'a'), mk('rare', 'b'), mk('secret', 'c')),
      out,
      stderr,
      format: 'ndjson',
    });
    expect(stats.kept).toBe(2);
    expect(stats.dropped).toBe(1);
    const lines = out.text().trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['a', 'c']);
    expect(stderr.text()).toBe('');
  });

  it('warns once for malformed lines and continues', async () => {
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('tier=rare', {
      inputs: inputs('not-json', mk('rare', 'b'), '{"noschema": true}'),
      out,
      stderr,
      format: 'ndjson',
    });
    expect(stats.kept).toBe(1);
    expect(stats.malformed).toBe(2);
    expect(stderr.text()).toContain('skipped 2 malformed');
  });

  it('value alias filters correctly', async () => {
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('value>=10', {
      inputs: inputs(mk('rare', 'a'), mk('rare', 'b')),
      out,
      stderr,
      format: 'ndjson',
    });
    expect(stats.kept).toBe(2);
  });
});

describe('runFilter file arguments', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'poke-filter-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads from named files when provided', async () => {
    const path = join(tmp, 'input.ndjson');
    writeFileSync(
      path,
      [mk('secret', 'a'), mk('rare', 'b'), mk('secret', 'c')]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
    );
    const out = new Buf();
    const stderr = new Buf();
    const stats = await runFilter('tier=secret', {
      files: [path],
      out,
      stderr,
      format: 'ndjson',
    });
    expect(stats.kept).toBe(2);
    const ids = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('concatenates multiple files in order', async () => {
    const a = join(tmp, 'a.ndjson');
    const b = join(tmp, 'b.ndjson');
    writeFileSync(a, JSON.stringify(mk('secret', 'a')) + '\n');
    writeFileSync(b, JSON.stringify(mk('secret', 'b')) + '\n');
    const out = new Buf();
    const stats = await runFilter('tier=secret', {
      files: [a, b],
      out,
      stderr: new Buf(),
      format: 'ndjson',
    });
    expect(stats.kept).toBe(2);
    const ids = out
      .text()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('missing file is a UserError', async () => {
    await expect(
      runFilter('tier=secret', {
        files: [join(tmp, 'does-not-exist.ndjson')],
        out: new Buf(),
        stderr: new Buf(),
        format: 'ndjson',
      }),
    ).rejects.toThrow(/no such file|cannot open/i);
  });
});
