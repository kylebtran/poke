import { Command } from 'commander';
import { openDatabase, type DB } from '../db/migrate.js';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { searchCards } from '../scrydex/cards.js';
import { putCachedCard } from '../db/cache.js';
import { ensurePricesFresh, BATCH_SIZE } from '../scrydex/prices.js';
import { listOwnedCardIds } from '../db/collection.js';
import { UserError } from '../errors.js';

export interface RefreshOptions {
  prices?: boolean;
  metadata?: boolean;
  set?: string;
  db?: DB;
  client?: ScrydexClient;
  stderr?: NodeJS.WritableStream;
}

/**
 * `poke refresh --prices --metadata [--set S]`.
 *
 * Forces upstream re-fetch regardless of TTL.
 */
export async function runRefresh(opts: RefreshOptions = {}): Promise<void> {
  if (!opts.prices && !opts.metadata) {
    throw new UserError('specify --prices, --metadata, or both');
  }
  const db = opts.db ?? openDatabase();
  const client = opts.client ?? new ScrydexClient(requireAuth());
  const stderr = opts.stderr ?? process.stderr;
  try {
    const ids = idsToRefresh(db, opts);
    if (ids.length === 0) {
      stderr.write('refresh: nothing to do\n');
      return;
    }

    if (opts.metadata) {
      stderr.write(`refreshing metadata for ${ids.length} card(s)…\n`);
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const q = `id:(${chunk.join(' OR ')})`;
        const cards = await searchCards(client, q, { limit: chunk.length });
        for (const c of cards) putCachedCard(db, c);
      }
    }

    if (opts.prices) {
      stderr.write(`refreshing prices for ${ids.length} card(s)…\n`);
      await ensurePricesFresh(db, client, ids, { force: true });
    }
    stderr.write('refresh: done\n');
  } finally {
    if (!opts.db) db.close();
  }
}

function idsToRefresh(db: DB, opts: RefreshOptions): string[] {
  if (opts.set) {
    const rows = db.prepare(`SELECT id FROM cards WHERE set_id = ?`).all(opts.set) as {
      id: string;
    }[];
    return rows.map((r) => r.id);
  }
  return listOwnedCardIds(db);
}

export function registerRefreshCommand(program: Command): void {
  program
    .command('refresh')
    .description('force cache refresh (prices and/or metadata)')
    .option('--prices', 'refresh price snapshots', false)
    .option('--metadata', 'refresh card metadata', false)
    .option('--set <id>', 'restrict to a given set')
    .action(async (opts: { prices?: boolean; metadata?: boolean; set?: string }) => {
      await runRefresh({
        ...(opts.prices !== undefined ? { prices: opts.prices } : {}),
        ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
        ...(opts.set !== undefined ? { set: opts.set } : {}),
      });
    });
}
