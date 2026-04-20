import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { openDatabase, type DB } from '../db/migrate.js';
import { getCachedCard, putCachedCard, isStale, TTL } from '../db/cache.js';
import { addOwned, getOwnedById } from '../db/collection.js';
import { getCardById } from '../scrydex/cards.js';
import { resolveCardRef } from '../domain/cardRef.js';
import { fromScrydex, type CardRecord } from '../domain/card.js';
import { emit, type TableSpec } from '../io/emit.js';
import { UserError } from '../errors.js';

export interface AddOptions {
  qty?: number;
  condition?: string;
  foil?: boolean;
  price?: number; // dollars, e.g. 12.34
  note?: string;
  tags?: string[]; // applied in phase 9
  lang?: string;
  db?: DB;
  client?: ScrydexClient;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke add <card-id> [--qty N] [--condition C] [--foil] [--price $X] [--note "..."]`.
 *
 * Flow:
 *   1. Resolve card ref to canonical Scrydex id.
 *   2. Ensure the card is cached (fetch + persist if missing/stale).
 *   3. Insert (or increment) an owned_cards row.
 *   4. Emit a one-record confirmation through `emit()`.
 */
export async function runAdd(cardRef: string, opts: AddOptions = {}): Promise<void> {
  if (!cardRef) throw new UserError('card id required');
  const db = opts.db ?? openDatabase();
  const client = opts.client ?? new ScrydexClient(requireAuth());
  try {
    const id = await resolveCardRef(db, client, cardRef, opts.lang ? { lang: opts.lang } : {});
    const cached = getCachedCard(db, id);
    if (!cached || isStale(cached.fetched_at, TTL.CARD_MS)) {
      const card = await getCardById(client, id, opts.lang ? { lang: opts.lang } : {});
      putCachedCard(db, card);
    }

    const priceCents = opts.price !== undefined ? Math.round(opts.price * 100) : undefined;
    const row = addOwned(db, {
      card_id: id,
      quantity: opts.qty ?? 1,
      condition: opts.condition,
      foil: opts.foil,
      ...(priceCents !== undefined ? { acquired_price_cents: priceCents } : {}),
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    });

    // Re-fetch the persisted row so we emit authoritative numbers.
    const persisted = getOwnedById(db, row.id)!;
    const card = getCachedCard(db, id)!.data;
    const base = fromScrydex(card);
    const record: CardRecord = {
      ...base,
      owned: {
        quantity: persisted.quantity,
        condition: persisted.condition,
        foil: persisted.foil,
        tags: [],
        owned_id: persisted.id,
        acquired_at: persisted.acquired_at,
        ...(persisted.acquired_price_cents !== null
          ? { acquired_price_cents: persisted.acquired_price_cents }
          : {}),
        ...(persisted.note !== null ? { note: persisted.note } : {}),
      },
    };

    await emit([record], ADD_SPEC, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

const ADD_SPEC: TableSpec<CardRecord> = {
  columns: [
    { header: 'id', get: (r) => r.id },
    { header: 'name', get: (r) => r.name },
    { header: 'set', get: (r) => r.set_id },
    { header: 'qty', get: (r) => r.owned?.quantity ?? 0, align: 'right' },
    { header: 'condition', get: (r) => r.owned?.condition ?? '' },
    { header: 'foil', get: (r) => (r.owned?.foil ? 'yes' : '') },
  ],
};

export function registerAddCommand(program: Command): void {
  program
    .command('add <card-id>')
    .description('add a card to your collection (id or <set>:<number>)')
    .option('--qty <n>', 'quantity to add', (v) => parseInt(v, 10), 1)
    .option('--condition <c>', 'card condition (e.g. NM, LP)', 'NM')
    .option('--foil', 'mark as foil', false)
    .option('--price <usd>', 'acquired price in USD', (v) => parseFloat(v))
    .option('--note <text>', 'free-form note')
    .option('--lang <code>', 'language hint (en|ja)')
    .action(
      async (
        cardRef: string,
        opts: {
          qty?: number;
          condition?: string;
          foil?: boolean;
          price?: number;
          note?: string;
          lang?: string;
        },
        cmd: Command,
      ) => {
        const globals = cmd.parent?.opts() ?? {};
        await runAdd(cardRef, {
          ...(opts.qty !== undefined ? { qty: opts.qty } : {}),
          ...(opts.condition !== undefined ? { condition: opts.condition } : {}),
          ...(opts.foil !== undefined ? { foil: opts.foil } : {}),
          ...(opts.price !== undefined && Number.isFinite(opts.price) ? { price: opts.price } : {}),
          ...(opts.note !== undefined ? { note: opts.note } : {}),
          ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
          format: globals.format as string | undefined,
          json: globals.json as boolean | undefined,
          noColor: globals.color === false,
        });
      },
    );
}
