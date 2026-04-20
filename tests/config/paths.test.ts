import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configDir, configFile, dbFile } from '../../src/config/paths.js';

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('configDir()', () => {
  let origPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });
  afterEach(() => {
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
  });

  it('respects POKE_CONFIG_DIR over everything else', () => {
    withEnv({ POKE_CONFIG_DIR: '/custom/path' }, () => {
      expect(configDir()).toBe('/custom/path');
      expect(configFile()).toBe('/custom/path/config.json');
      expect(dbFile()).toBe('/custom/path/collection.db');
    });
  });

  it('uses XDG_CONFIG_HOME on unix when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    withEnv({ POKE_CONFIG_DIR: undefined, XDG_CONFIG_HOME: '/xdg' }, () =>
      expect(configDir()).toBe('/xdg/poke'),
    );
  });

  it('falls back to ~/.config/poke on unix without XDG', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    withEnv({ POKE_CONFIG_DIR: undefined, XDG_CONFIG_HOME: undefined, HOME: '/home/tester' }, () =>
      expect(configDir()).toBe('/home/tester/.config/poke'),
    );
  });

  it('uses APPDATA on windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    withEnv({ POKE_CONFIG_DIR: undefined, APPDATA: 'C:\\Users\\t\\AppData\\Roaming' }, () =>
      expect(configDir()).toBe('C:\\Users\\t\\AppData\\Roaming/poke'),
    );
  });
});
