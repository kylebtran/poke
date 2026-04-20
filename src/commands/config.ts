import { Command } from 'commander';
import {
  readFile,
  update,
  fieldForKey,
  coerceValue,
  displayValue,
  WRITABLE_KEYS,
  type Settings,
} from '../config/settings.js';
import { configFile } from '../config/paths.js';
import { openDatabase } from '../db/migrate.js';
import { setUserTier, isTier } from '../domain/rarity.js';
import { UserError } from '../errors.js';

/**
 * `poke config` — read/write the on-disk settings file.
 *
 *   poke config list
 *   poke config get <key>
 *   poke config set <key> <value>
 *
 * Keys are kebab-case at the CLI boundary and snake_case on disk.
 * See `src/config/settings.ts` for the mapping.
 */
export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('read/write poke settings');

  cmd
    .command('list')
    .description('print all settings (api key masked)')
    .action(() => {
      const settings = readFile();
      if (Object.keys(settings).length === 0) {
        process.stdout.write('(none)\n');
        process.stdout.write(`# file: ${configFile()}\n`);
        return;
      }
      // Stable output: sort keys, print one per line.
      for (const k of Object.keys(settings).sort() as (keyof Settings)[]) {
        const cliKey = toCliKey(k);
        process.stdout.write(`${cliKey}=${displayValue(k, settings[k])}\n`);
      }
    });

  cmd
    .command('get <key>')
    .description('print a single setting value')
    .action((key: string) => {
      const field = fieldForKey(key);
      const settings = readFile();
      const value = settings[field];
      if (value === undefined) return;
      process.stdout.write(displayValue(field, value) + '\n');
    });

  cmd
    .command('set <key> <value> [extra]')
    .description(
      `write a setting (keys: ${Array.from(WRITABLE_KEYS).join(', ')}, rarity-tier)`,
    )
    .option('--lang <code>', 'language for rarity-tier entries', 'en')
    .action(
      (
        key: string,
        value: string,
        extra: string | undefined,
        opts: { lang?: string },
      ) => {
        if (key === 'rarity-tier') {
          // Form: poke config set rarity-tier "<rarity>" <tier> [--lang en|ja]
          if (!extra) {
            throw new UserError(`usage: poke config set rarity-tier <rarity> <tier>`);
          }
          if (!isTier(extra)) {
            throw new UserError(`invalid tier '${extra}'`, {
              hint: 'tiers: common|uncommon|rare|ultra|secret|promo|unknown',
            });
          }
          const db = openDatabase();
          try {
            setUserTier(db, opts.lang ?? 'en', value, extra);
            process.stderr.write(`rarity-tier[${opts.lang ?? 'en'}/${value}] = ${extra}\n`);
          } finally {
            db.close();
          }
          return;
        }
        if (!WRITABLE_KEYS.has(key)) {
          throw new UserError(`unknown config key '${key}'`, {
            hint: `valid keys: ${Array.from(WRITABLE_KEYS).join(', ')}, rarity-tier`,
          });
        }
        const field = fieldForKey(key);
        const coerced = coerceValue(field, value);
        const patch = { [field]: coerced } as Settings;
        update(patch);
        process.stderr.write(`${key} set\n`);
      },
    );
}

function toCliKey(field: keyof Settings): string {
  return String(field).replace(/_/g, '-');
}
