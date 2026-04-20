import { Command } from 'commander';
import { Readable, Writable } from 'node:stream';
import { readLines } from '../io/ndjson.js';
import { parseLine } from '../io/record.js';
import { parsePredicate } from '../filter/predicate.js';
import { emit, type TableSpec } from '../io/emit.js';
import { LIST_SPEC } from './list.js';
import type { CardRecord } from '../domain/card.js';
import { UserError } from '../errors.js';

export interface FilterOptions {
  stdin?: Readable;
  out?: NodeJS.WritableStream | Writable;
  stderr?: NodeJS.WritableStream;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke filter <predicate>` — stdin → stdout.
 *
 * Reads NDJSON. Every line is zod-validated through CardRecordSchema.
 * Malformed lines are dropped and counted; a single stderr warning is
 * emitted at end-of-stream ("warn: skipped N malformed records").
 * A parse or predicate evaluation error on the input predicate itself is
 * a UserError (exit 1) — this is user input, not a stream artifact.
 */
export async function runFilter(
  predicateInput: string,
  opts: FilterOptions = {},
): Promise<{ kept: number; dropped: number; malformed: number }> {
  const predicate = parsePredicate(predicateInput);
  const stdin = opts.stdin ?? process.stdin;
  const stderr = opts.stderr ?? process.stderr;

  const stats = { kept: 0, dropped: 0, malformed: 0 };

  async function* surviving(): AsyncIterable<CardRecord> {
    for await (const line of readLines(stdin)) {
      const record = parseLine(line);
      if (!record) {
        stats.malformed++;
        continue;
      }
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
    .command('filter <predicate>')
    .description("drop records where predicate is false (e.g. 'value>50')")
    .action(async (predicate: string, _opts: Record<string, never>, cmd: Command) => {
      if (!predicate) throw new UserError('predicate required');
      const globals = cmd.parent?.opts() ?? {};
      await runFilter(predicate, {
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
