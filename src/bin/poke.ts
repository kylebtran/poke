#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exitCodeFor, PokeError } from '../errors.js';
import { registerConfigCommand } from '../commands/config.js';
import { registerInitCommand } from '../commands/init.js';
import { registerShowCommand } from '../commands/show.js';
import { registerAddCommand } from '../commands/add.js';
import { registerRemoveCommand } from '../commands/remove.js';
import { registerListCommand } from '../commands/list.js';
import { registerFilterCommand } from '../commands/filter.js';
import { registerSortCommand } from '../commands/sort.js';
import { registerSetsCommand } from '../commands/sets.js';
import { registerSetCommand } from '../commands/set.js';
import { registerProgressCommand } from '../commands/progress.js';
import { registerValueCommand } from '../commands/value.js';
import { registerTagCommand } from '../commands/tag.js';
import { registerSearchCommand } from '../commands/search.js';
import { registerImportCommand } from '../commands/import.js';
import { registerExportCommand } from '../commands/export.js';
import { registerRefreshCommand } from '../commands/refresh.js';

function readPackageVersion(): string {
  try {
    // dist/bin/poke.js → ../../package.json
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('poke')
    .description('CLI for international Pokémon card collections (Scrydex-backed).')
    .version(readPackageVersion(), '-v, --version', 'print version');

  // Global flags. Commander makes these available via program.opts().
  program
    .option('--format <mode>', 'output format: table|ndjson')
    .option('--json', 'emit a single JSON array wrapping the full result set')
    .option('--no-color', 'disable color output')
    .option('--debug', 'print stack traces on error');

  return program;
}

function shouldShowStack(argv: readonly string[]): boolean {
  return argv.includes('--debug') || process.env.POKE_DEBUG === '1';
}

async function main(): Promise<void> {
  const program = buildProgram();
  registerConfigCommand(program);
  registerInitCommand(program);
  registerShowCommand(program);
  registerAddCommand(program);
  registerRemoveCommand(program);
  registerListCommand(program);
  registerFilterCommand(program);
  registerSortCommand(program);
  registerSetsCommand(program);
  registerSetCommand(program);
  registerProgressCommand(program);
  registerValueCommand(program);
  registerTagCommand(program);
  registerSearchCommand(program);
  registerImportCommand(program);
  registerExportCommand(program);
  registerRefreshCommand(program);
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    handleTopLevelError(err);
  }
}

function handleTopLevelError(err: unknown): never {
  const debug = shouldShowStack(process.argv);
  if (err instanceof PokeError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
    if (debug && err.stack) process.stderr.write(err.stack + '\n');
    process.exit(exitCodeFor(err));
  }
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    if (debug && err.stack) process.stderr.write(err.stack + '\n');
    process.exit(1);
  }
  process.stderr.write(`error: ${String(err)}\n`);
  process.exit(1);
}

// Only invoke main() when this file is the entry point (supports both
// `poke` bin invocation and importing in tests).
const isMain = (() => {
  if (!import.meta.url.startsWith('file:')) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1];
    return argv1 !== undefined && thisFile === argv1;
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}
