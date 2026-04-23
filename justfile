# AwapiCompare — task runner.
# Requires: pnpm >= 10, node >= 22, just >= 1.49.

set shell := ["bash", "-cu"]
set dotenv-load := true

# Default: list recipes.
default:
    @just --list

# ---- setup --------------------------------------------------------------

# Install all workspace dependencies.
install:
    pnpm install

# Remove all build/test output.
clean:
    pnpm -r exec rm -rf dist out build coverage .turbo .tsbuildinfo || true
    rm -rf release coverage playwright-report test-results

# ---- dev ----------------------------------------------------------------

# Run the desktop app in dev mode with HMR.
dev:
    pnpm --filter @awapi/desktop dev

# ---- quality ------------------------------------------------------------

# Lint all TypeScript sources.
lint:
    pnpm lint

# Format all sources with Prettier.
fmt:
    pnpm format

# Type-check all workspaces (project references).
typecheck:
    pnpm typecheck

# ---- tests --------------------------------------------------------------

# Unit + integration tests with coverage.
test:
    pnpm test

# Vitest in watch mode.
test-watch:
    pnpm test:watch

# Playwright end-to-end tests (requires build first).
test-e2e: build
    pnpm test:e2e

# Open the HTML coverage report.
coverage:
    @echo "Open coverage/index.html in your browser"
    @command -v open >/dev/null && open coverage/index.html || true

# ---- build & package ----------------------------------------------------

# Build all workspaces (no installer).
build:
    pnpm build

# Package an installer for the current OS.
# Usage: just package           (current OS)
#        just package mac       (dmg+zip, universal)
#        just package win       (nsis, x64+arm64)
#        just package linux     (AppImage+deb)
package target="": build notices
    pnpm --filter @awapi/desktop exec electron-builder {{ if target == "" { "" } else if target == "mac" { "--mac" } else if target == "win" { "--win" } else if target == "linux" { "--linux" } else { "--" + target } }}

# Package for all platforms (CI only; requires cross-build tooling).
package-all: build notices
    pnpm --filter @awapi/desktop exec electron-builder -mwl

# Regenerate THIRD_PARTY_NOTICES.md from all production deps.
notices:
    pnpm exec tsx scripts/generate-notices.ts

# ---- CLI ----------------------------------------------------------------

# Run the built CLI against two folders.
# Usage: just cli ./left ./right
cli *args:
    pnpm --filter @awapi/cli exec node dist/index.js {{args}}

# ---- release ------------------------------------------------------------

# Bump version, tag, and push. CI takes it from there.
# Usage: just release 0.1.0
release version:
    @echo "Releasing v{{version}}"
    pnpm -r exec npm version {{version}} --no-git-tag-version
    git add -A
    git commit -m "chore: release v{{version}}"
    git tag -a "v{{version}}" -m "v{{version}}"
    git push origin main --follow-tags
