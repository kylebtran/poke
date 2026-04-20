import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { emit, type TableSpec } from '../../src/io/emit.js';

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

interface Row {
  name: string;
  qty: number;
}

const spec: TableSpec<Row> = {
  columns: [
    { header: 'name', get: (r) => r.name },
    { header: 'qty', get: (r) => r.qty, align: 'right' },
  ],
};

describe('emit()', () => {
  const rows: Row[] = [
    { name: 'Charizard ex', qty: 2 },
    { name: 'Iron Leaves ex', qty: 1 },
  ];

  it('ndjson mode writes one JSON per line', async () => {
    const out = new Buf();
    await emit(rows, spec, { out, mode: 'ndjson' });
    expect(out.text()).toBe(
      '{"name":"Charizard ex","qty":2}\n{"name":"Iron Leaves ex","qty":1}\n',
    );
  });

  it('json-array mode writes a single array', async () => {
    const out = new Buf();
    await emit(rows, spec, { out, mode: 'json-array' });
    expect(JSON.parse(out.text())).toEqual(rows);
  });

  it('table mode writes an ASCII table', async () => {
    const out = new Buf();
    await emit(rows, spec, { out, mode: 'table', color: false });
    const text = out.text();
    expect(text).toContain('name');
    expect(text).toContain('qty');
    expect(text).toContain('Charizard ex');
    expect(text).toContain('Iron Leaves ex');
    // ASCII borders:
    expect(text).toMatch(/[+][-]+[+]/);
    // No ANSI escape sequences when color disabled.
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\x1b\[/);
  });

  it('table mode shows empty placeholder on no records', async () => {
    const out = new Buf();
    await emit([], spec, { out, mode: 'table', color: false });
    expect(out.text()).toBe('(no results)\n');
  });

  it('colorizers fire only when color is enabled', async () => {
    const colored: TableSpec<Row> = {
      columns: [
        {
          header: 'name',
          get: (r) => r.name,
          color: (_r, s) => `*${s}*`,
        },
      ],
    };
    const a = new Buf();
    await emit([{ name: 'x', qty: 1 }], colored, { out: a, mode: 'table', color: true });
    expect(a.text()).toContain('*x*');
    const b = new Buf();
    await emit([{ name: 'x', qty: 1 }], colored, { out: b, mode: 'table', color: false });
    expect(b.text()).not.toContain('*x*');
  });
});
