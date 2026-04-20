import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { getCardById } from '../scrydex/cards.js';
import { fromScrydex } from '../domain/card.js';
import { openDatabase, type DB } from '../db/migrate.js';
import { getCachedCard, putCachedCard, isStale, TTL } from '../db/cache.js';
import { UserError } from '../errors.js';
import type { Card } from '../scrydex/schemas.js';

export interface ShowOptions {
  lang?: string;
  /** Injected for tests. Falls back to a real client built from settings. */
  client?: ScrydexClient;
  /** Injected for tests. Falls back to the on-disk DB. */
  db?: DB;
  /** Injected for tests. Defaults to `process.stdout`. */
  out?: NodeJS.WritableStream | Writable;
  /** Skip cache even if fresh (force refresh). */
  noCache?: boolean;
}

/**
 * `poke show <card-id>` — single card, full detail.
 *
 * Read-through cache: if the card is in SQLite and its `fetched_at` is
 * within `TTL.CARD_MS`, serve from the DB; otherwise fetch from Scrydex,
 * upsert, and return the fresh copy.
 */
export async function runShow(cardId: string, opts: ShowOptions = {}): Promise<void> {
  if (!cardId || cardId.length === 0) {
    throw new UserError('card id required');
  }
  const db = opts.db ?? openDatabase();
  try {
    const card = await resolveCard(db, cardId, opts);
    const record = fromScrydex(card);
    const out = opts.out ?? process.stdout;
    out.write(JSON.stringify(record) + '\n');
  } finally {
    if (!opts.db) db.close();
  }
}

async function resolveCard(db: DB, cardId: string, opts: ShowOptions): Promise<Card> {
  if (!opts.noCache) {
    const cached = getCachedCard(db, cardId);
    if (cached && !isStale(cached.fetched_at, TTL.CARD_MS)) {
      return cached.data;
    }
  }
  const client = opts.client ?? new ScrydexClient(requireAuth());
  const card = await getCardById(client, cardId, opts.lang ? { lang: opts.lang } : {});
  putCachedCard(db, card);
  return card;
}

export function registerShowCommand(program: Command): void {
  program
    .command('show <card-id>')
    .description('show full detail for one card by id')
    .option('--lang <code>', 'language scope (en|ja)')
    .action(async (cardId: string, opts: { lang?: string }) => {
      await runShow(cardId, { lang: opts.lang });
    });
}
