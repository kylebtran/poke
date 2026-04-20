import { describe, it, expect } from 'vitest';
import { parseCsv, writeCsv } from '../../src/io/csv.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted cells with commas and quotes', () => {
    expect(parseCsv('"hello, world","a""b"\n')).toEqual([['hello, world', 'a"b']]);
  });

  it('tolerates CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles embedded newline inside quotes', () => {
    expect(parseCsv('"line1\nline2",x\n')).toEqual([['line1\nline2', 'x']]);
  });
});

describe('writeCsv', () => {
  it('escapes cells that need it', () => {
    const out = writeCsv([
      ['a', 'b', 'c'],
      ['hello, world', '"quote"', 'plain'],
    ]);
    expect(out).toBe('a,b,c\n"hello, world","""quote""",plain\n');
  });
});

describe('round-trip', () => {
  it('write → parse preserves data', () => {
    const original = [
      ['card_id', 'tags', 'note'],
      ['sv4-1', 'grail;binder', 'hello, world'],
      ['sv10_ja-1', '', 'line1\nline2'],
    ];
    const text = writeCsv(original);
    expect(parseCsv(text)).toEqual(original);
  });
});
