import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import {
  getCachedCard,
  putCachedCard,
  getCachedSet,
  putCachedSet,
  isStale,
  TTL,
} from '../../src/db/cache.js';
import type { Card, Set as PokeSet } from '../../src/scrydex/schemas.js';

const sampleCard: Card = {
  id: 'sv4-23',
  name: 'Charizard ex',
  number: '23',
  rarity: 'Double Rare',
  language_code: 'en',
  set: { id: 'sv4', name: 'Paradox Rift', language_code: 'en' },
};

const sampleSet: PokeSet = {
  id: 'sv4',
  name: 'Paradox Rift',
  language_code: 'en',
  total: 182,
};

describe('cache put/get', () => {
  it('round-trips a card with fetched_at', () => {
    const db = openTestDb();
    putCachedCard(db, sampleCard, new Date('2026-04-15T00:00:00Z'));
    const hit = getCachedCard(db, 'sv4-23');
    expect(hit).toBeDefined();
    expect(hit!.data.name).toBe('Charizard ex');
    expect(hit!.language_code).toBe('en');
    expect(hit!.set_id).toBe('sv4');
    expect(hit!.fetched_at).toBe('2026-04-15T00:00:00.000Z');
  });

  it('upserts on conflict', () => {
    const db = openTestDb();
    putCachedCard(db, sampleCard, new Date('2026-04-15T00:00:00Z'));
    const updated: Card = { ...sampleCard, name: 'Charizard ex (updated)' };
    putCachedCard(db, updated, new Date('2026-04-16T00:00:00Z'));
    const hit = getCachedCard(db, 'sv4-23')!;
    expect(hit.data.name).toBe('Charizard ex (updated)');
    expect(hit.fetched_at).toBe('2026-04-16T00:00:00.000Z');
  });

  it('round-trips a set', () => {
    const db = openTestDb();
    putCachedSet(db, sampleSet, new Date('2026-04-15T00:00:00Z'));
    const hit = getCachedSet(db, 'sv4');
    expect(hit!.data.total).toBe(182);
  });

  it('returns undefined for a miss', () => {
    const db = openTestDb();
    expect(getCachedCard(db, 'nope')).toBeUndefined();
    expect(getCachedSet(db, 'nope')).toBeUndefined();
  });
});

describe('isStale()', () => {
  const now = new Date('2026-04-20T12:00:00Z');
  it('fresh when inside TTL', () => {
    expect(isStale('2026-04-20T11:00:00Z', TTL.CARD_MS, now)).toBe(false);
  });
  it('stale when outside TTL', () => {
    expect(isStale('2026-01-01T00:00:00Z', TTL.CARD_MS, now)).toBe(true);
  });
  it('stale for malformed date', () => {
    expect(isStale('oops', 1000, now)).toBe(true);
  });
});
