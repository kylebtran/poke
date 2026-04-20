# poke

A Unix-style CLI for international Pokémon card collections. Backed by
[Scrydex](https://scrydex.com). Pipe-first: every read command emits one
NDJSON record per line on a pipe and a colored table on a TTY.

## Install

```sh
npm i -g poke-cli
```

Requires Node.js 20+. `better-sqlite3` is a native addon; most users get
a prebuilt binary on install. If you hit a build error, make sure you
have a C/C++ toolchain available (on Debian/Ubuntu: `sudo apt install
build-essential`).

## Quickstart

```sh
# One-time: set API key + team id, create DB
poke init

# Add a card
poke add sv4-23 --qty 2 --note "first charizard"

# See your collection
poke list

# Pipe-first, always
poke list --tag investment | poke value --total
poke list --set sv4 | poke filter 'value>50'
poke list | poke sort --by value --desc | head -n 10
poke list --set sv10_ja | poke filter 'tier=secret' | poke tag --add grail
```

For idiomatic pipe chains: `poke help pipes`.

## Commands

| Command                                             | Purpose                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `poke init`                                         | First-run bootstrap (API key, team id, DB).                              |
| `poke config get\|set\|list`                        | Read/write settings.                                                     |
| `poke add <card-id>`                                | Add cards. Accepts `<set>:<number>` sugar.                               |
| `poke remove <card-id>`                             | Remove (or `--all`).                                                     |
| `poke list`                                         | List owned. Filters: `--set --lang --tag --rarity --tier --with-prices`. |
| `poke show <card-id>`                               | Single card detail.                                                      |
| `poke search <q>`                                   | Remote Scrydex search (query forwarded verbatim).                        |
| `poke sets`                                         | List sets (`--owned` to filter).                                         |
| `poke set <set-id>`                                 | Per-rarity completion for one set.                                       |
| `poke progress --set <id>`                          | Completion summary, `--by rarity\|tier`.                                 |
| `poke filter <predicate>`                           | Stream filter (`value>50`, `tier=secret`, etc.).                         |
| `poke sort --by <field>`                            | Sort stream (nulls last).                                                |
| `poke value`                                        | Sum prices of a stream or the full collection.                           |
| `poke tag <card-id> <tag>` / `poke tag --add <tag>` | Arg or stream mode.                                                      |
| `poke refresh --prices --metadata [--set S]`        | Force cache refresh.                                                     |
| `poke import <file.csv>` / `poke export [file.csv]` | CSV bulk.                                                                |

## Format / color

- Auto-switches to NDJSON when stdout is piped; table on a TTY.
- `--format table\|ndjson` overrides.
- `--json` emits a single JSON array (for `| jq` consumers).
- `--no-color` / `NO_COLOR=1` disables color.
- `--debug` / `POKE_DEBUG=1` surfaces stack traces.

## Exit codes

- `0` success
- `1` user error (bad flag, missing arg, unknown id)
- `2` network / Scrydex error
- `3` config error (missing API key, bad settings file)

## Pricing

USD only. TCGplayer market is the default price field. Use
`--price-field low|mid|high|market` (phase 12+) to override. Japanese
cards without USD pricing render `—` with a dim `unavailable` marker.
No FX conversion.

## Configuration

Settings live at:

- Linux/macOS: `$XDG_CONFIG_HOME/poke/config.json` (or `~/.config/poke/config.json`).
- Windows: `%APPDATA%/poke/config.json`.
- Override with `POKE_CONFIG_DIR`.

Env vars always win over file values for auth:

- `SCRYDEX_API_KEY`
- `SCRYDEX_TEAM_ID`
- `POKE_PRICE_TTL` (hours, default 24)

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Live contract tests against real Scrydex (opt-in, not in CI):

```sh
SCRYDEX_API_KEY=... SCRYDEX_TEAM_ID=... npm run test:live
```

## License

MIT
