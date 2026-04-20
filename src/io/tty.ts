/**
 * Output-mode resolution, centralized. Every command routes through
 * `resolveMode` so `--format` / `--json` / `isatty` live in ONE place.
 * See spec §2 and plan phase 4.
 */

export type OutputMode = 'table' | 'ndjson' | 'json-array';

export interface ModeInputs {
  /** Whether stdout is a TTY (typically `process.stdout.isTTY === true`). */
  isTTY: boolean;
  /** `--format` CLI flag. */
  format?: string;
  /** `--json` CLI flag. */
  json?: boolean;
}

export function resolveMode(inputs: ModeInputs): OutputMode {
  if (inputs.json) return 'json-array';
  const fmt = inputs.format;
  if (fmt === 'table') return 'table';
  if (fmt === 'ndjson') return 'ndjson';
  if (fmt && fmt.length > 0) {
    // Anything else is caller error; leave the validation to the UserError
    // thrown by the command layer. Default conservatively to ndjson.
    return 'ndjson';
  }
  return inputs.isTTY ? 'table' : 'ndjson';
}

export interface ColorInputs {
  isTTY: boolean;
  /** CLI `--no-color` flag (true disables). */
  noColor?: boolean;
}

export function shouldColor(inputs: ColorInputs): boolean {
  if (inputs.noColor) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return inputs.isTTY;
}
