import { defineConfig } from 'vitest/config';

/**
 * Opt-in live contract tests. Hit real Scrydex to detect schema drift.
 *
 * Usage: `SCRYDEX_API_KEY=... SCRYDEX_TEAM_ID=... npm run test:live`
 *
 * Not wired into default CI (no secrets available).
 */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
