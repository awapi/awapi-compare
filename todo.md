# Feature Gap Analysis vs. Beyond Compare

> Snapshot of what AwapiCompare has and what it is still missing compared to
> Beyond Compare 4/5. Each gap is a checkbox so it can be promoted into
> `todo/plan.md` (or ticked here) per the rules in [`todo/README.md`](./todo/README.md).
> Tick a box only when the change is merged to `main`.

## What we already have

- **Folder compare:** tree view, All/Diffs/Same filters, quick/thorough/binary
  modes, and match options (size, mtime tolerance, DST/timezone, case,
  extension, Unicode normalisation).
- **Rules and actions:** include/exclude rules (glob, size and mtime
  predicates). Row actions are copy, delete, rename, mark same, exclude and
  reveal. Right-click menus, drag-and-drop and hotkeys are in.
- **File compare:** a Monaco side-by-side text diff with editing, saving and
  external-modification detection. There are also image diff (side-by-side,
  onion-skin, pixel diff) and hex diff views.
- **App features:** sessions with history, tabs, launch flags and CLI,
  shell/Finder integration, recents, themes, licensing and auto-update.

## What's missing

### High priority (core to Beyond Compare)

- [x] **1. Three-way merge.** See
      [`docs/user-guide.md`](./docs/user-guide.md#three-way-merge).
  - Merge tab (**File → New Three-Way Merge**) with read-only left / base /
    right panes and an editable result; diff3 auto-merge, conflicts shown as
    marker blocks and highlighted in every pane.
  - Next/previous change and conflict, per-region take left / base / right /
    both, manual edits with region tracking, encoding-aware save with
    unresolved-conflict and external-modification prompts.
  - `git mergetool` support: `--base --left --right --output` launch flags and
    exit code 0 / 1 depending on whether the result was saved.
  - Possible follow-ups: ignore whitespace / case when merging, word-level
    highlighting, synced scrolling between panes, "take all from left/right",
    and a documented `--type` story (Chromium reserves `--type` on the raw
    Electron command line).
- [x] **2. Folder sync and merge.** See
      [`docs/user-guide.md`](./docs/user-guide.md#syncing-folders).
  - **Sync** toolbar button opens a dialog with mirror (either direction),
    update (either direction) and two-way modes.
  - Live preview / dry run of every copy and delete, with conflicts listed and
    skipped, optional "selected rows only" scope, and an explicit confirmation
    before any deletion.
  - Multi-row copy (`Alt+→` / `Alt+←` on a selection) is documented.
  - Possible follow-ups: per-item include/exclude in the preview, a
    sync-progress cancel button, honouring rules for entries inside copied or
    deleted folders, conflict resolution choices, headless sync from the CLI.
- [x] **3. Text-compare controls.** See
      [`docs/user-guide.md`](./docs/user-guide.md#text-compare-controls).
  - Ignore whitespace, case and regex-defined "unimportant" text (differences
    are dimmed and skipped, decided per changed block).
  - Next/previous difference (`F7` / `Shift+F7`) and a difference counter.
  - Copy the difference under the caret/selection to the left/right.
  - Inline vs. side-by-side toggle and word wrap.
  - Encoding and EOL display and selection (UTF-8, UTF-8 BOM, UTF-16 LE/BE
    with BOM, Windows-1252).
  - Possible follow-ups: ignore line endings as a difference (Monaco unifies
    line endings on load, so EOL-only differences are not reported); ignore
    blank-line-only differences; ignore ignorable text _within_ a mixed
    changed block; BOM-less UTF-16 detection; gutter arrows in both
    directions (Monaco only offers "revert to left").
- [x] **4. Folder-table basics.** See
      [`docs/user-guide.md`](./docs/user-guide.md#folder-table-sorting-and-view-filters).
  - Click-to-sort columns (name, size, modified on each side, status).
  - "Newer" indicator on the Modified cell.
  - Different / Newer / Orphans / Selected-only filters alongside
    All / Diffs / Same.
  - Possible follow-ups: separate left-only and right-only orphan filters,
    "hide selected", persisting sort order in sessions.
- [x] **5. Stop button.** Cancels the in-flight folder scan (`fs.scan.cancel`
      via a per-scan `AbortController`); previous results are kept.

### Medium priority

- [ ] **6. SFTP/FTP/cloud.** `sftpService.ts` is a stub that throws "v1.1". No
      other remote or cloud profiles exist.
- [ ] **7. Archive compare.** Zip, tar and similar archives can't be opened as
      folders.
- [ ] **8. Other file-type viewers.** Missing are table/CSV, JSON/XML
      structure, Excel and Word, and PDF compare. There's also no MP3/media
      metadata compare.
- [ ] **9. Compare-by-content in folder view.** There's no "Compare contents"
      for selected files, and no content-based rename or move detection.
- [ ] **10. Reports and export.** There's no HTML/text diff report, no
      patch/unified-diff export, and no printing.
- [ ] **11. Preferences are minimal.** The only setting is the overwrite
      confirmation. Missing are fonts, tab width, colours, configurable
      hotkeys, per-file-type/extension-based viewer overrides, and default
      rules.
- [ ] **12. Safer operations.** There's no Recycle Bin/Trash delete option, no
      undo for file operations, and no backup-on-overwrite.
- [ ] **13. CLI gaps.** `src/cli` takes a `--rules` flag that the desktop launch
      flags don't document. The desktop parser accepts `--type file`, but
      [`docs/user-guide.md`](./docs/user-guide.md#command-line--launch-flags)
      still says only `folder` is supported, and there is no way to launch a
      merge from the command line (a `git difftool` / `git mergetool` blocker).

### Lower priority

- [ ] Folder bookmarks, favourites and a drag-to-compare history.
- [ ] Text-only extras: syntax-aware compare, bookmarks, and a "compare to
      clipboard" or "paste vs. paste" scratch mode.
- [ ] A file-level "Touch" action (copy timestamps) and a file/folder
      properties dialog.
- [ ] Symlink handling, permissions and attribute comparison, and case-only
      rename handling.
- [ ] Scripting and automation, such as Beyond Compare's script language or a
      headless sync from the CLI.

## Notes

- Quickest wins: wire the Stop button and add column sorting plus more filters
  to the folder table.
- Biggest differentiators to plan: three-way merge, folder sync, and the SFTP
  service.
- `todo/plan.md` is referenced as the source of truth but does not exist yet;
  once it does, promote the items above into it.
