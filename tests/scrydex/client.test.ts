import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { CardSchema, singleResponseSchema, unwrapSingle } from '../../src/scrydex/schemas.js';
import { NetworkError } from '../../src/errors.js';
import { mockFetch } from '../helpers/mockFetch.js';

function makeClient(fetchFn: typeof fetch): ScrydexClient {
  return new ScrydexClient({
    api_key: 'k',
    team_id: 't',
    fetch: fetchFn,
    baseUrl: 'https://api.example.test/pokemon/v1/',
    timeoutMs: 2000,
  });
}

describe('ScrydexClient', () => {
  it('sends required auth headers and parses the response', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cards/sv10_ja-1', fixture: 'card-sv10_ja-1.json' },
    ]);
    const client = makeClient(fetch);
    const res = await client.request(`cards/sv10_ja-1`, {
      schema: singleResponseSchema(CardSchema),
      lang: 'ja',
    });
    const card = unwrapSingle(res);
    expect(card.name).toBe('クヌギダマ');
    expect(calls).toHaveLength(1);
    const firstCall = calls[0]!;
    expect(firstCall.url).toBe('https://api.example.test/pokemon/v1/ja/cards/sv10_ja-1');
    const headers = (firstCall.init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('k');
    expect(headers['X-Team-ID']).toBe('t');
  });

  it('builds URLs without a language prefix when lang omitted', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cards/sv4-23', fixture: 'card-sv4-23.json' },
    ]);
    const client = makeClient(fetch);
    await client.request(`cards/sv4-23`, { schema: singleResponseSchema(CardSchema) });
    expect(calls[0]!.url).toBe('https://api.example.test/pokemon/v1/cards/sv4-23');
  });

  it('appends query parameters', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cards', fixture: 'cards-search-sv4.json' },
    ]);
    const client = makeClient(fetch);
    await client.request(`cards`, {
      schema: z.object({ data: z.array(z.any()) }).passthrough(),
      query: { q: 'set.id:sv4', page_size: 50 },
    });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('q')).toBe('set.id:sv4');
    expect(u.searchParams.get('page_size')).toBe('50');
  });

  it('retries once on 429 respecting Retry-After', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/cards/sv4-23',
        fixture: 'card-sv4-23.json',
        failFirstN: { n: 1, status: 429, headers: { 'retry-after': '0.01' } },
      },
    ]);
    const client = makeClient(fetch);
    const res = await client.request(`cards/sv4-23`, {
      schema: singleResponseSchema(CardSchema),
    });
    expect(calls).toHaveLength(2);
    expect(unwrapSingle(res).id).toBe('sv4-23');
  });

  it('retries once on 5xx', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: '/cards/sv4-23',
        fixture: 'card-sv4-23.json',
        failFirstN: { n: 1, status: 503 },
      },
    ]);
    const client = makeClient(fetch);
    await client.request(`cards/sv4-23`, { schema: singleResponseSchema(CardSchema) });
    expect(calls).toHaveLength(2);
  });

  it('throws NetworkError on persistent 4xx', async () => {
    const { fetch } = mockFetch([
      { match: '/cards/nope', body: 'not found', status: 404 },
    ]);
    const client = makeClient(fetch);
    await expect(
      client.request(`cards/nope`, { schema: singleResponseSchema(CardSchema) }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws NetworkError when response fails schema', async () => {
    const { fetch } = mockFetch([
      { match: '/cards/x', body: { data: { id: 42 } } }, // id wrong type
    ]);
    const client = makeClient(fetch);
    await expect(
      client.request(`cards/x`, { schema: singleResponseSchema(CardSchema) }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('caches GET when opt-in', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cards/sv4-23', fixture: 'card-sv4-23.json' },
    ]);
    const client = makeClient(fetch);
    const schema = singleResponseSchema(CardSchema);
    await client.request(`cards/sv4-23`, { schema, cache: true });
    await client.request(`cards/sv4-23`, { schema, cache: true });
    expect(calls).toHaveLength(1);
  });
});
