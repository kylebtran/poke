import { Command } from 'commander';
import { openDatabase, type DB } from '../db/migrate.js';
import { removeOwned, totalQuantityFor } from '../db/collection.js';
import { UserError } from '../errors.js';

export interface RemoveOptions {
  qty?: number;
  all?: boolean;
  db?: DB;
}

/**
 * `poke remove <card-id> [--qty N] [--all]`.
 *
 * Refuses to remove more than owned unless `--all`. Output goes to stderr
 * (a one-line confirmation); stdout stays silent so `poke remove` can
 * chain with other stream commands without corrupting the stream.
 */
export async function runRemove(cardRef: string, opts: RemoveOptions = {}): Promise<void> {
  if (!cardRef) throw new UserError('card id required');
  const db = opts.db ?? openDatabase();
  try {
    const qty = opts.qty ?? 1;
    if (!opts.all && qty <= 0) {
      throw new UserError('quantity must be > 0');
    }
    if (!opts.all) {
      const total = totalQuantityFor(db, cardRef);
      if (total === 0) {
        throw new UserError(`no owned copies of '${cardRef}'`, {
          hint: "try 'poke list' to see what you own",
        });
      }
      if (qty > total) {
        throw new UserError(`only ${total} copies of '${cardRef}' — pass --all to remove them`);
      }
    }
    const result = removeOwned(db, {
      card_id: cardRef,
      ...(opts.qty !== undefined ? { quantity: opts.qty } : {}),
      ...(opts.all ? { all: true } : {}),
    });
    const msg = opts.all
      ? `removed all owned copies of ${cardRef} (${result.rowsDeleted} rows)`
      : `removed ${qty} of ${cardRef}`;
    process.stderr.write(msg + '\n');
  } finally {
    if (!opts.db) db.close();
  }
}

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <card-id>')
    .description('remove a card (or all copies with --all)')
    .option('--qty <n>', 'quantity to remove', (v) => parseInt(v, 10), 1)
    .option('--all', 'remove every owned row for this card', false)
    .action(async (cardRef: string, opts: { qty?: number; all?: boolean }) => {
      await runRemove(cardRef, {
        ...(opts.qty !== undefined ? { qty: opts.qty } : {}),
        ...(opts.all !== undefined ? { all: opts.all } : {}),
      });
    });
}
