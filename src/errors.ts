/**
 * Typed error classes mapped to stable exit codes (spec §8 "Global flags").
 * Every command layer should throw one of these instead of `new Error(...)`
 * so the top-level handler in `bin/poke.ts` can produce a clean one-line
 * message + optional hint without a stack trace (unless --debug).
 */

export abstract class PokeError extends Error {
  /** Suggested next step shown to the user after the error line. */
  readonly hint?: string;
  /** Exit code for this class; overridden by subclasses. */
  abstract readonly code: number;

  constructor(message: string, opts?: { hint?: string; cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.hint = opts?.hint;
    if (opts?.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** User input was invalid (bad flag, missing arg, unknown card id, etc.). */
export class UserError extends PokeError {
  readonly code = 1;
}

/** Network or upstream API failure (Scrydex returned 5xx, offline, etc.). */
export class NetworkError extends PokeError {
  readonly code = 2;
}

/** Local config or environment is not usable (missing API key, bad TTL). */
export class ConfigError extends PokeError {
  readonly code = 3;
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof PokeError) return err.code;
  return 1;
}
