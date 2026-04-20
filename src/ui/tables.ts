import CliTable3 from 'cli-table3';

/**
 * Thin wrapper around cli-table3 that enforces ASCII borders (spec §9)
 * and left-aligned headers by default.
 */

const ASCII_BORDERS = {
  top: '-',
  'top-mid': '+',
  'top-left': '+',
  'top-right': '+',
  bottom: '-',
  'bottom-mid': '+',
  'bottom-left': '+',
  'bottom-right': '+',
  left: '|',
  'left-mid': '+',
  mid: '-',
  'mid-mid': '+',
  right: '|',
  'right-mid': '+',
  middle: '|',
} as const;

export function createTable(options: {
  head: string[];
  colAligns?: ('left' | 'right' | 'center')[];
}) {
  return new CliTable3({
    head: options.head,
    chars: ASCII_BORDERS,
    style: { head: [], border: [], compact: true },
    colAligns: options.colAligns,
  });
}
