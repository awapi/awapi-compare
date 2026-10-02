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

### Three-way merge from the command line

```sh
awapi-compare [--base <basePath>] --left <leftPath> --right <rightPath> --output <outputPath>
```

Passing `--output` opens a [three-way merge](#three-way-merge) tab instead
of a folder compare. `--base` is optional (an empty base is used when it
is omitted); `--type merge` is accepted but not needed. Prefer the
`--output` form: `--type` is a reserved Chromium switch and the
`--type=merge` spelling crashes the Electron binary when it is passed
directly. `AWAPI_BASE` and `AWAPI_OUTPUT` are the matching env vars.

The process exits with code **0** if the output file was written while the
window was open and **1** if it was closed without saving, so it can be
used as a `git mergetool`:

```sh
git config merge.tool awapi
git config mergetool.awapi.cmd 'awapi-compare --base "$BASE" --left "$LOCAL" --right "$REMOTE" --output "$MERGED"'
git config mergetool.awapi.trustExitCode true
```

### Environment variables

The same inputs can be supplied via env vars — handy for `just dev` or
CI:

| Variable      | Equivalent flag |
| ------------- | --------------- |
| `AWAPI_LEFT`  | `--left`        |
| `AWAPI_RIGHT` | `--right`       |
| `AWAPI_MODE`  | `--mode`        |
| `AWAPI_TYPE`  | `--type`        |
| `AWAPI_BASE`  | `--base`        |
| `AWAPI_OUTPUT`| `--output`      |

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

## Folder table: sorting and view filters

- **Sorting.** Click a column header (Name, Size, Modified on either side,
  or the centre status column) to sort ascending, click again for
  descending, and a third time to return to the default order. Sorting is
  applied within each folder and folders always stay above files. Entries
  missing on the sorted side sink to the bottom. The active column shows
  ▲ / ▼.
- **Newer indicator.** When one side of a pair is newer (outside the
  configured mtime tolerance), its *Modified* cell is bold and marked ▲.
- **View filters.** The toolbar has **All**, **Diffs** and **Same**, plus a
  **More filters…** dropdown:

  | Filter        | Shows                                                         |
  | ------------- | ------------------------------------------------------------- |
  | Different only | Entries on both sides that differ (including newer-on-one-side) |
  | Newer only    | Entries flagged newer on the left or the right                |
  | Orphans only  | Entries that exist on one side only                           |
  | Selected only | The rows selected when the filter was applied, plus the contents of selected folders |

  Parent folders of matching rows stay visible so the tree remains
  navigable. "Selected only" is disabled until at least one row is
  selected, and it keeps the selection it was applied with, so clicking
  other rows does not change the view. The status bar totals always reflect
  the unfiltered scan.

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

### Text compare controls

The bar above a text diff has these controls (choices are remembered
across sessions and shared by all file-diff tabs):

| Control            | What it does                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| **▲ / ▼**          | Previous / next difference (`Shift+F7` / `F7`, also while the editor has focus). Wraps around. |
| **Difference N of M** | Position among the differences that matter, plus how many are ignored.    |
| **← / →**          | Copy the *current* difference to the left / right side (copies the whole hunk). |
| **Inline**         | Show one inline pane instead of two side-by-side panes.                       |
| **Wrap**           | Wrap long lines.                                                              |
| **Ignore ▾**       | Choose which differences to ignore (below).                                   |

**Ignore options.** *Leading / trailing whitespace* is on by default.
You can also ignore *all whitespace*, *letter case*, and any text that
matches one or more regular expressions (one per line, JavaScript
syntax — e.g. `\d{4}-\d{2}-\d{2}` for dates, `//.*` for line
comments). A line that is entirely consumed by a pattern is dropped, so
an inserted comment line can be ignored as a whole. Invalid patterns are
flagged and skipped.

Differences that only differ by ignored text are dimmed, left out of the
counter and skipped by **Next / Previous**. A changed block that mixes an
ignorable change with a real one stays a normal difference, because the
editor reports adjacent changed lines as one block.

**Encoding and line endings.** The strip below the editor shows, for each
side, the file's encoding (detected on open: UTF-8, UTF-8 with BOM,
UTF-16 LE/BE with BOM, otherwise Windows-1252) and its line endings
(LF / CRLF). Saving writes the file back in the same encoding, so a
UTF-16 file or a BOM is no longer silently converted. Pick another
value to convert a file; that counts as an unsaved change. Saving to an
encoding that cannot represent some characters (for example Windows-1252)
is refused with a message rather than replacing them. Files with mixed
line endings are shown as *mixed line endings* and unified to the chosen
style on save.

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

