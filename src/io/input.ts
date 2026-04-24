import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { readLines } from './ndjson.js';
import { parseLine } from './record.js';
import type { CardRecord } from '../domain/card.js';
import { UserError } from '../errors.js';

/**
 * Unix source-input convention: consumer commands (filter, sort, value,
 * tag in stream mode) accept zero or more file arguments. With files,
 * they read each in order. With none, they read stdin. That's how
 * `grep PATTERN file1 file2`, `sort file`, `wc file` all work.
 *
 * This helper owns that decision in ONE place so every consumer command
 * stays uniform.
 *
 * Conventions:
 *   - `-` as a filename means "read from stdin" (also GNU-standard).
 *   - A mix is legal: `poke filter 'foo=bar' a.ndjson - b.ndjson`.
 *   - Missing files are a UserError (exit 1) — we don't silently skip
 *     because that would hide typos in scripts.
 */

export interface InputSource {
  label: string;
  stream: Readable;
}

/**
 * Resolve a list of file arguments to a stream of labeled sources.
 *
 *   []                -> [{ label: '<stdin>', stream: process.stdin }]
 *   ['a', 'b']        -> [{ label: 'a', ... }, { label: 'b', ... }]
 *   ['a', '-', 'b']   -> [a, stdin, b]
 */
export function resolveInputs(
  args: readonly string[],
  stdin: Readable = process.stdin,
): InputSource[] {
  if (args.length === 0) {
    return [{ label: '<stdin>', stream: stdin }];
  }
  return args.map((arg) => {
    if (arg === '-') return { label: '<stdin>', stream: stdin };
    try {
      return { label: arg, stream: createReadStream(arg) };
    } catch (err) {
      throw new UserError(`cannot open '${arg}'`, {
        hint: err instanceof Error ? err.message : undefined,
      });
    }
  });
}

/**
 * Read all NDJSON lines across a list of sources, validate each through
 * CardRecordSchema, and yield records. Malformed lines (bad JSON or
 * schema violations) are counted via the shared `stats` object so
 * callers can emit a single summary warning at EOF.
 *
 * Files that fail to open throw UserError synchronously (by virtue of
 * createReadStream's error event — we surface it on first read).
 */
export async function* readCardRecords(
  sources: readonly InputSource[],
  stats: { malformed: number },
): AsyncGenerator<CardRecord, void, void> {
  for (const src of sources) {
    try {
      for await (const line of readLines(src.stream)) {
        const record = parseLine(line);
        if (!record) {
          stats.malformed++;
          continue;
        }
        yield record;
      }
    } catch (err) {
      // Re-throw file-open / read errors as UserError so top-level
      // handler picks the right exit code (1, not generic 1 via Error).
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        throw new UserError(`no such file: ${src.label}`);
      }
      throw err;
    }
  }
}
