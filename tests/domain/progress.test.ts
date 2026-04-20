import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import { computeProgress } from '../../src/domain/progress.js';
import type { Card } from '../../src/scrydex/schemas.js';

function card(id: string, rarity: string): Card {
  const number = id.split('-').slice(1).join('-') || id;
  return {
    id,
    name: `card-${id}`,
    number,
    rarity,
    language_code: 'en',
    set: { id: 'sv4', language_code: 'en' },
  };
}

describe('computeProgress', () => {
  it('aggregates owned vs total by rarity', () => {
    const db = openTestDb();
    // Seed 5 cards: 2 Common, 3 Rare
    putCachedCard(db, card('sv4-1', 'Common'));
    putCachedCard(db, card('sv4-2', 'Common'));
    putCachedCard(db, card('sv4-3', 'Rare'));
    putCachedCard(db, card('sv4-4', 'Rare'));
    putCachedCard(db, card('sv4-5', 'Rare'));
    // Own 2 Commons, 1 Rare
    addOwned(db, { card_id: 'sv4-1' });
    addOwned(db, { card_id: 'sv4-2' });
    addOwned(db, { card_id: 'sv4-3' });

    const p = computeProgress(db, { set_id: 'sv4', by: 'rarity' });
    expect(p.totals.Common).toEqual({ owned: 2, total: 2 });
    expect(p.totals.Rare).toEqual({ owned: 1, total: 3 });
    expect(p.grand).toEqual({ owned: 3, total: 5 });
  });

  it('does not double-count quantity', () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 'Rare'));
    addOwned(db, { card_id: 'sv4-1', quantity: 5 });
    const p = computeProgress(db, { set_id: 'sv4', by: 'rarity' });
    expect(p.totals.Rare).toEqual({ owned: 1, total: 1 });
  });

  it('groups by tier when by=tier', () => {
    const db = openTestDb();
    putCachedCard(db, card('sv4-1', 'Common'));
    putCachedCard(db, card('sv4-2', 'Double Rare'));
    putCachedCard(db, card('sv4-3', 'Special Illustration Rare'));
    addOwned(db, { card_id: 'sv4-1' });
    addOwned(db, { card_id: 'sv4-3' });
    const p = computeProgress(db, { set_id: 'sv4', by: 'tier' });
    expect(p.totals.common).toEqual({ owned: 1, total: 1 });
    expect(p.totals.rare).toEqual({ owned: 0, total: 1 });
    expect(p.totals.secret).toEqual({ owned: 1, total: 1 });
  });
});
