# Rules Syntax

> **Status:** stub — finalized with Phase 6.

AwapiCompare uses [picomatch](https://github.com/micromatch/picomatch)
glob syntax for include/exclude rules.

## Wildcards

- `*` — matches any sequence of characters except `/`.
- `**` — matches any sequence of characters including `/`.
- `?` — matches a single character.
- `[abc]` — matches any one character from the set.
- `!pattern` — negation.

## Examples

- `*.log` — any file ending in `.log` in the current directory.
- `**/*.log` — any `.log` file at any depth.
- `node_modules/**` — everything under `node_modules/`.
- `!important.log` — exclude from a previous exclusion.

## Size / mtime filters

Rules may also carry size (`gt`/`lt` in bytes) and mtime (`after`/`before`
epoch ms) predicates, evaluated after the glob matches.
