# Contributing

Thanks for working on AwapiCompare. Please read
[`.github/copilot-instructions.md`](../.github/copilot-instructions.md)
and [`todo/README.md`](../todo/README.md) first — the same rules apply to
humans and to automated agents.

## Getting started

```bash
just install
just dev
```

To launch the app pre-loaded with a folder pair (handy when iterating
on diff/scan code):

```bash
just dev ./samples/left ./samples/right            # quick mode (default)
just dev ./samples/left ./samples/right thorough   # quick | thorough | binary
```

See [`docs/user-guide.md`](user-guide.md#command-line--launch-flags)
for the full launch-flag contract; the parser lives in
`src/desktop/src/main/cliArgs.ts`.

## Workflow

1. Pick the next unchecked item in [`todo/plan.md`](../todo/plan.md).
2. Branch: `git checkout -b feat/short-name` (or `fix/…`, `chore/…`).
3. Implement + tests.
4. Tick the matching checkbox in `todo/plan.md` in the same commit.
5. Open a PR using the template.

## Quality gates

- `just lint` — ESLint
- `just typecheck` — TypeScript
- `just test` — Vitest with coverage
- `just test-e2e` — Playwright (runs locally too)

PRs must pass all gates before review.

## Conventional Commits

- `feat:` — new user-visible capability
- `fix:` — bug fix
- `chore:` — tooling, deps, build
- `docs:` — docs only
- `test:` — tests only
- `refactor:` — code restructuring, no behavior change
- `plan:` — changes to `todo/plan.md` scope

## Dependencies

- No GPL / AGPL / SSPL dependencies (proprietary product).
- Run `just notices` before adding a new dependency; verify its license
  is MIT / BSD / Apache-2.0 / ISC or similarly permissive.
