import type { ScrydexClient } from './client.js';
import {
  CardSchema,
  listResponseSchema,
  singleResponseSchema,
  unwrapSingle,
  type Card,
} from './schemas.js';

/**
 * Single-card lookup. Scrydex exposes `GET /cards/:id` (and the
 * language-scoped `/en/cards/:id`); both are handled by passing `lang`.
 */
export async function getCardById(
  client: ScrydexClient,
  id: string,
  opts: { lang?: string; include?: string } = {},
): Promise<Card> {
  const query: Record<string, string> = {};
  if (opts.include) query.include = opts.include;
  const raw = await client.request(`cards/${encodeURIComponent(id)}`, {
    method: 'GET',
    query,
    schema: singleResponseSchema(CardSchema),
    lang: opts.lang,
    cache: true,
  });
  return unwrapSingle(raw);
}

/**
 * Search cards. The query string is forwarded verbatim to Scrydex — we do
 * not parse or rewrite it (spec §2: "We don't re-implement [Scrydex
 * query syntax]").
 */
export async function searchCards(
  client: ScrydexClient,
  q: string,
  opts: { lang?: string; limit?: number; page?: number; include?: string } = {},
): Promise<Card[]> {
  const query: Record<string, string | number> = { q };
  if (opts.limit !== undefined) query.page_size = opts.limit;
  if (opts.page !== undefined) query.page = opts.page;
  if (opts.include) query.include = opts.include;
  const res = await client.request('cards', {
    method: 'GET',
    query,
    schema: listResponseSchema(CardSchema),
    lang: opts.lang,
    cache: false,
  });
  return res.data;
}
