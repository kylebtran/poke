import type { DB } from './migrate.js';

/**
 * Tag storage. Tags attach to `owned_cards` rows, not to `cards`. When a
 * record coming from a pipe is keyed only by `card_id` (not `owned_id`),
 * we apply the tag to every owned row for that card — that's what users
 * expect from `poke list --tier secret | poke tag --add grail`.
 */

/** Insert-if-missing; returns the row's id. */
export function upsertTag(db: DB, name: string): number {
  const existing = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(name);
  return Number(info.lastInsertRowid);
}

export function getTagId(db: DB, name: string): number | undefined {
  const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as
    | { id: number }
    | undefined;
  return row?.id;
}

/** Number of owned_cards rows that matched the card_id. */
export function addTagToOwnedByCardId(db: DB, card_id: string, tag: string): number {
  const tx = db.transaction((): number => {
    const tagId = upsertTag(db, tag);
    const rows = db
      .prepare(`SELECT id FROM owned_cards WHERE card_id = ?`)
      .all(card_id) as { id: number }[];
    for (const r of rows) {
      db.prepare(
        `INSERT OR IGNORE INTO owned_tags (owned_id, tag_id) VALUES (?, ?)`,
      ).run(r.id, tagId);
    }
    return rows.length;
  });
  return tx();
}

export function addTagToOwnedById(db: DB, owned_id: number, tag: string): void {
  const tx = db.transaction(() => {
    const tagId = upsertTag(db, tag);
    db.prepare(
      `INSERT OR IGNORE INTO owned_tags (owned_id, tag_id) VALUES (?, ?)`,
    ).run(owned_id, tagId);
  });
  tx();
}

export function removeTagFromOwnedByCardId(db: DB, card_id: string, tag: string): number {
  const tagId = getTagId(db, tag);
  if (tagId === undefined) return 0;
  const info = db
    .prepare(
      `DELETE FROM owned_tags
         WHERE tag_id = ?
           AND owned_id IN (SELECT id FROM owned_cards WHERE card_id = ?)`,
    )
    .run(tagId, card_id);
  return Number(info.changes);
}

export function removeTagFromOwnedById(db: DB, owned_id: number, tag: string): void {
  const tagId = getTagId(db, tag);
  if (tagId === undefined) return;
  db.prepare(`DELETE FROM owned_tags WHERE owned_id = ? AND tag_id = ?`).run(
    owned_id,
    tagId,
  );
}

export function tagsForCardId(db: DB, card_id: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.name FROM owned_tags ot
         JOIN tags t ON t.id = ot.tag_id
         JOIN owned_cards o ON o.id = ot.owned_id
         WHERE o.card_id = ?
         ORDER BY t.name`,
    )
    .all(card_id) as { name: string }[];
  return rows.map((r) => r.name);
}

export function tagsForOwnedIds(db: DB, ownedIds: readonly number[]): Map<number, string[]> {
  if (ownedIds.length === 0) return new Map();
  const placeholders = ownedIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ot.owned_id, t.name FROM owned_tags ot
         JOIN tags t ON t.id = ot.tag_id
         WHERE ot.owned_id IN (${placeholders})
         ORDER BY t.name`,
    )
    .all(...(ownedIds as number[])) as { owned_id: number; name: string }[];
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const list = out.get(r.owned_id) ?? [];
    list.push(r.name);
    out.set(r.owned_id, list);
  }
  return out;
}
