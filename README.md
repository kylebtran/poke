# poke

A Unix-style CLI for international Pokémon card collections. Backed by
[Scrydex](https://scrydex.com). Pipe-first: every read command emits one
NDJSON record per line on a pipe and a colored table on a TTY.

```sh
npm i -g poke-cli
poke init
poke list --tag investment | poke value --total
```

Status: under active development. See `PLAN.md` (internal) for build
order.

## License

MIT
