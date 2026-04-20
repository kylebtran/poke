import { Command } from 'commander';
import { Writable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import { computeProgress } from '../domain/progress.js';
import { emit, type TableSpec } from '../io/emit.js';
import { UserError } from '../errors.js';

interface SetProgressRow {
  _schema: 'poke.setprogress/v1';
  set_id: string;
  rarity: string;
  owned: number;
  total: number;
}

const SET_SPEC: TableSpec<SetProgressRow> = {
  columns: [
    { header: 'rarity', get: (r) => r.rarity },
    { header: 'owned', get: (r) => r.owned, align: 'right' },
    { header: 'total', get: (r) => r.total, align: 'right' },
  ],
  empty: 'set not in cache (try poke sets or poke refresh)',
};

export interface SetOptions {
  db?: DB;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * `poke set <set-id>` — per-rarity completion for one set.
 *
 * Emits one record per rarity row, so consumers can pipe the output
 * through `filter` / `sort` just like any other source command. The
 * `_schema` is set-progress specific (not CardRecord).
 */
export async function runSet(setId: string, opts: SetOptions = {}): Promise<void> {
  if (!setId) throw new UserError('set id required');
  const db = opts.db ?? openDatabase();
  try {
    const progress = computeProgress(db, { set_id: setId, by: 'rarity' });
    const rows: SetProgressRow[] = Object.keys(progress.totals)
      .sort()
      .map((rarity) => ({
        _schema: 'poke.setprogress/v1' as const,
        set_id: setId,
        rarity,
        owned: progress.totals[rarity]!.owned,
        total: progress.totals[rarity]!.total,
      }));
    await emit(rows, SET_SPEC, {
      out: opts.out,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

export function registerSetCommand(program: Command): void {
  program
    .command('set <set-id>')
    .description('per-rarity completion for one set')
    .action(async (setId: string, _opts: Record<string, never>, cmd: Command) => {
      const globals = cmd.parent?.opts() ?? {};
      await runSet(setId, {
        format: globals.format as string | undefined,
        json: globals.json as boolean | undefined,
        noColor: globals.color === false,
      });
    });
}
