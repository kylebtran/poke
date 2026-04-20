import { z } from 'zod';
import type { Card as ScrydexCard } from '../scrydex/schemas.js';

/**
 * Versioned NDJSON record shape exchanged between piped commands. Spec §6
 * defines the canonical shape. This schema is the zod source of truth —
 * filter/sort/value all parse incoming lines through it and reject
 * incompatible streams.
 */

export const SCHEMA_ID = 'poke.card/v1';

export const CardRecordPriceSchema = z
  .object({
    currency: z.string(),
    market: z.number().nullable(),
    low: z.number().nullable().optional(),
    mid: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    source: z.string(),
    fetched_at: z.string(),
    stale: z.boolean().optional(),
  })
  .passthrough();

export const CardRecordOwnedSchema = z
  .object({
    quantity: z.number().int().nonnegative(),
    condition: z.string().default('NM'),
    foil: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    owned_id: z.number().int().optional(),
    note: z.string().optional(),
    acquired_at: z.string().optional(),
    acquired_price_cents: z.number().int().nullable().optional(),
  })
  .passthrough();

export const CardRecordSchema = z
  .object({
    _schema: z.literal(SCHEMA_ID),
    id: z.string(),
    name: z.string(),
    name_en: z.string().optional(),
    set_id: z.string(),
    set_name: z.string().optional(),
    lang: z.string(),
    number: z.string().optional(),
    rarity: z.string().optional(),
    rarity_en: z.string().optional(),
    tier: z.string().optional(),
    artist: z.string().optional(),
    owned: CardRecordOwnedSchema.optional(),
    price: CardRecordPriceSchema.nullable().optional(),
  })
  .passthrough();

export type CardRecord = z.infer<typeof CardRecordSchema>;

/**
 * Map a Scrydex card to our internal NDJSON record. `owned` and `price`
 * are layered on top by the caller (who has DB access); this function
 * just normalizes the immutable catalog fields.
 */
export function fromScrydex(card: ScrydexCard): Omit<CardRecord, 'owned' | 'price'> {
  const setId = card.set?.id ?? card.set_id ?? inferSetIdFromCardId(card.id);
  const setName = card.set?.name;
  const lang =
    card.language_code ??
    card.set?.language_code ??
    inferLangFromSetId(setId) ??
    'en';
  const record: Omit<CardRecord, 'owned' | 'price'> = {
    _schema: SCHEMA_ID,
    id: card.id,
    name: card.name,
    set_id: setId,
    lang,
  };
  if (setName) record.set_name = setName;
  if (card.number) record.number = card.number;
  if (card.rarity) record.rarity = card.rarity;
  if (card.artist) record.artist = card.artist;
  if (card.name_en) record.name_en = card.name_en;
  if (card.rarity_en) record.rarity_en = card.rarity_en;
  return record;
}

/** Heuristic: Scrydex card ids are `<set_id>-<number>`. */
function inferSetIdFromCardId(cardId: string): string {
  const idx = cardId.lastIndexOf('-');
  return idx > 0 ? cardId.slice(0, idx) : cardId;
}

/** Heuristic: JA set ids end with `_ja`. Enough to seed `lang` when the
 * upstream payload omits the language_code field. */
function inferLangFromSetId(setId: string): string | undefined {
  if (setId.endsWith('_ja')) return 'ja';
  if (setId.endsWith('_en')) return 'en';
  return undefined;
}
