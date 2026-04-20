import { Writable } from 'node:stream';
import { resolveMode, shouldColor, type OutputMode } from './tty.js';
import { createTable } from '../ui/tables.js';
import { paletteFor, type Palette } from '../ui/colors.js';

/**
 * The rendering contract. Every source command hands its stream +
 * TableSpec to `emit()` — commands do not call console.log, do not
 * branch on isatty, and do not know about color. This is the invariant
 * that keeps `--json`, `--format`, and color changes a one-line concern.
 */

export interface TableColumn<T> {
  header: string;
  /** Extract a display string from the record. */
  get: (record: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  /** Optional color transform applied only when color is enabled. */
  color?: (record: T, rendered: string, palette: Palette) => string;
}

export interface TableSpec<T> {
  columns: TableColumn<T>[];
  /** Message when no records are emitted. Default: `"(no results)"`. */
  empty?: string;
}

export interface EmitOptions {
  /** Override mode detection (tests pass this). */
  mode?: OutputMode;
  /** Override the destination stream (tests pass this). */
  out?: NodeJS.WritableStream | Writable;
  /** Override color decision (tests pass this). */
  color?: boolean;
  /** Passed through from the command layer. */
  format?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * Consume `records` once and write them to `out` in the resolved mode.
 *
 * Modes:
 *   - 'ndjson'     : streaming, one JSON line per record.
 *   - 'json-array' : buffered, single `JSON.stringify(array)` line.
 *   - 'table'      : buffered, cli-table3 with ASCII borders.
 */
export async function emit<T>(
  records: AsyncIterable<T> | Iterable<T>,
  spec: TableSpec<T>,
  opts: EmitOptions = {},
): Promise<void> {
  const out = opts.out ?? process.stdout;
  const isTTY = Boolean((out as NodeJS.WriteStream).isTTY ?? process.stdout.isTTY);
  const mode =
    opts.mode ?? resolveMode({ isTTY, format: opts.format, json: opts.json });
  const colorEnabled = opts.color ?? shouldColor({ isTTY, noColor: opts.noColor });
  const palette = paletteFor(colorEnabled);

  if (mode === 'ndjson') {
    for await (const r of records as AsyncIterable<T>) {
      out.write(JSON.stringify(r) + '\n');
    }
    return;
  }

  // Both 'table' and 'json-array' need the full stream.
  const buffered: T[] = [];
  for await (const r of records as AsyncIterable<T>) buffered.push(r);

  if (mode === 'json-array') {
    out.write(JSON.stringify(buffered) + '\n');
    return;
  }

  // mode === 'table'
  if (buffered.length === 0) {
    out.write((spec.empty ?? '(no results)') + '\n');
    return;
  }

  const table = createTable({
    head: spec.columns.map((c) => c.header),
    colAligns: spec.columns.map((c) => c.align ?? 'left'),
  });

  for (const record of buffered) {
    const row = spec.columns.map((col) => {
      const raw = col.get(record);
      const text = raw === null || raw === undefined ? '' : String(raw);
      if (colorEnabled && col.color) return col.color(record, text, palette);
      return text;
    });
    table.push(row);
  }

  out.write(table.toString() + '\n');
}
