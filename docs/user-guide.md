# User Guide

> **Status:** stub — fill in as features land.

## Installation

- macOS: download the `.dmg`, drag to Applications. First launch will
  show a Gatekeeper warning until v1.x is signed.
- Windows: run the `.exe` installer (NSIS).
- Linux: use the `.AppImage` (make executable) or the `.deb` package.

## First run

1. Accept the EULA.
2. A 14-day trial begins automatically.
3. Pick two folders to compare.

## Command line / launch flags

AwapiCompare can be launched with a folder pair pre-loaded into the
first compare tab. This is useful for shell aliases, editor
integrations, and scripted workflows.

```sh
awapi-compare --type folder --left <leftPath> --right <rightPath> [--mode quick|thorough|binary]
```

| Flag       | Required | Default  | Description                                                  |
| ---------- | -------- | -------- | ------------------------------------------------------------ |
| `--type`   | no       | `folder` | Compare type. Only `folder` is supported today.              |
| `--left`   | yes\*    | —        | Left-hand path. Relative paths resolve against `cwd`.        |
| `--right`  | yes\*    | —        | Right-hand path. Relative paths resolve against `cwd`.       |
| `--mode`   | no       | `quick`  | Compare algorithm: `quick`, `thorough`, or `binary`.         |

\* Both `--left` and `--right` must be provided together, or neither.

Both `--flag value` and `--flag=value` forms work. Unknown flags are
ignored, so Electron-internal switches (e.g. `--remote-debugging-port`)
do not interfere.

### Environment variables

The same inputs can be supplied via env vars — handy for `just dev` or
CI:

| Variable      | Equivalent flag |
| ------------- | --------------- |
| `AWAPI_LEFT`  | `--left`        |
| `AWAPI_RIGHT` | `--right`       |
| `AWAPI_MODE`  | `--mode`        |
| `AWAPI_TYPE`  | `--type`        |

CLI flags take precedence over env vars when both are set.

### Behavior

- The folder pair is written into the first compare tab on launch; the
  user still presses **Compare** to run the scan (no automatic scan).
- If the first compare tab already has a non-empty `left` or `right`
  (e.g. an HMR remount), the launch values are not overwritten.
- Malformed args print to stderr/console and the app starts with an
  empty session — it never crashes on bad input.

### Development shortcut

`just dev` accepts positional args that are forwarded as env vars:

```sh
just dev ./samples/left ./samples/right            # quick mode
just dev ./samples/left ./samples/right thorough   # quick | thorough | binary
```

