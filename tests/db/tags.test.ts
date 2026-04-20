import { describe, it, expect } from 'vitest';
import { openTestDb } from '../helpers/db.js';
import { putCachedCard } from '../../src/db/cache.js';
import { addOwned } from '../../src/db/collection.js';
import {
  upsertTag,
  addTagToOwnedByCardId,
  removeTagFromOwnedByCardId,
  tagsForCardId,
  tagsForOwnedIds,
} from '../../src/db/tags.js';
import type { Card } from '../../src/scrydex/schemas.js';

const charizard: Card = {
  id: 'sv4-23',
  name: 'Charizard ex',
  number: '23',
  language_code: 'en',
  set: { id: 'sv4', language_code: 'en' },
};

describe('tags', () => {
  it('upsertTag is idempotent', () => {
    const db = openTestDb();
    const a = upsertTag(db, 'grail');
    const b = upsertTag(db, 'grail');
    expect(a).toBe(b);
  });

  it('addTagToOwnedByCardId applies to every owned row', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23', foil: true });
    const n = addTagToOwnedByCardId(db, 'sv4-23', 'grail');
    expect(n).toBe(2);
    expect(tagsForCardId(db, 'sv4-23')).toEqual(['grail']);
  });

  it('cascade delete on owned_card removal', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addTagToOwnedByCardId(db, 'sv4-23', 'grail');
    db.prepare(`DELETE FROM owned_cards`).run();
    const rows = db.prepare(`SELECT * FROM owned_tags`).all();
    expect(rows).toHaveLength(0);
  });

  it('removeTagFromOwnedByCardId returns affected count', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    addOwned(db, { card_id: 'sv4-23' });
    addOwned(db, { card_id: 'sv4-23', foil: true });
    addTagToOwnedByCardId(db, 'sv4-23', 'grail');
    const removed = removeTagFromOwnedByCardId(db, 'sv4-23', 'grail');
    expect(removed).toBe(2);
    expect(tagsForCardId(db, 'sv4-23')).toEqual([]);
  });

  it('tagsForOwnedIds batch lookup', () => {
    const db = openTestDb();
    putCachedCard(db, charizard);
    const r1 = addOwned(db, { card_id: 'sv4-23' });
    const r2 = addOwned(db, { card_id: 'sv4-23', foil: true });
    addTagToOwnedByCardId(db, 'sv4-23', 'grail');
    const map = tagsForOwnedIds(db, [r1.id, r2.id]);
    expect(map.get(r1.id)).toEqual(['grail']);
    expect(map.get(r2.id)).toEqual(['grail']);
  });
});
