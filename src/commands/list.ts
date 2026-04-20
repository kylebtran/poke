import { Command } from 'commander';
import { Writable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import { listOwned, type ListFilters, type ListedOwnedRow } from '../db/collection.js';
import { fromScrydex, type CardRecord } from '../domain/card.js';
import { emit, type TableSpec } from '../io/emit.js';
import type { Card } from '../scrydex/schemas.js';
import { ScrydexClient } from '../scrydex/client.js';
import { requireAuth } from '../config/settings.js';
import { ensurePricesFresh, snapshotToRecordPrice } from '../scrydex/prices.js';
import { tagsForOwnedIds } from '../db/tags.js';
import type { Tier } from '../domain/rarity.js';
import { DEFAULT_RARITY_TIERS } from '../domain/rarity.js';
import type { Palette } from '../ui/colors.js';

function guessTier(lang: string, rarity: string): Tier {
  return DEFAULT_RARITY_TIERS[lang]?.[rarity] ?? 'unknown';
}

export interface ListOptions extends ListFilters {
  withPrices?: boolean;
  noRefresh?: boolean;
  db?: DB;
  client?: ScrydexClient;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
  /** Force-enable color regardless of TTY / env (used by tests). */
  color?: boolean;
}

/**
 * `poke list [filters]`.
 *
 * Emits one CardRecord per owned_cards row. Aggregation (e.g. "sum qty
 * across foils") is a downstream concern — `poke list | poke filter` or
 * `poke list | poke value` compose naturally.
 *
 * Phase 5 stubs `--with-prices`: the flag is accepted, but real price
 * fetching lands in phase 8. Until then we emit `price: null` and warn
 * to stderr when `--with-prices` is passed.
 */
export async function runList(opts: ListOptions = {}): Promise<void> {
  const db = opts.db ?? openDatabase();
  try {
    const filters: ListFilters = {};
    if (opts.set_id) filters.set_id = opts.set_id;
    if (opts.language) filters.language = opts.language;
    if (opts.rarity) filters.rarity = opts.rarity;
    if (opts.tier) filters.tier = opts.tier;
    if (opts.tag) filters.tag = opts.tag;
    const rows = listOwned(db, filters);
    const records = rows.map(toRecord);
    // Populate tags in a single round-trip.
    const tagMap = tagsForOwnedIds(db, rows.map((r) => r.id));
    for (const rec of records) {
      if (rec.owned?.owned_id !== undefined) {
        rec.owned.tags = tagMap.get(rec.owned.owned_id) ?? [];
      }
    }

    if (opts.withPrices && records.length > 0) {
      const ids = Array.from(new Set(records.map((r) => r.id)));
      const client =
        opts.client ?? (opts.noRefresh ? null : new ScrydexClient(requireAuth()));
      const prices = await ensurePricesFresh(db, client, ids, {
        noRefresh: opts.noRefresh === true,
      });
      for (const rec of records) {
        const snap = prices.get(rec.id) ?? null;
        rec.price = snapshotToRecordPrice(snap);
      }
    }

    await emit(records, LIST_SPEC, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
      ...(opts.color !== undefined ? { color: opts.color } : {}),
    });
  } finally {
    if (!opts.db) db.close();
  }
}

export function toRecord(row: ListedOwnedRow): CardRecord {
  const card = JSON.parse(row.card_data) as Card;
  const base = fromScrydex(card);
  // Tier is derived, not cached on cards table. We do a cheap lookup from
  // the default map (no DB round-trip) — if the user has customized a
  // rarity tier, `poke list --tier` filter handles it separately via
  // the rarities table join in collection.ts.
  const tier = card.rarity ? guessTier(card.language_code ?? base.lang, card.rarity) : undefined;
  return {
    ...base,
    ...(tier ? { tier } : {}),
    owned: {
      quantity: row.quantity,
      condition: row.condition,
      foil: row.foil,
      tags: [],
      owned_id: row.id,
      acquired_at: row.acquired_at,
      ...(row.acquired_price_cents !== null
        ? { acquired_price_cents: row.acquired_price_cents }
        : {}),
      ...(row.note !== null ? { note: row.note } : {}),
    },
    price: null,
  };
}

function tierColorizer(tier: string | undefined, palette: Palette): (s: string) => string {
  switch (tier as Tier | undefined) {
    case 'common':
      return palette.rarity.common;
    case 'uncommon':
      return palette.rarity.uncommon;
    case 'rare':
      return palette.rarity.rare;
    case 'ultra':
      return palette.rarity.ultra;
    case 'secret':
      return palette.rarity.secret;
    case 'promo':
      return palette.rarity.promo;
    default:
      return palette.rarity.unknown;
  }
}

export const LIST_SPEC: TableSpec<CardRecord> = {
  columns: [
    { header: 'id', get: (r) => r.id, color: (_r, s, p) => p.muted(s) },
    { header: 'name', get: (r) => r.name },
    { header: 'set', get: (r) => r.set_id },
    {
      header: 'rarity',
      get: (r) => r.rarity ?? '',
      color: (r, s, p) => tierColorizer(r.tier, p)(s),
    },
    { header: 'lang', get: (r) => r.lang, color: (_r, s, p) => p.muted(s) },
    { header: 'qty', get: (r) => r.owned?.quantity ?? 0, align: 'right' },
    { header: 'condition', get: (r) => r.owned?.condition ?? '' },
    { header: 'foil', get: (r) => (r.owned?.foil ? 'yes' : '') },
    {
      header: 'market',
      align: 'right',
      get: (r) => (r.price && r.price.market !== null ? `$${r.price.market.toFixed(2)}` : '—'),
      color: (r, s, p) => {
        if (r.price === null || r.price?.market === null || r.price?.market === undefined) {
          return p.muted(s);
        }
        if (r.price?.stale) return p.muted(s);
        return s;
      },
    },
  ],
  empty: 'no owned cards match',
};

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('list owned cards (filters are ANDed)')
    .option('--set <id>', 'filter by set id')
    .option('--lang <code>', 'filter by language (en|ja)')
    .option('--tag <name>', 'filter by tag')
    .option('--rarity <name>', 'filter by exact rarity string')
    .option('--tier <name>', 'filter by rarity tier (common|uncommon|rare|ultra|secret|promo|unknown)')
    .option('--with-prices', 'include latest price snapshot', false)
    .option('--no-refresh', 'skip auto-refresh of stale prices')
    .action(
      async (
        opts: {
          set?: string;
          lang?: string;
          tag?: string;
          rarity?: string;
          tier?: string;
          withPrices?: boolean;
          refresh?: boolean;
        },
        cmd: Command,
      ) => {
        const globals = cmd.parent?.opts() ?? {};
        await runList({
          ...(opts.set !== undefined ? { set_id: opts.set } : {}),
          ...(opts.lang !== undefined ? { language: opts.lang } : {}),
          ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
          ...(opts.rarity !== undefined ? { rarity: opts.rarity } : {}),
          ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
          ...(opts.withPrices !== undefined ? { withPrices: opts.withPrices } : {}),
          noRefresh: opts.refresh === false,
          format: globals.format as string | undefined,
          json: globals.json as boolean | undefined,
          noColor: globals.color === false,
        });
      },
    );
}
