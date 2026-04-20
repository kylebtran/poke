/**
 * Tiny handwritten CSV (RFC 4180-ish). Sufficient for the
 * import/export schema documented in spec §8.
 */

/** Parse CSV text into rows of strings. Handles quoted cells and embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Treat \r\n as a single row terminator.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Trim trailing empty rows.
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  return rows;
}

/** Serialize `rows` to CSV. Quotes any cell containing `,`, `"`, or newline. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\n') + '\n';
}

function escapeCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}