Select several rows (`Ctrl`/`Shift`-click) and use the same actions to
copy them all in one go.

## Syncing folders

Click **Sync** in the folder-compare toolbar (enabled once both folders
are set) to reconcile the two sides in bulk. Pick a mode:

| Mode                    | Effect                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Mirror left → right     | Right becomes identical to left: copies/overwrites everything and **deletes** right-only items |
| Mirror right → left     | The inverse                                                                             |
| Update left → right     | Copies left-only and newer-on-left items to the right; never deletes, never overwrites a newer right file |
| Update right → left     | The inverse                                                                             |
| Two-way sync            | Copies orphans to the other side and the newer file of each differing pair over the older; never deletes |

The dialog previews every operation before anything is touched (a dry
run); changing the mode refreshes the preview. Tick **Selected rows
only** to limit the sync to the rows selected in the table (and the
contents of selected folders).

- Pairs that cannot be resolved automatically — same-age files with
  different content in update/two-way modes, or a file opposite a
  folder — are listed as **conflicts** and skipped.
- Modes that delete require ticking an explicit confirmation. Folder
  operations apply to the whole folder, including entries hidden by
  rules.
- Failures on individual items do not stop the run; they are listed in
  the result and the view is rescanned when you close the dialog.

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

## Three-way merge

**File → New Three-Way Merge** (`Ctrl/Cmd+Shift+M`) opens a merge tab. Enter
the **Left** and **Right** versions, optionally the **Base** (common
ancestor) and the **Output** path, then press **Load** (or `Enter` in a
path box). Opening from the command line loads automatically.

- **Layout.** Left, Base and Right are read-only panes on top; the
  editable **Result** is below. Every changed region is highlighted in all
  panes: blue = changed on the left only, green = right only, grey =
  changed identically on both, red = conflict (green once resolved). The
  current region has an accent bar on its left edge.
- **Auto-merge.** Changes made on only one side, and identical changes on
  both, are applied to the result. Changes whose lines overlap or touch
  are conflicts and appear in the result as
  `<<<<<<< left` / `=======` / `>>>>>>> right` blocks.
- **Resolving.** Step with ▲ / ▼ (`Shift+F7` / `F7`) through every change, or
  with **◀ Conflict** / **Conflict ▶** through conflicts only. For the
  current region choose **Take left**, **Take base**, **Take right**,
  **Left + right** or **Right + left**. Any region (not just conflicts) can
  be changed this way, and you can also edit the result by hand; regions
  stay tracked as you type, and a conflict counts as resolved once its
  marker lines are gone. Clicking in any pane selects that region.
- **Saving.** **Save result** (or `Ctrl/Cmd+S`) writes the result to the
  output path, keeping the output file's encoding (the left file's if the
  output is new) and the inputs' line endings. If conflicts are still
  unresolved you are asked to confirm, and if the output changed on disk
  since it was loaded you can choose to overwrite. Unsaved results are
  flagged with `*` on the tab and prompt on close.
- Only text files are supported, and lines are compared exactly
  (line-ending differences are ignored).

## Preferences

Open via **Edit → Preferences…** (or **AwapiCompare → Preferences…**
on macOS), keyboard `Cmd/Ctrl+,`. Preferences are stored locally per
machine.

- **Confirm before overwriting an existing file when copying between
  sides** — when on (default), Copy → Right / Copy ← Left ask before
  replacing destination files. When off, copies proceed silently.
