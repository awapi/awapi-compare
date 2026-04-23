# Testing

## Layers

- **Unit tests** — Vitest, colocated as `*.test.ts` next to the module
  under test. No `electron` imports allowed.
- **Integration tests** — Vitest, same location. Allowed to wire
  multiple modules together; use `memfs` for filesystem and `msw/node`
  for HTTP.
- **End-to-end tests** — Playwright with the `electron` launcher,
  `tests/e2e/*.spec.ts`. Fixtures under `tests/fixtures/`.

## Coverage thresholds

Enforced by [`vitest.config.ts`](../vitest.config.ts):

- Lines / statements / functions ≥ 80% overall.
- Branches ≥ 75%.
- **100% on pure-logic modules:** rules engine, diff classifier,
  license trial/verify, CLI arg parser.

## Running

```bash
just test          # unit + integration with coverage
just test-watch    # vitest watch mode
just test-e2e      # Playwright (builds first)
just coverage      # open HTML report
```

## Mocking guidelines

- Filesystem: `memfs` via constructor injection. Services accept an
  `fs` parameter so tests pass a memfs instance.
- HTTP: `msw/node` for licensing + update-feed tests.
- Electron APIs: wrap in an adapter interface; unit tests use a fake.
