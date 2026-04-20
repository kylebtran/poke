import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MockRoute {
  /** Substring the request URL must include to match. */
  match: string;
  /** Fixture filename inside tests/fixtures/scrydex/ (preferred). */
  fixture?: string;
  /** Inline body override. Wins over fixture if provided. */
  body?: string | object;
  /** HTTP status. Default 200. */
  status?: number;
  /** Response headers. */
  headers?: Record<string, string>;
  /**
   * Fail the first N calls with this status. Used for 429/5xx retry tests.
   * Count decrements in-place.
   */
  failFirstN?: { n: number; status: number; headers?: Record<string, string> };
}

export interface MockFetchResult {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
}

const FIXTURE_DIR = new URL('../fixtures/scrydex/', import.meta.url);

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR.pathname, name);
  return readFileSync(path, 'utf8');
}

/**
 * Builds a `fetch` stand-in that matches URLs by substring. Designed to
 * drop into `ScrydexClient({ fetch: ... })` in tests — no
 * `vi.spyOn(globalThis, 'fetch')` needed.
 */
export function mockFetch(routes: MockRoute[]): MockFetchResult {
  const calls: MockFetchResult['calls'] = [];
  const routeState = routes.map((r) => ({ ...r }));

  const fn: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    for (const route of routeState) {
      if (!url.includes(route.match)) continue;
      if (route.failFirstN && route.failFirstN.n > 0) {
        route.failFirstN.n--;
        return new Response('', {
          status: route.failFirstN.status,
          headers: route.failFirstN.headers ?? {},
        });
      }
      let body: string;
      if (route.body !== undefined) {
        body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
      } else if (route.fixture) {
        body = loadFixture(route.fixture);
      } else {
        body = '{}';
      }
      return new Response(body, {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json', ...route.headers },
      });
    }
    return new Response(`no mock for ${url}`, { status: 599 });
  };
  return { fetch: fn, calls };
}
