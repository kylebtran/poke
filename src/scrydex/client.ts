import { z } from 'zod';
import { NetworkError } from '../errors.js';

/**
 * Minimal HTTP client for the Scrydex API. Responsibilities:
 *
 *   - Attach `X-Api-Key` + `X-Team-ID` headers (spec §7).
 *   - URL-build with language-scoped paths when `lang` is supplied.
 *   - One retry on 5xx (exponential backoff) and one retry on 429
 *     respecting `Retry-After`.
 *   - Zod-validate every response before returning. Schema failures
 *     throw `NetworkError` — never leak zod errors to the UI.
 *
 * No state beyond credentials and an optional in-memory LRU cache for
 * idempotent GETs that opt in via `{cache: true}`.
 */

export const DEFAULT_BASE_URL = 'https://api.scrydex.com/pokemon/v1/';

export interface ScrydexClientOptions {
  api_key: string;
  team_id: string;
  baseUrl?: string;
  /** Timeout per request in ms. Default 20s. */
  timeoutMs?: number;
  /** Allow tests to inject a custom fetch. Falls back to global fetch. */
  fetch?: typeof fetch;
  /** User-agent string appended to requests. */
  userAgent?: string;
}

export interface RequestOptions<S extends z.ZodTypeAny> {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | boolean | undefined>;
  schema: S;
  /** Prepend a language segment: `/en/` or `/ja/`. */
  lang?: string;
  /** Enable in-memory GET cache for this call. */
  cache?: boolean;
  /** Override headers for tests. */
  extraHeaders?: Record<string, string>;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export class ScrydexClient {
  private readonly api_key: string;
  private readonly team_id: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly CACHE_MAX = 200;

  constructor(opts: ScrydexClientOptions) {
    this.api_key = opts.api_key;
    this.team_id = opts.team_id;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = opts.userAgent ?? 'poke-cli';
  }

  /**
   * Performs a request, retries transient failures once, then parses
   * through the provided zod schema.
   */
  async request<S extends z.ZodTypeAny>(
    path: string,
    opts: RequestOptions<S>,
  ): Promise<z.infer<S>> {
    const method = opts.method ?? 'GET';
    const url = this.buildUrl(path, opts.lang, opts.query);
    const cacheKey = method === 'GET' && opts.cache ? url : undefined;

    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return opts.schema.parse(hit.value);
      }
    }

    const headers: Record<string, string> = {
      'X-Api-Key': this.api_key,
      'X-Team-ID': this.team_id,
      'User-Agent': this.userAgent,
      Accept: 'application/json',
      ...opts.extraHeaders,
    };

    const body = await this.performWithRetries(url, { method, headers });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new NetworkError(`scrydex returned non-JSON response`, { cause: err });
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      throw new NetworkError(
        `scrydex response failed schema at ${path}: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`,
        { cause: result.error },
      );
    }

    if (cacheKey) {
      this.cachePut(cacheKey, result.data);
    }
    return result.data;
  }

  private buildUrl(
    path: string,
    lang: string | undefined,
    query: RequestOptions<z.ZodTypeAny>['query'],
  ): string {
    // Normalize: path may start with '/' or 'cards' etc. We do not want to
    // accidentally resolve against the root of api.scrydex.com, so strip a
    // leading slash before concatenating.
    const trimmed = path.replace(/^\//, '');
    const prefix = lang ? `${lang}/` : '';
    const url = new URL(prefix + trimmed, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async performWithRetries(
    url: string,
    init: { method: string; headers: Record<string, string> },
  ): Promise<string> {
    let attempt = 0;
    const MAX_ATTEMPTS = 2; // one retry = two attempts total
    for (;;) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500);
          continue;
        }
        throw new NetworkError(`scrydex request failed: ${stringifyError(err)}`, {
          cause: err,
        });
      }
      clearTimeout(timer);

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? 1000;
        await sleep(retryAfter);
        continue;
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      if (!res.ok) {
        const snippet = (await safeText(res)).slice(0, 200);
        throw new NetworkError(
          `scrydex ${res.status} ${res.statusText || ''} at ${redact(url)}: ${snippet}`,
        );
      }
      return await res.text();
    }
  }

  private cachePut(key: string, value: unknown): void {
    if (this.cache.size >= this.CACHE_MAX) {
      // Evict an arbitrary (oldest insertion) entry; Map iteration is
      // insertion-order.
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Remove query params from a URL for error messages (avoid leaking ids). */
function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
