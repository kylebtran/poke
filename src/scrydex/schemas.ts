import { z } from 'zod';

/**
 * Zod schemas for the Scrydex responses we consume. Every object uses
 * `.passthrough()` so unknown fields survive the parse and our domain
 * layer can read them (spec §5: "new Scrydex fields land without
 * handwritten type edits"). We enforce the fields we rely on; everything
 * else is opaque.
 *
 * Schemas are deliberately loose on nested shapes because Scrydex
 * evolves; the live-contract test (phase 12) catches drift on the
 * fields we actually read.
 */

export const SetRefSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    series: z.string().optional(),
    language_code: z.string().optional(),
  })
  .passthrough();

export const PriceEntrySchema = z
  .object({
    market: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    mid: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    currency: z.string().optional(),
    source: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const PricesSchema = z
  .object({
    market: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    mid: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    currency: z.string().optional(),
    source: z.string().optional(),
    updated_at: z.string().optional(),
    // Some Scrydex responses nest per-market variants under arrays.
    // We tolerate either shape.
    tcgplayer: PriceEntrySchema.optional(),
    cardmarket: PriceEntrySchema.optional(),
  })
  .passthrough();

export const CardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    number: z.string().optional(),
    rarity: z.string().optional(),
    artist: z.string().optional(),
    language_code: z.string().optional(),
    set: SetRefSchema.optional(),
    set_id: z.string().optional(),
    images: z.any().optional(),
    prices: PricesSchema.optional(),
    // Some endpoints return `name_en` for JA cards; others put the English
    // name under `translations.en` — schema is lenient.
    name_en: z.string().optional(),
    rarity_en: z.string().optional(),
  })
  .passthrough();

export type Card = z.infer<typeof CardSchema>;

export const SetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    series: z.string().optional(),
    language_code: z.string().optional(),
    printed_total: z.number().int().optional(),
    total: z.number().int().optional(),
    release_date: z.string().optional(),
    images: z.any().optional(),
  })
  .passthrough();

export type Set = z.infer<typeof SetSchema>;

/** Envelope for list endpoints — data[] plus paging metadata. */
export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      data: z.array(item),
      total_count: z.number().int().optional(),
      page: z.number().int().optional(),
      page_size: z.number().int().optional(),
    })
    .passthrough();
}

/** Some Scrydex endpoints return the object under `data`, some bare. */
export function singleResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.union([item, z.object({ data: item }).passthrough()]);
}

export function unwrapSingle<T>(value: T | { data: T }): T {
  if (value && typeof value === 'object' && 'data' in (value as object)) {
    return (value as { data: T }).data;
  }
  return value as T;
}
