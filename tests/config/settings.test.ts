import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readFile,
  writeFileSettings,
  update,
  load,
  requireAuth,
  maskSecret,
  coerceValue,
  fieldForKey,
} from '../../src/config/settings.js';
import { configFile } from '../../src/config/paths.js';
import { ConfigError } from '../../src/errors.js';

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'poke-settings-'));
  for (const k of [
    'POKE_CONFIG_DIR',
    'SCRYDEX_API_KEY',
    'SCRYDEX_TEAM_ID',
    'POKE_PRICE_TTL',
  ]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.POKE_CONFIG_DIR = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('settings file round-trip', () => {
  it('reads empty object when file is missing', () => {
    expect(readFile()).toEqual({});
  });

  it('writes atomically and reads back', () => {
    writeFileSettings({ api_key: 'abc', team_id: 't1' });
    const path = configFile();
    expect(path.startsWith(tmp)).toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({ api_key: 'abc', team_id: 't1' });
    expect(readFile()).toEqual({ api_key: 'abc', team_id: 't1' });
  });

  it('update() merges partials', () => {
    writeFileSettings({ api_key: 'abc' });
    update({ team_id: 't1' });
    expect(readFile()).toEqual({ api_key: 'abc', team_id: 't1' });
  });

  it('rejects malformed JSON', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(configFile(), 'not-json');
    expect(() => readFile()).toThrow(ConfigError);
  });

  it('rejects schema violations (bad TTL)', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(configFile(), JSON.stringify({ price_ttl_hours: -1 }));
    expect(() => readFile()).toThrow(ConfigError);
  });
});

describe('load() — env + defaults', () => {
  it('applies defaults when file is empty', () => {
    const s = load();
    expect(s.price_ttl_hours).toBe(24);
    expect(s.default_price_field).toBe('market');
    expect(s.api_key).toBeUndefined();
  });

  it('env SCRYDEX_API_KEY wins over file', () => {
    writeFileSettings({ api_key: 'file-key', team_id: 'file-team' });
    process.env.SCRYDEX_API_KEY = 'env-key';
    const s = load();
    expect(s.api_key).toBe('env-key');
    expect(s.team_id).toBe('file-team');
  });

  it('POKE_PRICE_TTL overrides file when valid', () => {
    writeFileSettings({ price_ttl_hours: 12 });
    process.env.POKE_PRICE_TTL = '6';
    expect(load().price_ttl_hours).toBe(6);
  });

  it('invalid POKE_PRICE_TTL is ignored', () => {
    writeFileSettings({ price_ttl_hours: 12 });
    process.env.POKE_PRICE_TTL = 'abc';
    expect(load().price_ttl_hours).toBe(12);
  });
});

describe('requireAuth()', () => {
  it('throws ConfigError(3) when api_key is missing', () => {
    let caught: unknown;
    try {
      requireAuth();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).code).toBe(3);
  });

  it('returns auth when both are set', () => {
    writeFileSettings({ api_key: 'k', team_id: 't' });
    expect(requireAuth()).toEqual({ api_key: 'k', team_id: 't' });
  });
});

describe('maskSecret()', () => {
  it('masks long strings preserving prefix', () => {
    expect(maskSecret('abcdef12345')).toBe('ab****');
  });
  it('masks short strings fully', () => {
    expect(maskSecret('abc')).toBe('****');
  });
});

describe('coerceValue() + fieldForKey()', () => {
  it('maps cli key to field', () => {
    expect(fieldForKey('api-key')).toBe('api_key');
    expect(fieldForKey('price-ttl-hours')).toBe('price_ttl_hours');
  });

  it('unknown key throws', () => {
    expect(() => fieldForKey('foo')).toThrow(ConfigError);
  });

  it('coerces ttl to positive int', () => {
    expect(coerceValue('price_ttl_hours', '48')).toBe(48);
    expect(() => coerceValue('price_ttl_hours', '0')).toThrow(ConfigError);
    expect(() => coerceValue('price_ttl_hours', 'x')).toThrow(ConfigError);
  });

  it('validates default-price-field enum', () => {
    expect(coerceValue('default_price_field', 'market')).toBe('market');
    expect(() => coerceValue('default_price_field', 'bogus')).toThrow(ConfigError);
  });

  it('rejects empty api key', () => {
    expect(() => coerceValue('api_key', '')).toThrow(ConfigError);
  });
});
