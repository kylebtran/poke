import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { configDir, configFile } from './paths.js';
import { ConfigError } from '../errors.js';

/**
 * On-disk settings schema. Every field optional at the file level so partial
 * writes through `poke config set` are valid; defaults are applied at read.
 */
export const SettingsSchema = z.object({
  api_key: z.string().min(1).optional(),
  team_id: z.string().min(1).optional(),
  price_ttl_hours: z.number().int().positive().optional(),
  default_price_field: z.enum(['low', 'mid', 'high', 'market']).optional(),
  rarity_tier_overrides: z.record(z.string(), z.string()).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** Fully-resolved settings (defaults applied, env merged in). */
export interface ResolvedSettings {
  api_key: string | undefined;
  team_id: string | undefined;
  price_ttl_hours: number;
  default_price_field: 'low' | 'mid' | 'high' | 'market';
  rarity_tier_overrides: Record<string, string>;
}

const DEFAULTS: ResolvedSettings = {
  api_key: undefined,
  team_id: undefined,
  price_ttl_hours: 24,
  default_price_field: 'market',
  rarity_tier_overrides: {},
};

/** Subset of keys the user may set via `poke config set <key> <value>`. */
export const WRITABLE_KEYS = new Set<string>([
  'api-key',
  'team-id',
  'price-ttl-hours',
  'default-price-field',
]);

/**
 * Read the settings file from disk. Missing file → empty settings (not an
 * error; first-run is legal). Malformed JSON or a zod violation is a
 * `ConfigError` with a hint pointing to `poke init`.
 */
export function readFile(): Settings {
  const path = configFile();
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`could not read ${path}`, {
      hint: "check file permissions, or delete it and re-run 'poke init'",
      cause: err,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`config file ${path} is not valid JSON`, {
      hint: "delete it and re-run 'poke init'",
      cause: err,
    });
  }
  const result = SettingsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`config file ${path} failed validation: ${result.error.message}`, {
      hint: "edit the file or re-run 'poke init'",
    });
  }
  return result.data;
}

/**
 * Atomically write settings to disk. Creates the config dir if needed.
 * Writes to `<file>.tmp` then renames so readers never see a partial file.
 */
export function writeFileSettings(settings: Settings): void {
  const dir = configDir();
  const path = configFile();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path + '.tmp';
  const json = JSON.stringify(settings, null, 2) + '\n';
  writeFileSync(tmp, json, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Merge a partial update into the file. Undefined values in `patch` delete
 * the key (used by `poke config set` when the user wants to unset).
 */
export function update(patch: Settings): Settings {
  const current = readFile();
  const merged: Settings = { ...current, ...patch };
  // Scrub undefined so JSON.stringify doesn't serialize them.
  for (const key of Object.keys(merged) as (keyof Settings)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  writeFileSettings(merged);
  return merged;
}

/**
 * Fully-resolved settings: file + env + defaults. Env vars win over file
 * values for auth (so `SCRYDEX_API_KEY` in a shell always wins), matching
 * the spec's "Reads … env, then config file" ordering in §7.
 */
export function load(): ResolvedSettings {
  const file = readFile();
  const envPriceTtl = parseIntOrUndefined(process.env.POKE_PRICE_TTL);
  return {
    api_key: process.env.SCRYDEX_API_KEY ?? file.api_key ?? DEFAULTS.api_key,
    team_id: process.env.SCRYDEX_TEAM_ID ?? file.team_id ?? DEFAULTS.team_id,
    price_ttl_hours: envPriceTtl ?? file.price_ttl_hours ?? DEFAULTS.price_ttl_hours,
    default_price_field: file.default_price_field ?? DEFAULTS.default_price_field,
    rarity_tier_overrides: file.rarity_tier_overrides ?? DEFAULTS.rarity_tier_overrides,
  };
}

/**
 * Returns `{api_key, team_id}` or throws `ConfigError`. Used by any command
 * that actually talks to Scrydex. Gives a friendly hint pointing at
 * `poke init`.
 */
export function requireAuth(): { api_key: string; team_id: string } {
  const settings = load();
  if (!settings.api_key) {
    throw new ConfigError('missing SCRYDEX_API_KEY', {
      hint: "run 'poke init' or 'poke config set api-key <key>'",
    });
  }
  if (!settings.team_id) {
    throw new ConfigError('missing SCRYDEX_TEAM_ID', {
      hint: "run 'poke init' or 'poke config set team-id <id>'",
    });
  }
  return { api_key: settings.api_key, team_id: settings.team_id };
}

/**
 * Masks a secret for display. `abcdef` → `ab****`. Short strings become
 * `****` to avoid leaking length.
 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '****';
}

function parseIntOrUndefined(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Map CLI key (kebab-case) to settings field (snake_case).
const KEY_MAP: Record<string, keyof Settings> = {
  'api-key': 'api_key',
  'team-id': 'team_id',
  'price-ttl-hours': 'price_ttl_hours',
  'default-price-field': 'default_price_field',
};

export function fieldForKey(cliKey: string): keyof Settings {
  const field = KEY_MAP[cliKey];
  if (!field) {
    throw new ConfigError(`unknown config key '${cliKey}'`, {
      hint: `valid keys: ${Array.from(WRITABLE_KEYS).join(', ')}`,
    });
  }
  return field;
}

/** Coerce a CLI-typed string into the appropriate field type, validating. */
export function coerceValue(field: keyof Settings, raw: string): Settings[keyof Settings] {
  switch (field) {
    case 'price_ttl_hours': {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ConfigError(`price-ttl-hours must be a positive integer, got '${raw}'`);
      }
      return n as Settings[keyof Settings];
    }
    case 'default_price_field': {
      if (!['low', 'mid', 'high', 'market'].includes(raw)) {
        throw new ConfigError(`default-price-field must be one of low|mid|high|market`);
      }
      return raw as Settings[keyof Settings];
    }
    case 'api_key':
    case 'team_id':
      if (raw.length === 0) throw new ConfigError(`${field} cannot be empty`);
      return raw as Settings[keyof Settings];
    default:
      throw new ConfigError(`key '${field}' is not writable via config set`);
  }
}

/** Pretty-print value for `config list` / `config get`, masking secrets. */
export function displayValue(field: keyof Settings, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (field === 'api_key' && typeof value === 'string') return maskSecret(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
