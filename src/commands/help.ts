import { Command } from 'commander';

/**
 * `poke help pipes` — print idiomatic chain examples. Spec §2 lists
 * these as the canonical usage patterns; keep them in sync.
 */
const PIPE_EXAMPLES = `poke is pipe-first. Every read command emits one NDJSON record per line
on a pipe and a colored table on a TTY. Compose commands with | .

Common chains:

  # Value of everything tagged 'investment'
  poke list --tag investment | poke value --total

  # Single-set cards worth more than $50
  poke list --set sv4 | poke filter 'value>50'

  # Top 10 most valuable cards you own
  poke list | poke sort --by value --desc | head -n 10

  # Tag every secret rare in a JA set as 'grail'
  poke list --set sv10_ja | poke filter 'tier=secret' | poke tag --add grail

  # Case-insensitive name search, then show detail
  poke list | poke filter 'name~charizard' | head -n 1 | poke show

Predicate syntax (poke filter):

  <field> <op> <value>     op in  = != > >= < <= ~
  value>50                 price.market * owned.quantity
  tier=secret              rarity tier
  name~charizard           case-insensitive substring
  tag=psa10                owned.tags membership

Format overrides:

  --format table|ndjson    force output mode
  --json                   emit a single JSON array (for jq consumers)
  --no-color               disable ANSI color

See 'poke --help' for the full command list.
`;

export function registerHelpCommand(program: Command): void {
  const help = program.command('help').description('extra help topics');
  help
    .command('pipes')
    .description('idiomatic pipe chains')
    .action(() => {
      process.stdout.write(PIPE_EXAMPLES);
    });
}
