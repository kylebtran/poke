import { Command } from 'commander';
import { Writable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import type { CardRecord } from '../domain/card.js';
import { emit, type TableSpec } from '../io/emit.js';
import { UserError } from '../errors.js';
import { resolveInputs, readCardRecords, type InputSource } from '../io/input.js';

export interface ValueOptions {
  total?: boolean;
  groupBy?: 'set' | 'rarity' | 'tag';
  inputs?: readonly InputSource[];
  files?: readonly string[];
  db?: DB;
  out?: NodeJS.WritableStream | Writable;
  stderr?: NodeJS.WritableStream;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

interface ValueRecord {
  _schema: 'poke.value/v1';
  group: string;
  total_cents: number;
  total_usd: number;
  n_cards: number;
  unavailable: number;
}

const VALUE_SPEC: TableSpec<ValueRecord> = {
  columns: [
    { header: 'group', get: (r) => r.group },
    { header: 'cards', get: (r) => r.n_cards, align: 'right' },
    {
      header: 'unavailable',
      get: (r) => (r.unavailable === 0 ? '' : r.unavailable),
      align: 'right',
    },
    {
      header: 'total',
      align: 'right',
      get: (r) => `$${(r.total_cents / 100).toFixed(2)}`,
      color: (_r, s, p) => p.bold(s),
    },
  ],
};

/**
 * `poke value [--total] [--group-by set|rarity|tag] [FILE...]`.
 *
 * A pure reducer: reads CardRecord NDJSON from FILE(s), or stdin if no
 * files are given, and folds them into totals. Records with
 * `price == null` are NOT added to the total but ARE counted in
 * `unavailable` so users see how much "unknown" they have.
 *
 * Why no DB fallback:
 *   Keeping value composable — one job, one input source — means the
 *   whole-collection case is just one more pipe:
 *
 *     poke list --with-prices | poke value
 *     poke list --with-prices | poke value --group-by set
 *
 *   That's the same shape as every other consumer command and matches
 *   how `wc`, `sort`, `uniq` all work in classical Unix.
 */
export async function runValue(opts: ValueOptions = {}): Promise<void> {
  const db = opts.db ?? openDatabase();
  const sources = opts.inputs ?? resolveInputs(opts.files ?? []);
  const stderr = opts.stderr ?? process.stderr;
  const stats = { malformed: 0 };

  try {
    const records: CardRecord[] = [];
    for await (const record of readCardRecords(sources, stats)) {
      records.push(record);
    }

    if (stats.malformed > 0) {
      stderr.write(
        `warn: skipped ${stats.malformed} malformed record${stats.malformed === 1 ? '' : 's'}\n`,
      );
    }

    if (!opts.groupBy) {
      const agg = fold('total', records);
      await emit([agg], VALUE_SPEC, {
        out: opts.out,
        format: opts.format,
        json: opts.json,
        noColor: opts.noColor,
      });
      return;
    }

    const groups = new Map<string, CardRecord[]>();
    for (const r of records) {
      const key = groupKey(r, opts.groupBy);
      if (key === undefined) continue;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    const rows: ValueRecord[] = [];
    for (const [k, rs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push(fold(k, rs));
    }
    await emit(rows, VALUE_SPEC, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

function fold(group: string, records: CardRecord[]): ValueRecord {
  let total_cents = 0;
  let unavailable = 0;
  for (const r of records) {
    const market = r.price?.market;
    const qty = r.owned?.quantity ?? 1;
    if (market === null || market === undefined) {
      unavailable++;
      continue;
    }
    total_cents += Math.round(market * 100) * qty;
  }
  return {
    _schema: 'poke.value/v1',
    group,
    total_cents,
    total_usd: total_cents / 100,
    n_cards: records.length,
    unavailable,
  };
}

function groupKey(r: CardRecord, mode: 'set' | 'rarity' | 'tag'): string | undefined {
  if (mode === 'set') return r.set_id;
  if (mode === 'rarity') return r.rarity ?? 'Unknown';
  if (mode === 'tag') {
    const tags = r.owned?.tags ?? [];
    if (tags.length === 0) return '(untagged)';
    return tags[0];
  }
  return undefined;
}

export function registerValueCommand(program: Command): void {
  program
    .command('value [files...]')
    .description(
      "sum prices of a record stream; reads stdin when no files given, '-' for stdin. " +
        'For full-collection value, use: poke list --with-prices | poke value',
    )
    .option('--total', 'single total (default when no --group-by)', true)
    .option('--group-by <mode>', 'group totals by: set|rarity|tag')
    .action(async (files: string[], opts: { total?: boolean; groupBy?: string }, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      if (opts.groupBy && !['set', 'rarity', 'tag'].includes(opts.groupBy)) {
        throw new UserError(`--group-by must be set|rarity|tag (got '${opts.groupBy}')`);
      }
      await runValue({
        ...(opts.total !== undefined ? { total: opts.total } : {}),
        ...(opts.groupBy !== undefined
          ? { groupBy: opts.groupBy as 'set' | 'rarity' | 'tag' }
          : {}),
        files,
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
