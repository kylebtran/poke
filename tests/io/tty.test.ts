import { describe, it, expect, afterEach } from 'vitest';
import { resolveMode, shouldColor } from '../../src/io/tty.js';

describe('resolveMode()', () => {
  it('json flag wins', () => {
    expect(resolveMode({ isTTY: true, json: true })).toBe('json-array');
    expect(resolveMode({ isTTY: false, json: true })).toBe('json-array');
  });
  it('format=table forces table', () => {
    expect(resolveMode({ isTTY: false, format: 'table' })).toBe('table');
  });
  it('format=ndjson forces ndjson', () => {
    expect(resolveMode({ isTTY: true, format: 'ndjson' })).toBe('ndjson');
  });
  it('tty → table, pipe → ndjson by default', () => {
    expect(resolveMode({ isTTY: true })).toBe('table');
    expect(resolveMode({ isTTY: false })).toBe('ndjson');
  });
});

describe('shouldColor()', () => {
  const orig: Record<string, string | undefined> = {};
  const keys = ['NO_COLOR', 'FORCE_COLOR'];

  function setEnv(env: Record<string, string | undefined>): void {
    for (const k of keys) orig[k] = process.env[k];
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  afterEach(() => {
    for (const k of keys) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  });

  it('disables with --no-color', () => {
    setEnv({});
    expect(shouldColor({ isTTY: true, noColor: true })).toBe(false);
  });
  it('disables with NO_COLOR env', () => {
    setEnv({ NO_COLOR: '1' });
    expect(shouldColor({ isTTY: true })).toBe(false);
  });
  it('enables with FORCE_COLOR even off-TTY', () => {
    setEnv({ FORCE_COLOR: '1' });
    expect(shouldColor({ isTTY: false })).toBe(true);
  });
  it('off on non-TTY by default', () => {
    setEnv({});
    expect(shouldColor({ isTTY: false })).toBe(false);
  });
});
