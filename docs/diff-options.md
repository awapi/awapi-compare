# Diff Options

`DiffOptions` is the **per-session match policy**. It controls (a) how
entries on the two sides are paired up, (b) which file attributes count
as "the same", and (c) how file content is compared. It is the engine
layer underneath the [include/exclude rules](./rules-syntax.md) and is
edited from the **Match** toolbar button (the tabbed *Diff options*
dialog).

The shape lives in [`src/shared/src/types.ts`](../src/shared/src/types.ts)
and the defaults / helpers in
[`src/shared/src/diffOptions.ts`](../src/shared/src/diffOptions.ts).

## Shape

```ts
interface DiffOptions {
  attributes: {
    size: boolean;            // compare byte size
    mtime: {
      enabled: boolean;       // compare modification time at all
      toleranceSeconds: number; // equality window (default 2)
      ignoreDstShift: boolean;  // accept ±1 h skew
      ignoreTimezone: boolean;  // fold whole-hour offsets to zero
    };
  };
  pairing: {
    caseSensitive: boolean;     // false → 'Foo.txt' ↔ 'foo.txt'
    ignoreExtension: boolean;   // true  → 'foo.ts' ↔ 'foo.js'
    unicodeNormalize: boolean;  // true  → NFC-fold filenames before pairing
  };
  content: {
    mode: 'off' | 'checksum' | 'binary' | 'rules';
    skipWhenAttributesMatch: boolean;
    overrideAttributesResult: boolean;
  };
}
```

## Defaults

`DEFAULT_DIFF_OPTIONS` is conservative:

| Group       | Field                       | Default      |
| ----------- | --------------------------- | ------------ |
| attributes  | `size`                      | `true`       |
|             | `mtime.enabled`             | `true`       |
|             | `mtime.toleranceSeconds`    | `2`          |
|             | `mtime.ignoreDstShift`      | `false`      |
|             | `mtime.ignoreTimezone`      | `false`      |
| pairing     | `caseSensitive`             | `true`       |
|             | `ignoreExtension`           | `false`      |
|             | `unicodeNormalize`          | `true`       |
| content     | `mode`                      | `'checksum'` |
|             | `skipWhenAttributesMatch`   | `true`       |
|             | `overrideAttributesResult`  | `true`       |

`mergeDiffOptions(partial)` deep-merges a partial override on top of the
defaults. `cloneDiffOptions(o)` returns a fully-independent mutable
copy. `diffOptionsFromMode(mode)` derives a `DiffOptions` from the
coarse `CompareMode` preset (`'quick'` → `content.mode: 'off'`,
`'thorough'` → `'checksum'`, `'binary'` → `'binary'`).

## Pairing semantics

Two entries (one per side) are paired iff their *pairing keys* are
equal. The key is computed by `pairingKey(relPath, options.pairing)`:

1. Optional Unicode NFC normalisation.
2. Optional case folding (the entire path is lower-cased).
3. Optional extension stripping — only the trailing `.ext` of the
   *basename* is removed; directory components keep their dots.
   Dotfiles like `.env` are left intact.

```ts
pairingKey('src/Foo.TS', { caseSensitive: false, ignoreExtension: true, unicodeNormalize: true })
// → 'src/foo'
pairingKey('archive.tar.gz', { caseSensitive: true, ignoreExtension: true, unicodeNormalize: true })
// → 'archive.tar'
```

## Attribute equality

`mtimeDeltaWithinTolerance(left, right, options.attributes.mtime)`
returns `true` iff:

- `mtime.enabled` is `false`, OR
- `|delta|` (after optional whole-hour folding) is within
  `toleranceSeconds`, OR
- `ignoreDstShift` is set and `|delta|` is within `toleranceSeconds` of
  exactly 1 h.

`size` is a straight `===` check; if `attributes.size === false`, sizes
are not consulted at all.

## Classifier flow (`classifyPair`)

Given both sides exist, both are files, and the type matches:

1. Compute `attributesIdentical = sizeEqual && mtimeEqual` from the
   attribute settings above.
2. **`content.mode === 'off'`** — return `'identical'` if attributes
   match; otherwise the mtime tie-break (`'different'`,
   `'newer-left'`, or `'newer-right'`).
3. **Content modes** (`'checksum'`, `'binary'`, `'rules'`):
   - If `skipWhenAttributesMatch` and attributes already match →
     `'identical'` (no content read).
   - If sizes differ → tie-break (no content read; size proves
     inequality).
   - Otherwise hashes are required. Equal hash → `'identical'`.
   - Different hash and `overrideAttributesResult === false` and
     attributes already say identical → `'identical'` (attribute
     verdict wins). Otherwise → tie-break.

## Wire transport

`DiffOptions` rides on `FsScanRequest.diffOptions` (optional). When
omitted, the main process derives defaults from `FsScanRequest.mode`
via `diffOptionsFromMode`. The renderer's per-tab session store holds
the editable copy (`SessionState.diffOptions`); changes flush to the
main process on the next scan.

`Session.diffOptions` is also persisted on `SessionSnapshot` so saved
sessions remember their match policy.

## UI

The dialog is rendered by
[`DiffOptionsDialog.tsx`](../src/desktop/src/renderer/components/DiffOptionsDialog.tsx)
and is opened from the toolbar's **Match** button (⚖). Tabs:

- **Match** — size and mtime (tolerance, DST, timezone).
- **Pairing** — case, extension, Unicode normalisation.
- **Content** — mode and skip/override toggles.
- **Filters** — link to the Rules editor (per-session scope).
- **Misc** — restore all options to defaults.

The dialog edits a draft and only commits on **Save**.
