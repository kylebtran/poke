import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Unix pipe contract: when a downstream consumer closes its stdin, our
 * next write hits EPIPE. A well-behaved Unix source treats that as "stop
 * quietly, exit 0," exactly the way `sort`, `find`, `cat` do.
 *
 * We verify this by:
 *   1. Seeding a collection large enough to exceed stdout's buffer.
 *   2. Piping `poke list` into `head -n 1` and waiting for both to exit.
 *   3. Asserting the `poke` process exited 0 with no 'error:' output on
 *      its stderr.
 */

const BIN = join(process.cwd(), 'dist', 'bin', 'poke.js');

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'poke-epipe-'));
  for (const k of ['POKE_CONFIG_DIR', 'SCRYDEX_API_KEY', 'SCRYDEX_TEAM_ID']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function seedLargeCollection(n: number): void {
  // Run a tiny seed script through node to populate the DB via the
  // same code path the CLI uses.
  const script = `
    import { openDatabase } from '${join(process.cwd(), 'dist', 'db', 'migrate.js')}';
    import { putCachedCard } from '${join(process.cwd(), 'dist', 'db', 'cache.js')}';
    import { addOwned } from '${join(process.cwd(), 'dist', 'db', 'collection.js')}';
    const db = openDatabase();
    for (let i = 1; i <= ${n}; i++) {
      putCachedCard(db, {
        id: 'sv4-' + i,
        name: 'card-' + i,
        number: String(i),
        rarity: 'Rare',
        language_code: 'en',
        set: { id: 'sv4', language_code: 'en' }
      });
      addOwned(db, { card_id: 'sv4-' + i });
    }
    db.close();
  `;
  const res = spawnSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, POKE_CONFIG_DIR: tmp },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`seed failed: ${res.stderr}`);
  }
}

describe('EPIPE handling', () => {
  it('poke list | head -n 1 exits 0 with no error output', () => {
    seedLargeCollection(1000);

    // Run through an actual shell so `|` behaves exactly as it does for
    // users. ${PIPESTATUS[0]} (bash) gives the source-side exit code;
    // we capture it and both stderr streams separately.
    const stderrPath = join(tmp, 'poke-stderr.log');
    const statusPath = join(tmp, 'poke-status.log');
    const script = `set +e; node "${BIN}" list 2>"${stderrPath}" | head -n 1 >/dev/null; echo "\${PIPESTATUS[0]}" >"${statusPath}"`;
    // Write to a file to avoid shell-quoting landmines.
    const scriptPath = join(tmp, 'run.sh');
    writeFileSync(scriptPath, script, { mode: 0o700 });

    const res = spawnSync('bash', [scriptPath], {
      env: { ...process.env, POKE_CONFIG_DIR: tmp },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(res.status).toBe(0);

    const pokeExit = readFileSync(statusPath, 'utf8').trim();
    const pokeStderr = readFileSync(stderrPath, 'utf8');

    expect(pokeExit).toBe('0');
    expect(pokeStderr).not.toMatch(/error:/);
    expect(pokeStderr).not.toMatch(/EPIPE/);
  }, 20_000);
});
