import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { readLines, writeNdjson } from '../../src/io/ndjson.js';

function fromString(s: string): Readable {
  return Readable.from(Buffer.from(s));
}

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

describe('readLines()', () => {
  it('yields non-empty lines with CR/LF tolerance', async () => {
    const input = 'a\r\nb\n\nc\n';
    const lines: string[] = [];
    for await (const line of readLines(fromString(input))) lines.push(line);
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('handles a trailing line with no newline', async () => {
    const input = 'x\ny';
    const lines: string[] = [];
    for await (const line of readLines(fromString(input))) lines.push(line);
    expect(lines).toEqual(['x', 'y']);
  });
});

describe('writeNdjson()', () => {
  it('one JSON per record, newline-terminated', async () => {
    const out = new Buf();
    await writeNdjson(out, [{ a: 1 }, { b: 'x' }]);
    expect(out.text()).toBe('{"a":1}\n{"b":"x"}\n');
  });
});
