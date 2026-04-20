import { Command } from 'commander';
import { Writable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import { getCachedSet } from '../db/cache.js';
import { computeProgress, sortedTierKeys, type Bucket } from '../domain/progress.js';
import { emit, type TableSpec } from '../io/emit.js';
import { progressBar, formatPercent } from '../ui/format.js';
import { resolveMode, shouldColor } from '../io/tty.js';
import { paletteFor } from '../ui/colors.js';
import { UserError } from '../errors.js';

export interface ProgressOptions {
  set_id?: string;
  lang?: string;
  by?: 'rarity' | 'tier';
  db?: DB;
  out?: NodeJS.WritableStream | Writable;
  format?: string;
  json?: boolean;
  noColor?: boolean;
  /** Force-enable color regardless of TTY / env (used by tests). */
  color?: boolean;
}

/**
 * `poke progress` — completion summary.
 *
 * TTY output matches spec §9's sample format exactly:
 *   sv10_ja  Mega Brave  ████████░░░░  42/98 (43%)  common 30/40 · rare ...
 *
 * NDJSON output emits one record per (set, by-key) combo so it can pipe
 * into filter/sort like any other stream.
 */
export async function runProgress(opts: ProgressOptions = {}): Promise<void> {
  const db = opts.db ?? openDatabase();
  const out = opts.out ?? process.stdout;
  const by = opts.by ?? 'rarity';
  try {
    if (!opts.set_id) {
      throw new UserError('--set <id> is required for now', {
        hint: 'per-collection progress across all sets will land in a later phase',
      });
    }

    const progress = computeProgress(db, { set_id: opts.set_id, by });
    const set = getCachedSet(db, opts.set_id);
    const setName = set?.data.name ?? opts.set_id;

    const isTTY = Boolean((out as NodeJS.WriteStream).isTTY ?? process.stdout.isTTY);
    const mode = resolveMode({ isTTY, format: opts.format, json: opts.json });

    if (mode === 'table') {
      const colorEnabled =
        opts.color ?? shouldColor({ isTTY, noColor: opts.noColor === true });
      const palette = paletteFor(colorEnabled);
      const bar = progressBar(progress.grand.owned, progress.grand.total);
      const pct = formatPercent(progress.grand.owned, progress.grand.total);
      const pctNum =
        progress.grand.total === 0 ? 0 : progress.grand.owned / progress.grand.total;
      const colorBar =
        pctNum >= 0.8
          ? palette.success
          : pctNum >= 0.4
            ? palette.warn
            : pctNum > 0
              ? palette.error
              : palette.muted;
      const keys = by === 'tier' ? sortedTierKeys(progress.totals) : Object.keys(progress.totals).sort();
      const segs = keys
        .map((k) => `${k} ${progress.totals[k]!.owned}/${progress.totals[k]!.total}`)
        .join(' · ');
      const line =
        `${opts.set_id}  ${setName}  ${colorBar(bar)}  ` +
        `${progress.grand.owned}/${progress.grand.total} (${pct})   ${palette.muted(segs)}`;
      out.write(line + '\n');
      return;
    }

    // Stream mode: one record per bucket key.
    const records = toRecords(opts.set_id, setName, by, progress.totals);
    await emit(records, PROGRESS_SPEC, {
      out,
      mode,
      format: opts.format,
      json: opts.json,
      noColor: opts.noColor,
    });
  } finally {
    if (!opts.db) db.close();
  }
}

interface ProgressRecord {
  _schema: 'poke.progress/v1';
  set_id: string;
  set_name: string;
  by: 'rarity' | 'tier';
  key: string;
  owned: number;
  total: number;
  percent: number;
}

function toRecords(
  set_id: string,
  set_name: string,
  by: 'rarity' | 'tier',
  totals: Record<string, Bucket>,
): ProgressRecord[] {
  const keys = by === 'tier' ? sortedTierKeys(totals) : Object.keys(totals).sort();
  return keys.map((k) => ({
    _schema: 'poke.progress/v1' as const,
    set_id,
    set_name,
    by,
    key: k,
    owned: totals[k]!.owned,
    total: totals[k]!.total,
    percent: totals[k]!.total === 0 ? 0 : Math.round((totals[k]!.owned / totals[k]!.total) * 100),
  }));
}

const PROGRESS_SPEC: TableSpec<ProgressRecord> = {
  columns: [
    { header: 'set', get: (r) => r.set_id },
    { header: 'key', get: (r) => r.key },
    { header: 'owned', get: (r) => r.owned, align: 'right' },
    { header: 'total', get: (r) => r.total, align: 'right' },
    { header: 'pct', get: (r) => r.percent, align: 'right' },
  ],
};

export function registerProgressCommand(program: Command): void {
  program
    .command('progress')
    .description('completion summary for a set')
    .option('--set <id>', 'set id')
    .option('--lang <code>', 'language scope (en|ja)')
    .option('--by <mode>', 'group by: rarity|tier', 'rarity')
    .action(
      async (
        opts: { set?: string; lang?: string; by?: string },
        cmd: Command,
      ) => {
        const globals = cmd.parent?.opts() ?? {};
        if (opts.by && opts.by !== 'rarity' && opts.by !== 'tier') {
          throw new UserError(`--by must be rarity|tier (got '${opts.by}')`);
        }
        await runProgress({
          ...(opts.set !== undefined ? { set_id: opts.set } : {}),
          ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
          by: (opts.by as 'rarity' | 'tier' | undefined) ?? 'rarity',
          format: globals.format as string | undefined,
          json: globals.json as boolean | undefined,
          noColor: globals.color === false,
        });
      },
    );
}
