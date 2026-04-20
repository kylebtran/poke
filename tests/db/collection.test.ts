import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import {
  addOwned,
  removeOwned,
  totalQuantityFor,
  listOwned,
  listOwnedCardIds,
} from '../../src/db/collection.js';
import { putCachedCard } from '../../src/db/cache.js';
import type { Card } from '../../src/scrydex/schemas.js';

const charizard: Card = {
  id: 'sv4-23',
  name: 'Charizard ex',
  number: '23',
  rarity: 'Double Rare',
  language_code: 'en',
  set: { id: 'sv4', name: 'Paradox Rift', language_code: 'en' },
};

const pineco: Card = {
  id: 'sv10_ja-1',
  name: 'クヌギダマ',
  number: '1',
  rarity: '通常',
  language_code: 'ja',
  set: { id: 'sv10_ja', name: 'Mega Brave', language_code: 'ja' },
};

describe('addOwned', () => {
  it('inserts a new row', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    expect(totalQuantityFor(db, 'sv4-23')).toBe(1);
  });

  it('increments when (card, condition, foil) matches', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23' });
    expect(totalQuantityFor(db, 'sv4-23')).toBe(2);
    const rows = listOwned(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(2);
  });

  it('creates a separate row for foil vs non-foil', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23', foil: true });
    const rows = listOwned(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.foil).sort()).toEqual([false, true]);
  });
});

describe('removeOwned', () => {
  it('decrements then deletes', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23', quantity: 3 });
    removeOwned(db, { card_id: 'sv4-23' }); // -1 → 2
    expect(totalQuantityFor(db, 'sv4-23')).toBe(2);
    removeOwned(db, { card_id: 'sv4-23', quantity: 2 }); // -2 → 0
    expect(totalQuantityFor(db, 'sv4-23')).toBe(0);
    expect(listOwned(db)).toHaveLength(0);
  });

  it('--all wipes every variant', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23', foil: true });
    const r = removeOwned(db, { card_id: 'sv4-23', all: true });
    expect(r.rowsDeleted).toBe(2);
    expect(totalQuantityFor(db, 'sv4-23')).toBe(0);
  });

  it('spills across variants when removing > one row quantity', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23', quantity: 2 });
    addOwned(db, { card_id: 'sv4-23', foil: true, quantity: 1 });
    const r = removeOwned(db, { card_id: 'sv4-23', quantity: 3 });
    expect(r.rowsDeleted).toBe(2);
    expect(totalQuantityFor(db, 'sv4-23')).toBe(0);
  });
});

describe('listOwned filters', () => {
  it('filters by set and language', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    putCachedCard(db, pineco);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv10_ja-1' });
    expect(listOwned(db)).toHaveLength(2);
    expect(listOwned(db, { set_id: 'sv4' })).toHaveLength(1);
    expect(listOwned(db, { language: 'ja' })).toHaveLength(1);
    expect(listOwned(db, { language: 'ja' })[0]!.card_id).toBe('sv10_ja-1');
  });

  it('listOwnedCardIds returns distinct ids', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23', foil: true });
    expect(listOwnedCardIds(db)).toEqual(['sv4-23']);
  });
});
