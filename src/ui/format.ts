/**
 * Tiny formatting helpers. Kept side-effect free so snapshots stay stable.
 */

export function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return '$' + amount.toFixed(2);
}

export function formatPercent(num: number, denom: number): string {
  if (denom <= 0) return '0%';
  const pct = Math.round((num / denom) * 100);
  return `${pct}%`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // ISO date only — readable, 10 chars.
  return d.toISOString().slice(0, 10);
}

/**
 * Single-line progress bar à la spec §9.
 *   progressBar(42, 98, 12) -> "████████░░░░"
 */
export function progressBar(num: number, denom: number, width = 12): string {
  if (width <= 0) return '';
  const pct = denom <= 0 ? 0 : Math.min(1, Math.max(0, num / denom));
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}
