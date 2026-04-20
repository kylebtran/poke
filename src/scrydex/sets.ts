import type { ScrydexClient } from './client.js';
import {
  SetSchema,
  listResponseSchema,
  singleResponseSchema,
  unwrapSingle,
  type Set as PokeSet,
} from './schemas.js';

export async function getSet(
  client: ScrydexClient,
  id: string,
  opts: { lang?: string } = {},
): Promise<PokeSet> {
  const raw = await client.request(`sets/${encodeURIComponent(id)}`, {
    method: 'GET',
    schema: singleResponseSchema(SetSchema),
    lang: opts.lang,
    cache: true,
  });
  return unwrapSingle(raw);
}

export async function listSets(
  client: ScrydexClient,
  opts: { lang?: string; limit?: number; page?: number } = {},
): Promise<PokeSet[]> {
  const query: Record<string, string | number> = {};
  if (opts.limit !== undefined) query.page_size = opts.limit;
  if (opts.page !== undefined) query.page = opts.page;
  const res = await client.request('sets', {
    method: 'GET',
    query,
    schema: listResponseSchema(SetSchema),
    lang: opts.lang,
    cache: true,
  });
  return res.data;
}
