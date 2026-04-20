import { UserError } from '../errors.js';
import type { CardRecord } from '../domain/card.js';

/**
 * Minimal predicate parser for `poke filter`. Spec §8:
 *
 *   <field> <op> <value>
 *   op ∈ { = != > >= < <= ~ }
 *
 *   value>50
 *   tier=secret
 *   name~charizard
 *   tag=psa10
 *
 * The aliases:
 *   - `value`  → price.market * (owned.quantity ?? 1)
 *   - `tag`    → membership on owned.tags
 */

export type Op = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~';

const OP_ORDER = ['!=', '>=', '<=', '=', '>', '<', '~'] as const;

export interface Predicate {
  field: string;
  op: Op;
  value: string;
  test: (record: CardRecord) => boolean;
}

export function parsePredicate(input: string): Predicate {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new UserError('empty predicate');
  }
  const match = matchPredicate(trimmed);
  if (!match) {
    throw new UserError(`invalid predicate '${input}'`, {
      hint: 'form: <field> <op> <value>, op in = != > >= < <= ~',
    });
  }
  const { field, op, value } = match;
  return {
    field,
    op,
    value,
    test: compile(field, op, value),
  };
}

function matchPredicate(input: string): { field: string; op: Op; value: string } | undefined {
  // Fields are dotted identifiers, e.g. `price.market` or `owned.quantity`.
  const fieldRe = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*/;
  const fm = input.match(fieldRe);
  if (!fm) return undefined;
  const field = fm[1]!;
  const rest = input.slice(fm[0].length);
  for (const op of OP_ORDER) {
    if (rest.startsWith(op)) {
      const value = rest.slice(op.length).trim();
      if (value.length === 0) return undefined;
      return { field, op, value: unquote(value) };
    }
  }
  return undefined;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function compile(field: string, op: Op, value: string): (r: CardRecord) => boolean {
  return (record) => {
    const actual = resolveField(record, field);
    return compare(actual, op, value);
  };
}

/**
 * Resolve a dotted path on the record, with two aliases:
 *   - `value` → record.price?.market * (record.owned?.quantity ?? 1)
 *   - `tag`   → record.owned?.tags
 *
 * Returns `undefined` when any segment is missing. `null` is returned as
 * itself so consumers can distinguish "not present" from "explicitly null".
 */
export function resolveField(record: CardRecord, field: string): unknown {
  if (field === 'value') {
    const market = record.price?.market;
    if (market === null || market === undefined) return undefined;
    const qty = record.owned?.quantity ?? 1;
    return market * qty;
  }
  if (field === 'tag') {
    return record.owned?.tags ?? [];
  }
  const parts = field.split('.');
  let cur: unknown = record as unknown;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compare(actual: unknown, op: Op, value: string): boolean {
  // Array membership: only when the field resolved to an array.
  if (Array.isArray(actual)) {
    const has = actual.map((v) => String(v)).includes(value);
    if (op === '=') return has;
    if (op === '!=') return !has;
    if (op === '~')
      return actual.some((v) => String(v).toLowerCase().includes(value.toLowerCase()));
    return false;
  }

  if (op === '~') {
    if (actual === undefined || actual === null) return false;
    return String(actual).toLowerCase().includes(value.toLowerCase());
  }

  const numericActual = coerceNumber(actual);
  const numericValue = coerceNumber(value);

  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    if (numericActual === undefined || numericValue === undefined) return false;
    switch (op) {
      case '>':
        return numericActual > numericValue;
      case '>=':
        return numericActual >= numericValue;
      case '<':
        return numericActual < numericValue;
      case '<=':
        return numericActual <= numericValue;
    }
  }

  // = / != : numeric when both sides are numeric, else string.
  if (numericActual !== undefined && numericValue !== undefined) {
    const eq = numericActual === numericValue;
    return op === '=' ? eq : !eq;
  }
  if (actual === undefined || actual === null) {
    // undefined/null equal an empty-ish string only when explicitly asked.
    const eq = value === '' || value === 'null';
    return op === '=' ? eq : !eq;
  }
  const eq = String(actual) === value;
  return op === '=' ? eq : !eq;
}

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
