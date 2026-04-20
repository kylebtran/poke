import { Command } from 'commander';
import { Readable, Writable } from 'node:stream';
import { readLines } from '../io/ndjson.js';
import { parseLine } from '../io/record.js';
import { resolveField } from '../filter/predicate.js';
import { emit, type TableSpec } from '../io/emit.js';
import { LIST_SPEC } from './list.js';
import type { CardRecord } from '../domain/card.js';
import { UserError } from '../errors.js';

export interface SortOptions {
  by: string;
  desc?: boolean;
  stdin?: Readable;
  out?: NodeJS.WritableStream | Writable;
  stderr?: NodeJS.WritableStream;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke sort --by <field> [--desc]` — stdin → stdout.
 *
 * Sort is buffering (all records in memory); that's fine for a personal
 * collection which is ~thousands at most. Nulls/undefineds sort last
 * in both directions.
 */
export async function runSort(opts: SortOptions): Promise<void> {
  if (!opts.by) throw new UserError('--by <field> required');
  const stdin = opts.stdin ?? process.stdin;
  const stderr = opts.stderr ?? process.stderr;
  let malformed = 0;

  const buffer: CardRecord[] = [];
  for await (const line of readLines(stdin)) {
    const record = parseLine(line);
    if (!record) {
      malformed++;
      continue;
    }
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

  if (malformed > 0) {
    stderr.write(`warn: skipped ${malformed} malformed record${malformed === 1 ? '' : 's'}\n`);
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
    .command('sort')
    .description('sort a stream by a record field (nulls last)')
    .requiredOption('--by <field>', 'field path (e.g. name, price.market)')
    .option('--desc', 'descending order', false)
    .action(async (opts: { by: string; desc?: boolean }, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      await runSort({
        by: opts.by,
        desc: opts.desc ?? false,
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
