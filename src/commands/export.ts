import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { openDatabase, type DB } from '../db/migrate.js';
import { listOwned } from '../db/collection.js';
import { tagsForOwnedIds } from '../db/tags.js';
import { writeCsv } from '../io/csv.js';

const HEADERS = [
  'card_id',
  'quantity',
  'condition',
  'foil',
  'acquired_price',
  'tags',
  'note',
] as const;

export interface ExportOptions {
  db?: DB;
  /** If set, write CSV to this path. */
  filePath?: string;
  /** If false, do not write to process.stdout (used by tests). */
  stdout?: boolean;
}

export async function runExport(opts: ExportOptions = {}): Promise<string> {
  const db = opts.db ?? openDatabase();
  try {
    const rows = listOwned(db);
    const tagMap = tagsForOwnedIds(
      db,
      rows.map((r) => r.id),
    );
    const out: string[][] = [Array.from(HEADERS)];
    for (const r of rows) {
      out.push([
        r.card_id,
        String(r.quantity),
        r.condition,
        r.foil ? 'true' : 'false',
        r.acquired_price_cents !== null ? (r.acquired_price_cents / 100).toFixed(2) : '',
        (tagMap.get(r.id) ?? []).join(';'),
        r.note ?? '',
      ]);
    }
    const text = writeCsv(out);
    if (opts.filePath) {
      writeFileSync(opts.filePath, text);
    } else if (opts.stdout !== false) {
      process.stdout.write(text);
    }
    return text;
  } finally {
    if (!opts.db) db.close();
  }
}

export function registerExportCommand(program: Command): void {
  program
    .command('export [file]')
    .description('dump owned cards to CSV (stdout if no file)')
    .action(async (file: string | undefined) => {
      await runExport(file ? { filePath: file } : {});
    });
}
