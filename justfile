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
# Defaults pre-load the bundled sample folder pair into the first compare
# tab so debugging doesn't require manual folder-picking. Override with:
#   just dev ./left ./right [mode]
#   just dev "" ""               # start with no preloaded session
# `mode` defaults to "quick" (one of: quick | thorough | binary).
dev left="" right="" mode="quick":
    #!/usr/bin/env bash
    set -euo pipefail
    # Resolve paths against the repo root (where `just` was invoked) so
    # they don't get re-resolved against `src/desktop` once pnpm cd's
    # into the desktop workspace. Skip resolution when an empty string
    # was passed (the documented "no preloaded session" form).
    abspath() {
        if [[ -z "$1" ]]; then
            echo ""
        elif [[ "$1" = /* ]]; then
            echo "$1"
        else
            echo "$(cd "$(dirname "$1")" 2>/dev/null && pwd)/$(basename "$1")"
        fi
    }
    AWAPI_LEFT="$(abspath "{{left}}")" \
    AWAPI_RIGHT="$(abspath "{{right}}")" \
    AWAPI_MODE="{{mode}}" \
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
#        just package mac       (dmg+zip, x64+arm64)
#        just package win       (nsis exe + msi, x64+arm64)
#        just package linux     (AppImage+deb, x64+arm64)
#
# Note: electron-builder is invoked from the repo root so it picks up
# the root `electron-builder.yml`. `--projectDir` points it at the
# packaged Electron app under `src/desktop/`.
package target="": build notices
    ./src/desktop/node_modules/.bin/electron-builder --config {{justfile_directory()}}/electron-builder.yml --projectDir src/desktop {{ if target == "" { "" } else if target == "mac" { "--mac" } else if target == "win" { "--win" } else if target == "linux" { "--linux" } else { "--" + target } }}

# Package for all platforms (CI only; requires cross-build tooling).
package-all: build notices
    ./src/desktop/node_modules/.bin/electron-builder --config {{justfile_directory()}}/electron-builder.yml --projectDir src/desktop -mwl

# Regenerate THIRD_PARTY_NOTICES.md from all production deps.
notices:
    pnpm exec tsx scripts/generate-notices.ts

# ---- CLI ----------------------------------------------------------------

# Run the built CLI against two folders.
# Usage: just cli ./left ./right
cli *args:
    pnpm --filter @awapi/cli exec node dist/index.js {{args}}

# ---- release ------------------------------------------------------------

# Bump version, tag, and push to trigger the GitHub Actions release
# workflow. The workflow builds on macOS / Linux / Windows and uploads
# the artifacts to a *draft* GitHub Release.
#
# By default the release stays as a draft so you can review it. Pass
# `publish` as the second argument to automatically promote it to the
# latest release once the workflow finishes (end-users' update check
# only sees published releases).
#
#   just release 0.1.3           # draft only (default)
#   just release 0.1.3 publish   # draft + auto-publish when CI finishes
#
# Auto-publish requires the GitHub CLI (`brew install gh` + `gh auth login`).
release version mode="draft":
    @echo "Bumping versions to {{version}}..."
    pnpm -r exec npm version {{version}} --no-git-tag-version
    git add -A
    git commit -m "chore: release v{{version}}"
    git push
    @echo "Creating and pushing release tag v{{version}}..."
    git tag -a "v{{version}}" -m "v{{version}}"
    git push origin v{{version}}
    @echo ""
    @echo "✓ Tag pushed. GitHub Actions is now building and uploading to a draft release."
    @if [ "{{mode}}" = "publish" ]; then \
        command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install with: brew install gh"; exit 1; }; \
        echo "Waiting for the release workflow to finish before publishing..."; \
        sleep 15; \
        gh run watch --exit-status $(gh run list --workflow='Release' --limit 1 --json databaseId --jq '.[0].databaseId') || { echo "Workflow failed — draft left in place for inspection."; exit 1; }; \
        echo "Publishing draft release v{{version}}..."; \
        gh release edit v{{version}} --draft=false --latest; \
        echo "✓ v{{version}} is now the latest release."; \
        echo "  https://github.com/awapi/awapi-compare/releases/tag/v{{version}}"; \
    else \
        echo "  Draft will remain a draft. Publish later with: just publish {{version}}"; \
    fi

# Promote an existing draft GitHub Release to published + mark it as the
# latest release. This is what makes the in-app update notifier see it.
# Requires the GitHub CLI (`brew install gh` and `gh auth login`).
publish version:
    @command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install with: brew install gh"; exit 1; }
    @echo "Publishing draft release v{{version}}..."
    gh release edit v{{version}} --draft=false --latest
    @echo "✓ v{{version}} is now the latest release."
    @echo "  https://github.com/awapi/awapi-compare/releases/tag/v{{version}}"
