import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { getCardById } from '../scrydex/cards.js';
import { fromScrydex, type CardRecord } from '../domain/card.js';
import { openDatabase, type DB } from '../db/migrate.js';
import { getCachedCard, putCachedCard, isStale, TTL } from '../db/cache.js';
import { UserError } from '../errors.js';
import { emit, type TableSpec } from '../io/emit.js';
import { resolveMode } from '../io/tty.js';
import type { Card } from '../scrydex/schemas.js';
import { DEFAULT_RARITY_TIERS, type Tier } from '../domain/rarity.js';
import type { Palette } from '../ui/colors.js';

export interface ShowOptions {
  lang?: string;
  client?: ScrydexClient;
  db?: DB;
  out?: NodeJS.WritableStream | Writable;
  noCache?: boolean;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke show <card-id>` — single card.
 *
 * For piped output (`ndjson` / `json-array`), we emit one CardRecord so
 * downstream pipe commands can consume it. On a TTY we flip to a 2-column
 * key/value table for readability. Both paths go through `emit()`.
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
    const isTTY = Boolean((out as NodeJS.WriteStream).isTTY ?? process.stdout.isTTY);
    const mode = resolveMode({ isTTY, format: opts.format, json: opts.json });

    if (mode === 'table') {
      const rows = toDetailRows(record);
      await emit(rows, DETAIL_SPEC, {
        out,
        mode: 'table',
        format: opts.format,
        json: opts.json,
        noColor: opts.noColor,
      });
    } else {
      await emit([record], CARD_RECORD_PASSTHROUGH_SPEC, {
        out,
        mode,
        noColor: opts.noColor,
      });
    }
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

interface DetailRow {
  field: string;
  value: string;
  tier?: Tier;
}

const DETAIL_SPEC: TableSpec<DetailRow> = {
  columns: [
    { header: 'field', get: (r) => r.field, color: (_r, s, p) => p.label(s) },
    {
      header: 'value',
      get: (r) => r.value,
      color: (r, s, p) => (r.field === 'rarity' && r.tier ? tierColor(r.tier, p)(s) : s),
    },
  ],
};

function tierColor(tier: Tier, p: Palette): (s: string) => string {
  switch (tier) {
    case 'common':
      return p.rarity.common;
    case 'uncommon':
      return p.rarity.uncommon;
    case 'rare':
      return p.rarity.rare;
    case 'ultra':
      return p.rarity.ultra;
    case 'secret':
      return p.rarity.secret;
    case 'promo':
      return p.rarity.promo;
    default:
      return p.rarity.unknown;
  }
}

/**
 * For non-table modes `emit` still runs through TableSpec machinery to
 * pick between ndjson/json-array; we pass a dummy spec because columns
 * are ignored in those modes.
 */
const CARD_RECORD_PASSTHROUGH_SPEC: TableSpec<Omit<CardRecord, 'owned' | 'price'>> = {
  columns: [
    { header: 'id', get: (r) => r.id },
    { header: 'name', get: (r) => r.name },
  ],
};

function toDetailRows(record: Omit<CardRecord, 'owned' | 'price'>): DetailRow[] {
  const rows: DetailRow[] = [
    { field: 'id', value: record.id },
    { field: 'name', value: record.name },
  ];
  if (record.name_en) rows.push({ field: 'name_en', value: record.name_en });
  rows.push({
    field: 'set',
    value: `${record.set_id}${record.set_name ? ` (${record.set_name})` : ''}`,
  });
  rows.push({ field: 'lang', value: record.lang });
  if (record.number) rows.push({ field: 'number', value: record.number });
  if (record.rarity) {
    const tier = DEFAULT_RARITY_TIERS[record.lang]?.[record.rarity] ?? 'unknown';
    rows.push({ field: 'rarity', value: record.rarity, tier });
  }
  if (record.rarity_en) rows.push({ field: 'rarity_en', value: record.rarity_en });
  if (record.artist) rows.push({ field: 'artist', value: record.artist });
  return rows;
}

export function registerShowCommand(program: Command): void {
  program
    .command('show <card-id>')
    .description('show full detail for one card by id')
    .option('--lang <code>', 'language scope (en|ja)')
    .action(async (cardId: string, opts: { lang?: string }, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      await runShow(cardId, {
        lang: opts.lang,
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
