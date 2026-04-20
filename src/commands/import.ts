import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { openDatabase, type DB } from '../db/migrate.js';
import { parseCsv } from '../io/csv.js';
import { addOwned } from '../db/collection.js';
import { addTagToOwnedById } from '../db/tags.js';
import { getCachedCard, putCachedCard } from '../db/cache.js';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { getCardById } from '../scrydex/cards.js';
import { UserError } from '../errors.js';

/**
 * CSV columns, in order (spec §8):
 *   card_id,quantity,condition,foil,acquired_price,tags,note
 * `tags` is semicolon-separated inside the cell.
 */
const EXPECTED_HEADERS = [
  'card_id',
  'quantity',
  'condition',
  'foil',
  'acquired_price',
  'tags',
  'note',
] as const;

export interface ImportOptions {
  db?: DB;
  client?: ScrydexClient;
  stderr?: NodeJS.WritableStream;
  /** For tests: bypass file I/O with preloaded text. */
  text?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export async function runImport(filePath: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const text = opts.text ?? readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new UserError(`CSV ${filePath} is empty`);
  }
  const header = rows[0]!.map((s) => s.trim().toLowerCase());
  for (const h of EXPECTED_HEADERS) {
    if (!header.includes(h)) {
      throw new UserError(`CSV header missing required column '${h}'`, {
        hint: `columns: ${EXPECTED_HEADERS.join(',')}`,
      });
    }
  }
  const idx = Object.fromEntries(EXPECTED_HEADERS.map((h) => [h, header.indexOf(h)])) as Record<
    (typeof EXPECTED_HEADERS)[number],
    number
  >;

  const db = opts.db ?? openDatabase();
  const stderr = opts.stderr ?? process.stderr;
  // Client is lazy — only constructed if we need to fetch a missing card.
  let client: ScrydexClient | null = opts.client ?? null;

  const result: ImportResult = { imported: 0, skipped: 0 };
  try {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      const cardId = r[idx.card_id]?.trim();
      if (!cardId) {
        result.skipped++;
        stderr.write(`row ${i + 1}: skip (empty card_id)\n`);
        continue;
      }
      try {
        const quantity = parseIntCell(r[idx.quantity]) ?? 1;
        const condition = r[idx.condition]?.trim() || 'NM';
        const foil = parseBoolCell(r[idx.foil]);
        const priceCell = r[idx.acquired_price]?.trim() ?? '';
        const acquired_price_cents = priceCell === '' ? undefined : Math.round(Number.parseFloat(priceCell) * 100);
        const note = r[idx.note]?.trim() || undefined;
        const tagsCell = r[idx.tags]?.trim() ?? '';
        const tagNames = tagsCell === '' ? [] : tagsCell.split(';').map((t) => t.trim()).filter(Boolean);

        // Ensure card is cached.
        if (!getCachedCard(db, cardId)) {
          if (!client) client = new ScrydexClient(requireAuth());
          const fetched = await getCardById(client, cardId);
          putCachedCard(db, fetched);
        }

        const row = addOwned(db, {
          card_id: cardId,
          quantity,
          condition,
          foil,
          ...(acquired_price_cents !== undefined ? { acquired_price_cents } : {}),
          ...(note !== undefined ? { note } : {}),
        });
        for (const t of tagNames) {
          addTagToOwnedById(db, row.id, t);
        }
        result.imported++;
      } catch (err) {
        result.skipped++;
        stderr.write(
          `row ${i + 1} (${cardId}): ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    stderr.write(`imported ${result.imported}, skipped ${result.skipped}\n`);
    return result;
  } finally {
    if (!opts.db) db.close();
  }
}

function parseIntCell(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolCell(v: string | undefined): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === 'true' || t === 'yes' || t === '1';
}

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description(`bulk import from CSV (${EXPECTED_HEADERS.join(',')})`)
    .action(async (file: string) => {
      await runImport(file);
    });
}
