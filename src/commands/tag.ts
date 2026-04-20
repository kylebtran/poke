import { Command } from 'commander';
import { Readable } from 'node:stream';
import { openDatabase, type DB } from '../db/migrate.js';
import {
  addTagToOwnedByCardId,
  removeTagFromOwnedByCardId,
  addTagToOwnedById,
  removeTagFromOwnedById,
} from '../db/tags.js';
import { readLines } from '../io/ndjson.js';
import { parseLine } from '../io/record.js';
import { UserError } from '../errors.js';

export interface TagArgOptions {
  remove?: boolean;
  db?: DB;
  stderr?: NodeJS.WritableStream;
}

/** Arg mode: `poke tag <card-id> <tag> [--remove]`. */
export async function runTagOne(
  cardRef: string,
  tag: string,
  opts: TagArgOptions = {},
): Promise<void> {
  if (!cardRef || !tag) throw new UserError('card id and tag required');
  const db = opts.db ?? openDatabase();
  const stderr = opts.stderr ?? process.stderr;
  try {
    if (opts.remove) {
      const n = removeTagFromOwnedByCardId(db, cardRef, tag);
      stderr.write(`removed tag '${tag}' from ${n} owned row${n === 1 ? '' : 's'}\n`);
      return;
    }
    const n = addTagToOwnedByCardId(db, cardRef, tag);
    if (n === 0) {
      throw new UserError(`no owned rows for '${cardRef}'`, {
        hint: "you need to 'poke add' first, then 'poke tag'",
      });
    }
    stderr.write(`tagged '${tag}' on ${n} owned row${n === 1 ? '' : 's'}\n`);
  } finally {
    if (!opts.db) db.close();
  }
}

export interface TagStreamOptions {
  add?: string;
  remove?: string;
  stdin?: Readable;
  stderr?: NodeJS.WritableStream;
  db?: DB;
}

export interface TagStreamResult {
  tagged: number;
  untagged: number;
  skipped: number;
  malformed: number;
}

/**
 * Stream mode: `poke tag --add <tag>` or `--remove <tag>`.
 *
 * Per-record commits; failures are logged to stderr and the stream
 * continues. On EOF we print `tagged N, skipped M` (spec §8).
 */
export async function runTagStream(opts: TagStreamOptions): Promise<TagStreamResult> {
  const db = opts.db ?? openDatabase();
  const stdin = opts.stdin ?? process.stdin;
  const stderr = opts.stderr ?? process.stderr;
  const stats: TagStreamResult = { tagged: 0, untagged: 0, skipped: 0, malformed: 0 };

  const mode: 'add' | 'remove' = opts.remove !== undefined ? 'remove' : 'add';
  const tagName = mode === 'add' ? opts.add : opts.remove;
  if (!tagName) {
    throw new UserError('--add <tag> or --remove <tag> required for stream mode');
  }

  try {
    for await (const line of readLines(stdin)) {
      const record = parseLine(line);
      if (!record) {
        stats.malformed++;
        continue;
      }
      try {
        const ownedId = record.owned?.owned_id;
        if (ownedId !== undefined) {
          if (mode === 'add') addTagToOwnedById(db, ownedId, tagName);
          else removeTagFromOwnedById(db, ownedId, tagName);
          mode === 'add' ? stats.tagged++ : stats.untagged++;
        } else {
          const n =
            mode === 'add'
              ? addTagToOwnedByCardId(db, record.id, tagName)
              : removeTagFromOwnedByCardId(db, record.id, tagName);
          if (n === 0) {
            stats.skipped++;
            stderr.write(`skip ${record.id}: no owned rows\n`);
          } else if (mode === 'add') {
            stats.tagged += n;
          } else {
            stats.untagged += n;
          }
        }
      } catch (err) {
        stats.skipped++;
        stderr.write(`skip ${record.id}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  } finally {
    if (stats.malformed > 0) {
      stderr.write(
        `warn: skipped ${stats.malformed} malformed record${stats.malformed === 1 ? '' : 's'}\n`,
      );
    }
    // Summary line, spec §8.
    const verb = mode === 'add' ? 'tagged' : 'untagged';
    const n = mode === 'add' ? stats.tagged : stats.untagged;
    stderr.write(`${verb} ${n}, skipped ${stats.skipped}\n`);
    if (!opts.db) db.close();
  }
  return stats;
}

export function registerTagCommand(program: Command): void {
  program
    .command('tag [card-id] [tag]')
    .description('tag a card (arg mode) or every card on stdin (--add/--remove stream mode)')
    .option('--add <tag>', 'stream mode: add <tag> to every record on stdin')
    .option('--remove [tag]', 'remove tag (arg mode: flag; stream mode: <tag>)')
    .action(
      async (
        cardRef: string | undefined,
        tagArg: string | undefined,
        opts: { add?: string; remove?: string | boolean },
        cmd: Command,
      ) => {
        // Stream mode: --add <tag> or --remove <tag>
        if (opts.add || (typeof opts.remove === 'string' && opts.remove.length > 0)) {
          await runTagStream({
            ...(opts.add !== undefined ? { add: opts.add } : {}),
            ...(typeof opts.remove === 'string' ? { remove: opts.remove } : {}),
          });
          return;
        }
        // Arg mode: tag <card-id> <tag> [--remove]
        if (!cardRef || !tagArg) {
          throw new UserError('usage: poke tag <card-id> <tag> [--remove]');
        }
        await runTagOne(cardRef, tagArg, {
          ...(opts.remove === true ? { remove: true } : {}),
        });
        void cmd;
      },
    );
}
