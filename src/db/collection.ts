import type { DB } from './migrate.js';

/**
 * Owned-card queries. All times are stored ISO8601 UTC. Tags live in
 * a separate table (phase 9) and are populated lazily by `list`.
 */

export interface OwnedRow {
  id: number;
  card_id: string;
  quantity: number;
  condition: string;
  foil: boolean;
  acquired_at: string;
  acquired_price_cents: number | null;
  note: string | null;
}

export interface AddOwnedArgs {
  card_id: string;
  quantity?: number;
  condition?: string;
  foil?: boolean;
  acquired_at?: string;
  acquired_price_cents?: number | null;
  note?: string | null;
}

/**
 * Insert or increment. Rows are keyed by (card_id, condition, foil): if
 * such a row already exists, we bump `quantity`; otherwise we insert. This
 * matches user intuition ("two NM copies of the same card are one entry
 * with qty 2") while still letting a user track a separate foil or
 * played-condition row via `--foil` / `--condition`.
 */
export function addOwned(db: DB, args: AddOwnedArgs): OwnedRow {
  const quantity = args.quantity ?? 1;
  if (quantity <= 0) {
    throw new Error('quantity must be > 0');
  }
  const condition = args.condition ?? 'NM';
  const foil = args.foil ? 1 : 0;
  const acquired_at = args.acquired_at ?? new Date().toISOString();
  const note = args.note ?? null;
  const price = args.acquired_price_cents ?? null;

  const tx = db.transaction((): OwnedRow => {
    const existing = db
      .prepare(
        `SELECT id FROM owned_cards
           WHERE card_id = ? AND condition = ? AND foil = ?
           LIMIT 1`,
      )
      .get(args.card_id, condition, foil) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE owned_cards
           SET quantity = quantity + ?, note = COALESCE(?, note)
           WHERE id = ?`,
      ).run(quantity, note, existing.id);
      return getOwnedById(db, existing.id)!;
    }

    const info = db
      .prepare(
        `INSERT INTO owned_cards
           (card_id, quantity, condition, foil, acquired_at, acquired_price_cents, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(args.card_id, quantity, condition, foil, acquired_at, price, note);
    return getOwnedById(db, Number(info.lastInsertRowid))!;
  });
  return tx();
}

export interface RemoveArgs {
  card_id: string;
  quantity?: number;
  all?: boolean;
}

export interface RemoveResult {
  rowsAffected: number;
  rowsDeleted: number;
}

export function removeOwned(db: DB, args: RemoveArgs): RemoveResult {
  const tx = db.transaction((): RemoveResult => {
    if (args.all) {
      const info = db.prepare(`DELETE FROM owned_cards WHERE card_id = ?`).run(args.card_id);
      const n = Number(info.changes);
      return { rowsAffected: n, rowsDeleted: n };
    }
    const qty = args.quantity ?? 1;
    if (qty <= 0) throw new Error('quantity must be > 0');
    // Take from oldest row first. Loop one row at a time so we handle
    // spill correctly when the request spans multiple (condition, foil)
    // variants for the same card_id.
    let remaining = qty;
    let rowsAffected = 0;
    let rowsDeleted = 0;
    while (remaining > 0) {
      const row = db
        .prepare(
          `SELECT id, quantity FROM owned_cards
             WHERE card_id = ?
             ORDER BY acquired_at ASC, id ASC
             LIMIT 1`,
        )
        .get(args.card_id) as { id: number; quantity: number } | undefined;
      if (!row) break;
      if (row.quantity > remaining) {
        db.prepare(`UPDATE owned_cards SET quantity = quantity - ? WHERE id = ?`).run(
          remaining,
          row.id,
        );
        rowsAffected++;
        remaining = 0;
      } else {
        db.prepare(`DELETE FROM owned_cards WHERE id = ?`).run(row.id);
        remaining -= row.quantity;
        rowsAffected++;
        rowsDeleted++;
      }
    }
    return { rowsAffected, rowsDeleted };
  });
  return tx();
}

export function getOwnedById(db: DB, id: number): OwnedRow | undefined {
  const row = db
    .prepare(
      `SELECT id, card_id, quantity, condition, foil, acquired_at,
              acquired_price_cents, note
         FROM owned_cards WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        card_id: string;
        quantity: number;
        condition: string;
        foil: number;
        acquired_at: string;
        acquired_price_cents: number | null;
        note: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return { ...row, foil: row.foil !== 0 };
}

export function totalQuantityFor(db: DB, card_id: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(quantity), 0) AS n FROM owned_cards WHERE card_id = ?`)
    .get(card_id) as { n: number };
  return row.n;
}

export interface ListFilters {
  set_id?: string;
  language?: string;
  rarity?: string;
  /** Filter by tier — requires joining the rarities table (phase 7). */
  tier?: string;
  /** Filter by tag — requires joining owned_tags (phase 9). */
  tag?: string;
}

export interface ListedOwnedRow extends OwnedRow {
  card_data: string; // raw JSON from cards.data column
  card_language: string;
  card_set_id: string;
}

/**
 * Join owned_cards × cards (+ optional rarities / owned_tags). Returns one
 * row per owned_cards row; the command layer will sum or group as needed.
 */
export function listOwned(db: DB, filters: ListFilters = {}): ListedOwnedRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.set_id) {
    where.push('c.set_id = ?');
    params.push(filters.set_id);
  }
  if (filters.language) {
    where.push('c.language_code = ?');
    params.push(filters.language);
  }
  if (filters.rarity) {
    where.push(`json_extract(c.data, '$.rarity') = ?`);
    params.push(filters.rarity);
  }

  let joins = '';
  if (filters.tier) {
    // Latest-wins tier for (lang, rarity). Rarities table has source
    // ordering: 'user' > 'default'. Pick either if present.
    joins += ` LEFT JOIN rarities r
                 ON r.language_code = c.language_code
                AND r.rarity_name = json_extract(c.data, '$.rarity')`;
    where.push('r.tier = ?');
    params.push(filters.tier);
  }
  if (filters.tag) {
    joins += ` JOIN owned_tags ot ON ot.owned_id = o.id
               JOIN tags t ON t.id = ot.tag_id AND t.name = ?`;
    params.push(filters.tag);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT o.id, o.card_id, o.quantity, o.condition, o.foil,
              o.acquired_at, o.acquired_price_cents, o.note,
              c.data AS card_data,
              c.language_code AS card_language,
              c.set_id AS card_set_id
         FROM owned_cards o
         JOIN cards c ON c.id = o.card_id
         ${joins}
         ${whereSql}
         ORDER BY c.set_id, json_extract(c.data, '$.number'), o.id`,
    )
    .all(...params) as {
    id: number;
    card_id: string;
    quantity: number;
    condition: string;
    foil: number;
    acquired_at: string;
    acquired_price_cents: number | null;
    note: string | null;
    card_data: string;
    card_language: string;
    card_set_id: string;
  }[];

  return rows.map((r) => ({ ...r, foil: r.foil !== 0 }));
}

export function listOwnedCardIds(db: DB): string[] {
  const rows = db.prepare(`SELECT DISTINCT card_id FROM owned_cards ORDER BY card_id`).all() as {
    card_id: string;
  }[];
  return rows.map((r) => r.card_id);
}
