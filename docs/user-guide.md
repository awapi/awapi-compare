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

## Drag and drop

Drop folders or files from your file manager onto either half of a
compare tab to set that side:

- **Folder-compare tab.**
  - Drop a **folder** onto the left or right half → that side's root
    is set and the comparison runs.
  - Drop a **single file** onto the left or right half → a new
    file-compare tab opens with that side seeded.
  - Drop **two files at once** onto the body → a new file-compare tab
    opens with both sides seeded (left = first file, right = second).
- **File-compare tab.**
  - Drop a **file** onto the left or right half → that side's path is
    set.
  - Drop **two files at once** → both sides are set (left = first
    file, right = second), regardless of pointer position.
  - Folders are ignored on a file-compare tab — drop them onto a
    folder-compare tab instead.

The half under the pointer is highlighted while you drag.

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

## Filters (include / exclude rules)

The toolbar's **Rules** button opens the Rules editor. It has two tabs:

- **Simple** (default) — four boxes, mirroring Beyond Compare's Name
  Filters dialog. One glob per line.

  | Box              | What it does                                                       | Default |
  | ---------------- | ------------------------------------------------------------------ | ------- |
  | Include files    | Whitelists file basenames. Custom value flips files into whitelist. | `**`    |
  | Exclude files    | Blacklists file basenames.                                          | (empty) |
  | Include folders  | Whitelists folder names.                                            | `*`     |
  | Exclude folders  | Drops the folder **and** everything beneath it.                     | (empty) |

  Defaults are intentionally permissive — typing nothing keeps every
  entry. Whitelist mode is per-scope: an "include files" filter never
  drops folders, and vice versa.

- **Advanced** — the full ordered, last-match-wins editor with
  `kind` × `target` × `scope` × `pattern` plus optional `size` /
  `mtime` predicates. See [Rules Syntax](./rules-syntax.md) for the
  underlying model.

When a rule set uses features the Simple view can't represent
(custom ordering, predicates, or rule shapes outside the four-box
model), the Simple tab shows a banner with a one-click escape to the
Advanced tab.

The live-preview pane on the right works from both tabs and uses the
exact same matcher the scanner will use.


## File-diff view

Double-click any pair in the compare tree to open a file-diff tab.
AwapiCompare picks the right viewer from the file's content (not its
extension):

- **Text** — Monaco-backed side-by-side diff with syntax highlighting.
  Both sides are editable in place. Hit **Save** to write back via
  the main process.
- **Hex** — virtualised 16-byte rows for any binary file. Differing
  rows are tinted; the offsets column tracks the absolute byte
  position.
- **Image** — three modes: side-by-side, onion-skin (with an opacity
  slider), and pixel-diff (red highlights from `pixelmatch`).

### Large files

Files above 5 MiB show a confirmation gate ("Open anyway") before
loading; files above 50 MiB are refused entirely. The hard cap exists
to keep the renderer responsive — use the CLI for bulk diffs at that
scale.

### External-modification protection

When you save an edited file, AwapiCompare passes the on-disk mtime
captured at load time alongside the new contents. If something else
has touched the file in the meantime, the save is rejected and you're
prompted before overwriting. Choosing **OK** discards your edits and
reloads from disk; choosing **Cancel** keeps the editor dirty so you
can copy your changes elsewhere.

## Copying between sides

In the folder-compare view you can replicate any row from one side
to the other:

- **Copy → Right** — replace (or create) the right-hand version with
  the left-hand file/folder. Keyboard: `Alt+→`.
- **Copy ← Left** — the inverse. Keyboard: `Alt+←`.

When the destination already has a file at the same relative path,
AwapiCompare prompts before overwriting and offers a **Don't ask
again** checkbox. Tick it to skip the prompt for the rest of the
session (and future launches). You can re-enable the prompt at any
time from **Preferences → Folder compare**.

Inside the **file-diff view**, the editor's right-click menu also
exposes **Copy → Right** and **Copy ← Left** for moving the current
text selection between the two open buffers. When the destination
side does not exist yet (e.g. the file-diff tab was opened from a
left-only folder-compare row), picking either menu item instead
prompts to **create** the missing file as a whole-file copy of the
source side. Once created, the new file loads into the editor and
selection-level copy resumes its normal behaviour.

## Renaming and deleting

Right-click any row in the folder-compare view to access:

- **Rename…** — change the basename of the selected entry. When both
  sides exist at the same relative path they are renamed together
  (the new name is applied to each side's parent directory).
  Keyboard: `F2`.
- **Delete** — permanently remove the selected entry. A confirmation
  dialog lists the absolute path(s) that will be deleted; folders
  are removed recursively. When both sides exist they are both
  deleted. Keyboard: `Del`.

Both actions surface filesystem errors (e.g. permission denied,
destination already exists) inline at the bottom of the compare tab
and the view is refreshed automatically afterwards.

## Preferences

Open via **Edit → Preferences…** (or **AwapiCompare → Preferences…**
on macOS), keyboard `Cmd/Ctrl+,`. Preferences are stored locally per
machine.

- **Confirm before overwriting an existing file when copying between
  sides** — when on (default), Copy → Right / Copy ← Left ask before
  replacing destination files. When off, copies proceed silently.
