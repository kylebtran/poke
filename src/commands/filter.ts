import { Command } from 'commander';
import { Writable } from 'node:stream';
import { parsePredicate } from '../filter/predicate.js';
import { emit, type TableSpec } from '../io/emit.js';
import { LIST_SPEC } from './list.js';
import type { CardRecord } from '../domain/card.js';
import { UserError } from '../errors.js';
import { resolveInputs, readCardRecords, type InputSource } from '../io/input.js';

export interface FilterOptions {
  /** Explicit list of input sources. When omitted, reads process.stdin. */
  inputs?: readonly InputSource[];
  /** Positional file args from the CLI. Used to build `inputs`. */
  files?: readonly string[];
  out?: NodeJS.WritableStream | Writable;
  stderr?: NodeJS.WritableStream;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke filter <predicate> [FILE...]` — NDJSON in, NDJSON out.
 *
 * Reads from the listed FILE(s) in order, or from stdin when no files
 * are given. Classic Unix source-input convention — same as
 * `grep PATTERN file1 file2` or `sort file`.
 *
 * Every record is zod-validated through CardRecordSchema. Malformed
 * lines are dropped and counted; a single stderr warning is emitted at
 * end-of-stream.
 */
export async function runFilter(
  predicateInput: string,
  opts: FilterOptions = {},
): Promise<{ kept: number; dropped: number; malformed: number }> {
  const predicate = parsePredicate(predicateInput);
  const sources = opts.inputs ?? resolveInputs(opts.files ?? []);
  const stderr = opts.stderr ?? process.stderr;

  const stats = { kept: 0, dropped: 0, malformed: 0 };

  async function* surviving(): AsyncIterable<CardRecord> {
    for await (const record of readCardRecords(sources, stats)) {
      try {
        if (predicate.test(record)) {
          stats.kept++;
          yield record;
        } else {
          stats.dropped++;
        }
      } catch {
        stats.malformed++;
      }
    }
  }

  try {
    await emit(surviving(), LIST_SPEC as TableSpec<CardRecord>, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (stats.malformed > 0) {
      stderr.write(
        `warn: skipped ${stats.malformed} malformed record${stats.malformed === 1 ? '' : 's'}\n`,
      );
    }
  }
  return stats;
}

export function registerFilterCommand(program: Command): void {
  program
    .command('filter <predicate> [files...]')
    .description(
      "drop records where predicate is false (e.g. 'value>50'); reads stdin when no files given, '-' for stdin",
    )
    .action(async (predicate: string, files: string[], _opts: unknown, cmd: Command) => {
      if (!predicate) throw new UserError('predicate required');
      const globals = cmd.parent?.opts() ?? {};
      await runFilter(predicate, {
        files,
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
