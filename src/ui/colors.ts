import pcModule from 'picocolors';

/**
 * Semantic palette. Every command uses these names (never `pc.green`
 * directly) so the whole CLI can re-skin via this file alone.
 *
 * We construct an explicitly-enabled picocolors instance rather than
 * using the module default. The default evaluates `isColorSupported` at
 * import time against the current TTY/env; in tests (and piped CLI use)
 * that's false and every color function becomes `String`. Our `emit()`
 * layer already decides when color is allowed; once that decision is
 * made, we want the formatter to actually emit ANSI unconditionally.
 */

export type Colorizer = (s: string) => string;

// picocolors ships a `createColors(enabled)` factory; node ESM interop
// surfaces it on the default export.
const createColors = pcModule.createColors as (enabled?: boolean) => typeof pcModule;
const ON = createColors(true);

function id(s: string): string {
  return s;
}

export interface Palette {
  rarity: {
    common: Colorizer;
    uncommon: Colorizer;
    rare: Colorizer;
    ultra: Colorizer;
    secret: Colorizer;
    promo: Colorizer;
    unknown: Colorizer;
  };
  success: Colorizer;
  warn: Colorizer;
  error: Colorizer;
  muted: Colorizer;
  money: { up: Colorizer; down: Colorizer; neutral: Colorizer };
  /** Generic accents used for headers, labels, etc. */
  label: Colorizer;
  bold: Colorizer;
}

export const PALETTE_COLOR: Palette = {
  rarity: {
    common: (s) => ON.dim(ON.gray(s)),
    uncommon: ON.green,
    rare: ON.blue,
    ultra: ON.magenta,
    secret: ON.yellow,
    promo: ON.cyan,
    unknown: (s) => ON.dim(s),
  },
  success: ON.green,
  warn: ON.yellow,
  error: ON.red,
  muted: ON.dim,
  money: { up: ON.green, down: ON.red, neutral: id },
  label: ON.bold,
  bold: ON.bold,
};

export const PALETTE_PLAIN: Palette = {
  rarity: {
    common: id,
    uncommon: id,
    rare: id,
    ultra: id,
    secret: id,
    promo: id,
    unknown: id,
  },
  success: id,
  warn: id,
  error: id,
  muted: id,
  money: { up: id, down: id, neutral: id },
  label: id,
  bold: id,
};

export function paletteFor(colorEnabled: boolean): Palette {
  return colorEnabled ? PALETTE_COLOR : PALETTE_PLAIN;
}
