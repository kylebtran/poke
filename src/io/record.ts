/**
 * Re-exports the CardRecord shape defined in `domain/card.ts`. This file
 * exists because the spec's §4 layout puts the versioned record schema
 * under `src/io/record.ts`, and keeping it a thin re-export lets the
 * domain layer own the mapper without forcing importers to cross layers.
 */
export {
  CardRecordSchema,
  CardRecordOwnedSchema,
  CardRecordPriceSchema,
  SCHEMA_ID,
  type CardRecord,
} from '../domain/card.js';

import { CardRecordSchema, type CardRecord } from '../domain/card.js';

/**
 * Parses one line of NDJSON into a CardRecord. Returns `null` on either a
 * JSON parse failure or a schema violation. Callers tally these as
 * "malformed" and emit a single stderr warning per stream (spec §6).
 */
export function parseLine(line: string): CardRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = CardRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
