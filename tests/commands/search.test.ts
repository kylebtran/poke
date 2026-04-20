import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { openTestDb } from '../helpers/db.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { runSearch } from '../../src/commands/search.js';

class Buf extends Writable {
  chunks: string[] = [];
  override _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(c.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('runSearch', () => {
  it('forwards query verbatim', async () => {
    const db = openTestDb();
    const { fetch, calls } = mockFetch([
      { match: '/cards?', fixture: 'cards-search-sv4.json' },
    ]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const out = new Buf();
    await runSearch('rarity:"Illustration Rare" set.id:sv4', {
      db,
      client,
      out,
      format: 'ndjson',
      limit: 5,
    });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('q')).toBe('rarity:"Illustration Rare" set.id:sv4');
    expect(u.searchParams.get('page_size')).toBe('5');
    const lines = out.text().trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
