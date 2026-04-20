import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves the directory in which `poke` stores its config file and
 * SQLite database. Precedence:
 *
 *   1. `POKE_CONFIG_DIR` (test/ops override — absolute path).
 *   2. Windows: `%APPDATA%/poke`.
 *   3. Unix:    `$XDG_CONFIG_HOME/poke` else `~/.config/poke`.
 *
 * Kept deliberately tiny (no `env-paths` dep) per spec §3.
 */
export function configDir(): string {
  const override = process.env.POKE_CONFIG_DIR;
  if (override && override.length > 0) return override;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData && appData.length > 0) return join(appData, 'poke');
    // Fallback when APPDATA is somehow unset on Windows.
    return join(homedir(), 'AppData', 'Roaming', 'poke');
  }

  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'poke');
}

export function configFile(): string {
  return join(configDir(), 'config.json');
}

export function dbFile(): string {
  return join(configDir(), 'collection.db');
}
