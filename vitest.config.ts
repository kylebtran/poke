import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    // Individual projects (default + live) are wired via CLI flags in
    // package.json scripts. The `live` suite hits real Scrydex and is
    // opt-in via `npm run test:live` — we include it from a separate
    // config in phase 12.
  },
});
