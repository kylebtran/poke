import { Command } from 'commander';
import { Readable, Writable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import { readLines } from '../io/ndjson.js';
import { parseLine } from '../io/record.js';
import { listOwned } from '../db/collection.js';
import { toRecord } from './list.js';
import type { CardRecord } from '../domain/card.js';
import { emit, type TableSpec } from '../io/emit.js';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { ensurePricesFresh, snapshotToRecordPrice } from '../scrydex/prices.js';
import { tierOf } from '../domain/rarity.js';
import { UserError } from '../errors.js';

export interface ValueOptions {
  total?: boolean;
  groupBy?: 'set' | 'rarity' | 'tag';
  noRefresh?: boolean;
  stdin?: Readable;
  db?: DB;
  client?: ScrydexClient;
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
    { header: 'unavailable', get: (r) => (r.unavailable === 0 ? '' : r.unavailable), align: 'right' },
    {
      header: 'total',
      align: 'right',
      get: (r) => `$${(r.total_cents / 100).toFixed(2)}`,
      color: (_r, s, p) => p.bold(s),
    },
  ],
};

/**
 * `poke value [--total] [--group-by set|rarity|tag]`.
 *
 * Two invocation modes:
 *   1. stdin present → read NDJSON records, fold totals.
 *   2. no stdin      → fall back to listing the entire owned collection
 *                      (same path as `poke list --with-prices`).
 *
 * Records with `price==null` are NOT added to the total but ARE counted
 * in `unavailable` so users see how much "unknown" they have.
 */
export async function runValue(opts: ValueOptions = {}): Promise<void> {
  const db = opts.db ?? openDatabase();
  try {
    const records = await collect(db, opts);

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
      const key = groupKey(db, r, opts.groupBy);
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

async function collect(db: DB, opts: ValueOptions): Promise<CardRecord[]> {
  // Tests pass an explicit stdin; CLI inherits process.stdin. When the
  // process's stdin is a TTY, treat it as "no stdin" and fall through to
  // the DB-backed path.
  if (opts.stdin !== undefined) {
    return await readStdinRecords(opts.stdin, opts.stderr ?? process.stderr);
  }
  if (!process.stdin.isTTY) {
    return await readStdinRecords(process.stdin, opts.stderr ?? process.stderr);
  }
  return await readFromDb(db, opts);
}

async function readStdinRecords(stdin: Readable, stderr: NodeJS.WritableStream): Promise<CardRecord[]> {
  const out: CardRecord[] = [];
  let malformed = 0;
  for await (const line of readLines(stdin)) {
    const r = parseLine(line);
    if (!r) {
      malformed++;
      continue;
    }
    out.push(r);
  }
  if (malformed > 0) {
    stderr.write(`warn: skipped ${malformed} malformed record${malformed === 1 ? '' : 's'}\n`);
  }
  return out;
}

async function readFromDb(db: DB, opts: ValueOptions): Promise<CardRecord[]> {
  const rows = listOwned(db);
  const records = rows.map(toRecord);
  if (records.length === 0) return records;
  const ids = Array.from(new Set(records.map((r) => r.id)));
  const client = opts.client ?? (opts.noRefresh ? null : new ScrydexClient(requireAuth()));
  const prices = await ensurePricesFresh(db, client, ids, {
    noRefresh: opts.noRefresh === true,
  });
  for (const rec of records) {
    rec.price = snapshotToRecordPrice(prices.get(rec.id) ?? null);
  }
  return records;
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

function groupKey(db: DB, r: CardRecord, mode: 'set' | 'rarity' | 'tag'): string | undefined {
  if (mode === 'set') return r.set_id;
  if (mode === 'rarity') return r.rarity ?? 'Unknown';
  if (mode === 'tag') {
    const tags = r.owned?.tags ?? [];
    if (tags.length === 0) return '(untagged)';
    // Emit one entry per tag — duplicate the record contribution. We
    // return the first tag here; the caller isn't set up for multi-key
    // emission yet. Phase 11 may revisit this.
    return tags[0];
  }
  // Kept for future extension (e.g. 'tier' without explicit mode).
  const _ignored = tierOf;
  return undefined;
}

export function registerValueCommand(program: Command): void {
  program
    .command('value')
    .description('sum prices of a record stream (or the full collection with no stdin)')
    .option('--total', 'single total (default when no --group-by)', true)
    .option('--group-by <mode>', 'group totals by: set|rarity|tag')
    .option('--no-refresh', 'skip auto-refresh of stale prices')
    .action(
      async (
        opts: { total?: boolean; groupBy?: string; refresh?: boolean },
        cmd: Command,
      ) => {
        const globals = cmd.parent?.opts() ?? {};
        if (opts.groupBy && !['set', 'rarity', 'tag'].includes(opts.groupBy)) {
          throw new UserError(`--group-by must be set|rarity|tag (got '${opts.groupBy}')`);
        }
        await runValue({
          ...(opts.total !== undefined ? { total: opts.total } : {}),
          ...(opts.groupBy !== undefined
            ? { groupBy: opts.groupBy as 'set' | 'rarity' | 'tag' }
            : {}),
          noRefresh: opts.refresh === false,
          format: globals.format as string | undefined,
          json: globals.json as boolean | undefined,
          noColor: globals.color === false,
        });
      },
    );
}
