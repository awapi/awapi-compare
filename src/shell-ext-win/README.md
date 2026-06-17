# AwapiCompare Explorer command handler (Windows, native)

This directory contains the native Windows component for C0.5 of the shell
integration plan: an in-process COM server (`AwapiCompareShellExt.dll`) that
implements [`IExplorerCommand`](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-iexplorercommand)
for three Explorer verbs.

| CLSID                                    | Verb             | Launches                                  |
| ---------------------------------------- | ---------------- | ----------------------------------------- |
| `{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}` | `CompareTwo`     | `<exe> --compare-two "<a>" "<b>"`         |
| `{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}` | `SelectLeft`     | `<exe> --set-left "<path>"`               |
| `{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}` | `ComparePending` | `<exe> --compare-pending "<path>"`        |

## Why native?

The legacy `CommandStore\…\command` registry verbs (already wired by
[`shellIntegrationService.ts`](../desktop/src/main/services/shellIntegrationService.ts))
can only receive a single `%1` path. A native `IExplorerCommand` handler is
required to:

- **Multi-select** — receive the full `IShellItemArray`, so right-clicking two
  items and choosing _Compare with AwapiCompare_ works in one click.
- **Dynamic labels** — `GetTitle()` returns _"Compare to readme.txt"_ once a
  left side has been picked.
- **Windows 11 modern menu** — verbs backed by an `IExplorerCommand` handler
  shipped in a package surface in the compact menu instead of only under
  _Show more options_ (see "Windows 11 modern menu" below).

## Configuration (read from the registry at runtime)

The handler is deliberately stateless about install location. It reads its
configuration from values written by `ShellIntegrationService.register()`:

| Value                                          | Meaning                          |
| ---------------------------------------------- | -------------------------------- |
| `HKCU\Software\Awapi\AwapiCompare\ExePath`         | Path to `AwapiCompare.exe`   |
| `HKCU\Software\Awapi\AwapiCompare\PendingLeftPath` | Path to `pending-left.txt`   |

If `ExePath` is missing or the executable no longer exists, every verb hides
itself via `GetState() → ECS_HIDDEN`. Combined with the `command` fallback
subkeys, this guarantees Explorer never breaks when the app is missing or
out of date (acceptance criterion #4).

## Build

Requires **MSVC (Visual Studio Build Tools)** and the **Windows SDK** plus
**CMake ≥ 3.21**. None of these are needed for the rest of the repo, so they
are not part of `just install`.

```powershell
cmake -S . -B build -A x64
cmake --build build --config Release
# → build/Release/AwapiCompareShellExt.dll
```

A convenience wrapper exists at the repo root:

```powershell
just shellext        # configures + builds Release x64
```

## Register / unregister for local testing

The DLL self-registers its CLSIDs (per-user, no elevation) via `regsvr32`:

```powershell
regsvr32 .\build\Release\AwapiCompareShellExt.dll       # register CLSIDs
regsvr32 /u .\build\Release\AwapiCompareShellExt.dll     # remove CLSIDs
```

To exercise it end-to-end, also run the Electron app once with
`--register-shell` (writes the CommandStore verbs, the `ExplorerCommandHandler`
CLSID bindings, and the `ExePath` / `PendingLeftPath` config values), then
restart `explorer.exe`.

## Windows 11 modern menu (remaining work)

Registry-only `IExplorerCommand` handlers appear under _Show more options_ on
Windows 11. To surface in the **compact** menu, the handler must be declared in
a (sparse) MSIX package manifest under `desktop4:FileExplorerContextMenus` and
the package must be **signed**. Code signing is currently disabled for v1
(`forceCodeSigning: false` in `electron-builder.yml`), so the sparse-package
step — and the runtime validation of the compact-menu placement — is tracked
as remaining work for C0.5 / C3 in
[`todo/shell-integration.md`](../../todo/shell-integration.md).
