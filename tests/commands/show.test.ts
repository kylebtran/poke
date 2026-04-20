import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { runShow } from '../../src/commands/show.js';
import { ScrydexClient } from '../../src/scrydex/client.js';
import { mockFetch } from '../helpers/mockFetch.js';
import { openTestDb } from '../helpers/db.js';
import { getCachedCard } from '../../src/db/cache.js';

const BIN = join(process.cwd(), 'dist', 'bin', 'poke.js');

class BufferWritable extends Writable {
  chunks: Buffer[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'poke-show-'));
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

describe('poke show — CLI surface', () => {
  it('exits with code 3 and hint when API key missing', () => {
    const res = spawnSync('node', [BIN, 'show', 'sv10_ja-1'], {
      env: { ...process.env, POKE_CONFIG_DIR: tmp },
      encoding: 'utf8',
    });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain('missing SCRYDEX_API_KEY');
    expect(res.stderr).toContain("run 'poke init'");
  });
});

describe('runShow — programmatic', () => {
  it('writes an NDJSON record for a JA card', async () => {
    const { fetch } = mockFetch([{ match: '/cards/sv10_ja-1', fixture: 'card-sv10_ja-1.json' }]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const db = openTestDb();
    const out = new BufferWritable();
    await runShow('sv10_ja-1', { lang: 'ja', client, db, out });
    const line = out.text().trim();
    expect(line.endsWith('}')).toBe(true);
    const record = JSON.parse(line);
    expect(record._schema).toBe('poke.card/v1');
    expect(record.id).toBe('sv10_ja-1');
    expect(record.name).toBe('クヌギダマ');
    expect(record.name_en).toBe('Pineco');
    expect(record.lang).toBe('ja');
    expect(record.set_id).toBe('sv10_ja');
    expect(record.set_name).toBe('Mega Brave');
    expect(record.rarity).toBe('通常');
    // Cache populated.
    expect(getCachedCard(db, 'sv10_ja-1')).toBeDefined();
  });

  it('cache hit avoids a second network call', async () => {
    const { fetch, calls } = mockFetch([
      { match: '/cards/sv10_ja-1', fixture: 'card-sv10_ja-1.json' },
    ]);
    const client = new ScrydexClient({
      api_key: 'k',
      team_id: 't',
      fetch,
      baseUrl: 'https://api.example.test/pokemon/v1/',
    });
    const db = openTestDb();
    await runShow('sv10_ja-1', { lang: 'ja', client, db, out: new BufferWritable() });
    await runShow('sv10_ja-1', { lang: 'ja', client, db, out: new BufferWritable() });
    expect(calls).toHaveLength(1);
  });
});
