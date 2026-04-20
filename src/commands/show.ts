import { Command } from 'commander';
import { Writable } from 'node:stream';
import { requireAuth } from '../config/settings.js';
import { ScrydexClient } from '../scrydex/client.js';
import { getCardById } from '../scrydex/cards.js';
import { fromScrydex } from '../domain/card.js';
import { UserError } from '../errors.js';

export interface ShowOptions {
  lang?: string;
  /** Injected for tests. Falls back to a real client built from settings. */
  client?: ScrydexClient;
  /** Injected for tests. Defaults to `process.stdout`. */
  out?: NodeJS.WritableStream | Writable;
}

/**
 * `poke show <card-id>` — single card, full detail.
 *
 * Phase 2: hits Scrydex directly (no cache), writes a JSON record.
 * Phase 3 makes this read-through against the SQLite cache.
 * Phase 4 migrates output through the shared `emit` contract.
 */
export async function runShow(cardId: string, opts: ShowOptions = {}): Promise<void> {
  if (!cardId || cardId.length === 0) {
    throw new UserError('card id required');
  }
  const client = opts.client ?? new ScrydexClient(requireAuth());
  const card = await getCardById(client, cardId, opts.lang ? { lang: opts.lang } : {});
  const record = fromScrydex(card);
  const out = opts.out ?? process.stdout;
  out.write(JSON.stringify(record) + '\n');
}

export function registerShowCommand(program: Command): void {
  program
    .command('show <card-id>')
    .description('show full detail for one card by id')
    .option('--lang <code>', 'language scope (en|ja)')
    .action(async (cardId: string, opts: { lang?: string }) => {
      await runShow(cardId, { lang: opts.lang });
    });
}
