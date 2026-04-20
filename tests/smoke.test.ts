import { describe, it, expect } from 'vitest';
import { UserError, NetworkError, ConfigError, exitCodeFor } from '../src/errors.js';

describe('errors', () => {
  it('maps each error class to its documented exit code', () => {
    expect(exitCodeFor(new UserError('x'))).toBe(1);
    expect(exitCodeFor(new NetworkError('x'))).toBe(2);
    expect(exitCodeFor(new ConfigError('x'))).toBe(3);
    expect(exitCodeFor(new Error('x'))).toBe(1);
    expect(exitCodeFor('plain string')).toBe(1);
  });

  it('carries an optional hint', () => {
    const err = new UserError('no such card', { hint: 'try poke search' });
    expect(err.hint).toBe('try poke search');
    expect(err.message).toBe('no such card');
  });
});
