import pc from 'picocolors';

/**
 * Semantic palette. Every command uses these names (never `pc.green`
 * directly) so the whole CLI can re-skin via this file alone.
 */

export type Colorizer = (s: string) => string;

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
    common: (s) => pc.dim(pc.gray(s)),
    uncommon: pc.green,
    rare: pc.blue,
    ultra: pc.magenta,
    secret: pc.yellow,
    promo: pc.cyan,
    unknown: (s) => pc.dim(s),
  },
  success: pc.green,
  warn: pc.yellow,
  error: pc.red,
  muted: pc.dim,
  money: { up: pc.green, down: pc.red, neutral: id },
  label: pc.bold,
  bold: pc.bold,
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
