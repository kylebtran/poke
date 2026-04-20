import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import { tierOf, setUserTier, isTier } from '../../src/domain/rarity.js';

describe('tierOf', () => {
  it('returns default tier for known EN rarities', () => {
    const db = openTestDb();
    expect(tierOf(db, 'en', 'Common')).toBe('common');
    expect(tierOf(db, 'en', 'Double Rare')).toBe('rare');
    expect(tierOf(db, 'en', 'Special Illustration Rare')).toBe('secret');
  });

  it('returns unknown for unseen rarity and persists a default row', () => {
    const db = openTestDb();
    expect(tierOf(db, 'en', 'Fancy New Rarity')).toBe('unknown');
    const row = db
      .prepare(`SELECT tier, source FROM rarities WHERE rarity_name = ?`)
      .get('Fancy New Rarity') as { tier: string; source: string };
    expect(row.tier).toBe('unknown');
    expect(row.source).toBe('default');
  });

  it('user override wins over default', () => {
    const db = openTestDb();
    expect(tierOf(db, 'en', 'Double Rare')).toBe('rare'); // default
    setUserTier(db, 'en', 'Double Rare', 'ultra');
    expect(tierOf(db, 'en', 'Double Rare')).toBe('ultra');
    const row = db
      .prepare(`SELECT source FROM rarities WHERE rarity_name = ?`)
      .get('Double Rare') as { source: string };
    expect(row.source).toBe('user');
  });

  it('handles JA rarity strings', () => {
    const db = openTestDb();
    expect(tierOf(db, 'ja', '通常')).toBe('common');
    expect(tierOf(db, 'ja', 'SAR')).toBe('secret');
  });
});

describe('isTier', () => {
  it('accepts canonical names only', () => {
    expect(isTier('common')).toBe(true);
    expect(isTier('secret')).toBe(true);
    expect(isTier('nope')).toBe(false);
  });
});
