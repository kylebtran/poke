import { describe, it, expect } from 'vitest';
import { parsePredicate, resolveField } from '../../src/filter/predicate.js';
import { SCHEMA_ID, type CardRecord } from '../../src/domain/card.js';
import { UserError } from '../../src/errors.js';

function r(over: Partial<CardRecord> = {}): CardRecord {
  return {
    _schema: SCHEMA_ID,
    id: 'sv4-23',
    name: 'Charizard ex',
    set_id: 'sv4',
    lang: 'en',
    rarity: 'Double Rare',
    tier: 'rare',
    price: {
      currency: 'USD',
      market: 12.5,
      source: 'tcgplayer',
      fetched_at: '2026-04-20T00:00:00Z',
    },
    owned: { quantity: 2, condition: 'NM', foil: false, tags: ['binder', 'psa10'] },
    ...over,
  };
}

describe('parsePredicate', () => {
  it('parses simple equality', () => {
    const p = parsePredicate('tier=secret');
    expect(p.field).toBe('tier');
    expect(p.op).toBe('=');
    expect(p.value).toBe('secret');
  });

  it('parses compound field path', () => {
    const p = parsePredicate('price.market > 50');
    expect(p.field).toBe('price.market');
    expect(p.op).toBe('>');
    expect(p.value).toBe('50');
  });

  it('supports ~, !=, >=, <=', () => {
    expect(parsePredicate('name~charizard').op).toBe('~');
    expect(parsePredicate('tier!=common').op).toBe('!=');
    expect(parsePredicate('price.market>=50').op).toBe('>=');
    expect(parsePredicate('price.market<=50').op).toBe('<=');
  });

  it('unquotes values with embedded spaces', () => {
    const p = parsePredicate('rarity="Illustration Rare"');
    expect(p.value).toBe('Illustration Rare');
  });

  it('rejects malformed input', () => {
    expect(() => parsePredicate('')).toThrow(UserError);
    expect(() => parsePredicate('name')).toThrow(UserError);
    expect(() => parsePredicate('=foo')).toThrow(UserError);
    expect(() => parsePredicate('123=foo')).toThrow(UserError);
  });
});

describe('predicate.test()', () => {
  it('numeric >, <, >=, <=', () => {
    const rec = r();
    expect(parsePredicate('price.market>10').test(rec)).toBe(true);
    expect(parsePredicate('price.market>20').test(rec)).toBe(false);
    expect(parsePredicate('price.market<=12.5').test(rec)).toBe(true);
  });

  it('value alias multiplies by owned quantity', () => {
    // 12.5 * 2 = 25
    expect(parsePredicate('value>20').test(r())).toBe(true);
    expect(parsePredicate('value>30').test(r())).toBe(false);
  });

  it('tier=secret — equality against string field', () => {
    expect(parsePredicate('tier=secret').test(r({ tier: 'secret' }))).toBe(true);
    expect(parsePredicate('tier=secret').test(r({ tier: 'rare' }))).toBe(false);
  });

  it('substring (~) is case-insensitive', () => {
    expect(parsePredicate('name~CHARI').test(r())).toBe(true);
    expect(parsePredicate('name~pika').test(r())).toBe(false);
  });

  it('tag alias tests membership', () => {
    expect(parsePredicate('tag=psa10').test(r())).toBe(true);
    expect(parsePredicate('tag=nope').test(r())).toBe(false);
  });

  it('returns false for missing numeric field with comparators', () => {
    const rec = r({ price: null });
    expect(parsePredicate('price.market>1').test(rec)).toBe(false);
    // value with null price becomes undefined → false
    expect(parsePredicate('value>1').test(rec)).toBe(false);
  });
});

describe('resolveField direct', () => {
  it('handles dotted paths', () => {
    expect(resolveField(r(), 'owned.quantity')).toBe(2);
    expect(resolveField(r(), 'price.market')).toBe(12.5);
  });
});
