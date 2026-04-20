import type { DB } from '../db/migrate.js';
import type { ScrydexClient } from '../scrydex/client.js';
import { searchCards } from '../scrydex/cards.js';
import { putCachedCard } from '../db/cache.js';
import { UserError } from '../errors.js';

/**
 * Resolve a user-supplied card reference to a canonical Scrydex ID.
 *
 * Accepted forms:
 *   - Canonical id: `sv10_ja-1`. Returned as-is.
 *   - `<set>:<number>`: `sv10_ja:1`. Resolved against the DB, then the
 *     Scrydex `q=set.id:<set> number:<num>` search if absent.
 *
 * On resolution via search, the found card is cached so subsequent lookups
 * are local. Ambiguous searches (multiple hits) are a UserError.
 */
export async function resolveCardRef(
  db: DB,
  client: ScrydexClient,
  ref: string,
  opts: { lang?: string } = {},
): Promise<string> {
  if (ref.includes(':')) {
    const [setId, number] = splitOnce(ref, ':');
    if (!setId || !number) {
      throw new UserError(`invalid card ref '${ref}'`, {
        hint: 'use <set>:<number> or the full Scrydex id',
      });
    }
    const local = db
      .prepare(
        `SELECT id FROM cards
           WHERE set_id = ? AND json_extract(data, '$.number') = ?
           LIMIT 1`,
      )
      .get(setId, number) as { id: string } | undefined;
    if (local) return local.id;
    const lang = opts.lang ?? inferLang(setId);
    const q = `set.id:${setId} number:${number}`;
    const results = await searchCards(client, q, lang ? { lang, limit: 2 } : { limit: 2 });
    if (results.length === 0) {
      throw new UserError(`no card matches '${ref}'`, {
        hint: `try 'poke search "${q}"'`,
      });
    }
    if (results.length > 1) {
      throw new UserError(`'${ref}' matched ${results.length} cards`, {
        hint: 'use the canonical Scrydex id to disambiguate',
      });
    }
    const card = results[0]!;
    putCachedCard(db, card);
    return card.id;
  }
  return ref;
}

function splitOnce(s: string, sep: string): [string, string] | [] {
  const i = s.indexOf(sep);
  if (i < 0) return [];
  return [s.slice(0, i), s.slice(i + 1)];
}

function inferLang(setId: string): string | undefined {
  if (setId.endsWith('_ja')) return 'ja';
  if (setId.endsWith('_en')) return 'en';
  return undefined;
}
