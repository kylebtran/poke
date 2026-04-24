import { Command } from 'commander';
import { Writable } from 'node:stream';
import { resolveField } from '../filter/predicate.js';
import { emit, type TableSpec } from '../io/emit.js';
import { LIST_SPEC } from './list.js';
import type { CardRecord } from '../domain/card.js';
import { UserError } from '../errors.js';
import { resolveInputs, readCardRecords, type InputSource } from '../io/input.js';

export interface SortOptions {
  by: string;
  desc?: boolean;
  inputs?: readonly InputSource[];
  files?: readonly string[];
  out?: NodeJS.WritableStream | Writable;
  stderr?: NodeJS.WritableStream;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke sort --by <field> [--desc] [FILE...]` — NDJSON in, sorted NDJSON out.
 *
 * Buffers the entire stream (sort needs all records); that's fine for a
 * personal collection. Nulls/undefineds sort last in both directions.
 *
 * Files are read in order, or stdin if none (`-` also means stdin).
 */
export async function runSort(opts: SortOptions): Promise<void> {
  if (!opts.by) throw new UserError('--by <field> required');
  const sources = opts.inputs ?? resolveInputs(opts.files ?? []);
  const stderr = opts.stderr ?? process.stderr;
  const stats = { malformed: 0 };

  const buffer: CardRecord[] = [];
  for await (const record of readCardRecords(sources, stats)) {
    buffer.push(record);
  }

  buffer.sort((a, b) =>
    compare(resolveField(a, opts.by), resolveField(b, opts.by), opts.desc === true),
  );

  await emit(buffer, LIST_SPEC as TableSpec<CardRecord>, {
    out: opts.out,
    format: opts.format,
    json: opts.json,
    noColor: opts.noColor,
  });

  if (stats.malformed > 0) {
    stderr.write(
      `warn: skipped ${stats.malformed} malformed record${stats.malformed === 1 ? '' : 's'}\n`,
    );
  }
}

function compare(a: unknown, b: unknown, desc: boolean): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // missing always last
  if (bMissing) return -1;
  const an = numberize(a);
  const bn = numberize(b);
  if (an !== undefined && bn !== undefined) {
    return desc ? bn - an : an - bn;
  }
  const as = String(a);
  const bs = String(b);
  const cmp = as.localeCompare(bs);
  return desc ? -cmp : cmp;
}

function numberize(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function registerSortCommand(program: Command): void {
  program
    .command('sort [files...]')
    .description(
      "sort a stream by a record field (nulls last); reads stdin when no files given, '-' for stdin",
    )
    .requiredOption('--by <field>', 'field path (e.g. name, price.market)')
    .option('--desc', 'descending order', false)
    .action(async (files: string[], opts: { by: string; desc?: boolean }, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      await runSort({
        by: opts.by,
        desc: opts.desc ?? false,
        files,
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
