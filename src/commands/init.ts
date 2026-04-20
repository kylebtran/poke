import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output, stderr } from 'node:process';
import { readFile, update, maskSecret } from '../config/settings.js';
import { configFile, dbFile } from '../config/paths.js';
import { openDatabase } from '../db/migrate.js';

/**
 * `poke init` — interactive first-run bootstrap.
 *
 * Prompts for Scrydex credentials, writes the config file, and lays the
 * groundwork for DB migration + optional pre-fetch (those are no-ops in
 * phase 1 and enabled in later phases).
 *
 * Designed to be idempotent: re-running shows current values as defaults
 * and lets the user accept them by pressing Enter.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('first-run bootstrap: prompt for API key, team id, write config')
    .action(async () => {
      await runInit();
    });
}

async function runInit(): Promise<void> {
  const current = readFile();
  const rl = readline.createInterface({ input, output });
  try {
    stderr.write(`poke init — config will be written to ${configFile()}\n`);

    const apiKey = await promptSecret(
      rl,
      'Scrydex API key',
      current.api_key ? maskSecret(current.api_key) : undefined,
    );
    const teamId = await promptPlain(
      rl,
      'Scrydex Team ID',
      current.team_id ?? undefined,
    );

    // Only persist keys the user actually supplied. An empty response on
    // a prompt with a default preserves the existing value.
    const patch: Parameters<typeof update>[0] = {};
    if (apiKey !== undefined && apiKey.length > 0) patch.api_key = apiKey;
    if (teamId !== undefined && teamId.length > 0) patch.team_id = teamId;

    update(patch);
    stderr.write('wrote config.\n');

    // Run DB migrations (idempotent). Creating collection.db on first
    // init means subsequent reads never have to check for its existence.
    const db = openDatabase();
    db.close();
    stderr.write(`initialized database at ${dbFile()}\n`);
  } finally {
    rl.close();
  }
}

async function promptPlain(
  rl: readline.Interface,
  label: string,
  existing: string | undefined,
): Promise<string | undefined> {
  const suffix = existing ? ` [${existing}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  if (answer.length === 0) return existing;
  return answer;
}

/**
 * Prompts without echoing the typed characters. Falls back to a plain
 * prompt when stdin is not a TTY (e.g. piped input during tests).
 */
async function promptSecret(
  rl: readline.Interface,
  label: string,
  existingMasked: string | undefined,
): Promise<string | undefined> {
  const suffix = existingMasked ? ` [${existingMasked}]` : '';
  if (!input.isTTY) {
    // Non-interactive: just read a line normally.
    return promptPlain(rl, label, undefined).then((v) =>
      v === undefined && existingMasked ? undefined : v,
    );
  }
  // Temporarily silence the writeable by overriding the internal _writeToOutput.
  const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void };
  const original = rlAny._writeToOutput;
  process.stdout.write(`${label}${suffix}: `);
  rlAny._writeToOutput = (s: string) => {
    // Let the prompt pass through once when the library echoes \n.
    if (s === '\n' || s === '\r\n') process.stdout.write(s);
  };
  try {
    const answer = (await rl.question('')).trim();
    return answer.length === 0 ? undefined : answer;
  } finally {
    rlAny._writeToOutput = original;
  }
}
