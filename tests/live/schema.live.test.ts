import { describe, it, expect } from 'vitest';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { getCardById, searchCards } from '../../src/scrydex/cards.js';
import { listSets } from '../../src/scrydex/sets.js';

/**
 * Live contract tests. These confirm that the fields our schemas require
 * continue to be present in real Scrydex responses. Skipped unless both
 * credentials are in the environment.
 */

const skip = !process.env.SCRYDEX_API_KEY || !process.env.SCRYDEX_TEAM_ID;

describe.skipIf(skip)('Scrydex live contract', () => {
  const client = new ScrydexClient({
    api_key: process.env.SCRYDEX_API_KEY!,
    team_id: process.env.SCRYDEX_TEAM_ID!,
  });

  it('listSets returns at least one set with the fields we rely on', async () => {
    const sets = await listSets(client, { lang: 'en', limit: 10 });
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.name).toBe('string');
    }
  });

  it('searchCards with a known filter returns cards with id/name', async () => {
    const cards = await searchCards(client, 'set.id:sv4', { lang: 'en', limit: 3 });
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.name).toBe('string');
    }
  });

  it('getCardById for the first search hit returns a consistent record', async () => {
    const cards = await searchCards(client, 'set.id:sv4', { lang: 'en', limit: 1 });
    expect(cards.length).toBeGreaterThan(0);
    const c = await getCardById(client, cards[0]!.id, { lang: 'en' });
    expect(c.id).toBe(cards[0]!.id);
  });
});
