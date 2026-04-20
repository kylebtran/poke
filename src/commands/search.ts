import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { searchCards } from '../scrydex/cards.js';
import { fromScrydex, type CardRecord } from '../domain/card.js';
import { ensurePricesFresh, snapshotToRecordPrice } from '../scrydex/prices.js';
import { putCachedCard } from '../db/cache.js';
import { openDatabase, type DB } from '../db/migrate.js';
import { emit, type TableSpec } from '../io/emit.js';
import { LIST_SPEC } from './list.js';
import { UserError } from '../errors.js';

export interface SearchOptions {
  lang?: string;
  limit?: number;
  page?: number;
  withPrices?: boolean;
  db?: DB;
  client?: ScrydexClient;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke search <scrydex-query>`.
 *
 * The query string is forwarded verbatim to Scrydex (spec §2). Results
 * are cached so later `poke show` / `poke add` don't re-hit the API.
 * `owned` is not populated (these are catalog hits, not your collection).
 */
export async function runSearch(q: string, opts: SearchOptions = {}): Promise<void> {
  if (!q || q.length === 0) throw new UserError('query required');
  const db = opts.db ?? openDatabase();
  const client = opts.client ?? new ScrydexClient(requireAuth());
  try {
    const cards = await searchCards(client, q, {
      ...(opts.lang ? { lang: opts.lang } : {}),
      limit: opts.limit ?? 50,
      ...(opts.page !== undefined ? { page: opts.page } : {}),
      include: opts.withPrices ? 'prices' : undefined,
    } as Parameters<typeof searchCards>[2]);
    for (const c of cards) putCachedCard(db, c);
    const records: CardRecord[] = cards.map((c) => ({
      ...fromScrydex(c),
      price: null,
    }));

    if (opts.withPrices && records.length > 0) {
      const ids = records.map((r) => r.id);
      const prices = await ensurePricesFresh(db, client, ids);
      for (const rec of records) {
        rec.price = snapshotToRecordPrice(prices.get(rec.id) ?? null);
      }
    }

    await emit(records, LIST_SPEC as TableSpec<CardRecord>, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('remote Scrydex search — query forwarded verbatim')
    .option('--lang <code>', 'language scope (en|ja)')
    .option('--limit <n>', 'max results per page', (v) => parseInt(v, 10), 50)
    .option('--page <n>', 'page number (1-based)', (v) => parseInt(v, 10))
    .option('--with-prices', 'fetch latest market prices too', false)
    .action(
      async (
        query: string,
        opts: { lang?: string; limit?: number; page?: number; withPrices?: boolean },
        cmd: Command,
      ) => {
        const globals = cmd.parent?.opts() ?? {};
        await runSearch(query, {
          ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.page !== undefined ? { page: opts.page } : {}),
          ...(opts.withPrices !== undefined ? { withPrices: opts.withPrices } : {}),
          format: globals.format as string | undefined,
          json: globals.json as boolean | undefined,
          noColor: globals.color === false,
        });
      },
    );
}
