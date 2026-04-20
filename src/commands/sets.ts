import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { openDatabase, type DB } from '../db/migrate.js';
import { listSets } from '../scrydex/sets.js';
import { putCachedSet } from '../db/cache.js';
import { emit, type TableSpec } from '../io/emit.js';
import type { Set as PokeSet } from '../scrydex/schemas.js';

export interface SetsOptions {
  lang?: string;
  owned?: boolean;
  db?: DB;
  client?: ScrydexClient;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

interface SetRow {
  id: string;
  name: string;
  series: string;
  lang: string;
  total: number | '';
  printed: number | '';
  release_date: string;
}

const SETS_SPEC: TableSpec<SetRow> = {
  columns: [
    { header: 'id', get: (r) => r.id },
    { header: 'name', get: (r) => r.name },
    { header: 'series', get: (r) => r.series },
    { header: 'lang', get: (r) => r.lang },
    { header: 'printed', get: (r) => r.printed, align: 'right' },
    { header: 'total', get: (r) => r.total, align: 'right' },
    { header: 'release', get: (r) => r.release_date },
  ],
  empty: 'no sets',
};

/**
 * `poke sets` — list available sets.
 *
 * Upserts the fetched rows into the `sets` cache so phase 8's `set`
 * completion math and `progress` both have them locally. When `--owned`
 * is passed, we filter to sets with at least one owned card.
 */
export async function runSets(opts: SetsOptions = {}): Promise<void> {
  const db = opts.db ?? openDatabase();
  const client = opts.client ?? new ScrydexClient(requireAuth());
  try {
    const sets = await listSets(client, opts.lang ? { lang: opts.lang } : {});
    for (const s of sets) putCachedSet(db, s);

    const filtered = opts.owned ? sets.filter((s) => hasOwned(db, s.id)) : sets;
    const rows = filtered.map(toRow);

    await emit(rows, SETS_SPEC, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

function hasOwned(db: DB, set_id: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM owned_cards o JOIN cards c ON c.id = o.card_id
         WHERE c.set_id = ? LIMIT 1`,
    )
    .get(set_id);
  return row !== undefined;
}

function toRow(s: PokeSet): SetRow {
  return {
    id: s.id,
    name: s.name,
    series: s.series ?? '',
    lang: s.language_code ?? '',
    total: s.total ?? '',
    printed: s.printed_total ?? '',
    release_date: s.release_date ?? '',
  };
}

export function registerSetsCommand(program: Command): void {
  program
    .command('sets')
    .description('list available sets')
    .option('--lang <code>', 'language scope (en|ja)')
    .option('--owned', 'only sets you own at least one card from', false)
    .action(async (opts: { lang?: string; owned?: boolean }, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      await runSets({
        ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        ...(opts.owned !== undefined ? { owned: opts.owned } : {}),
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
