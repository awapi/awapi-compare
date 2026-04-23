# Rules Syntax

AwapiCompare uses [picomatch](https://github.com/micromatch/picomatch)
glob syntax for include/exclude rules. Rules filter the entries that
appear in the diff after a folder scan.

## Rule shape

Every rule has:

| Field     | Type                          | Meaning                                                              |
| --------- | ----------------------------- | -------------------------------------------------------------------- |
| `id`      | string                        | Stable identifier (UUID).                                            |
| `kind`    | `'include'` \| `'exclude'`    | Whether matching entries are kept or dropped.                        |
| `pattern` | string                        | Picomatch glob (see below).                                          |
| `target`  | `'name'` \| `'path'` (default `'path'`) | Whether the glob matches the basename or the full relative path. |
| `size`    | `{ gt?: number; lt?: number }` | Optional byte-size predicate. Both bounds are exclusive.            |
| `mtime`   | `{ after?: number; before?: number }` | Optional modification-time predicate (epoch ms, exclusive). |
| `enabled` | boolean                       | Disabled rules are ignored entirely.                                 |

A rule matches an entry when **all** of the following hold:

1. Its `pattern` matches the chosen `target` string.
2. Its `size` predicate (if any) matches the entry's byte size.
3. Its `mtime` predicate (if any) matches the entry's modification time.

## Wildcards

| Glyph     | Matches                                                            |
| --------- | ------------------------------------------------------------------ |
| `*`       | any sequence of characters **except** `/`.                         |
| `**`      | any sequence of characters **including** `/` (any depth).          |
| `?`       | exactly one character.                                              |
| `[abc]`   | any one character from the set.                                     |
| `!pat`    | negation — matches anything that does **not** match `pat`.         |

Dotfiles match `*` and `**` (the matcher uses `dot: true`).

### Examples

| Pattern                  | Target  | Description                                          |
| ------------------------ | ------- | ---------------------------------------------------- |
| `*.log`                  | `name`  | Any file whose basename ends in `.log`.              |
| `**/*.log`               | `path`  | Same, but matched against the full relative path.    |
| `node_modules/**`        | `path`  | Everything under any top-level `node_modules`.       |
| `src/**/__tests__/**`    | `path`  | Test directories anywhere under `src`.               |
| `!important.log`         | `name`  | Everything except `important.log`.                   |

## Evaluation order

Rules are evaluated **in order**, top to bottom:

1. If the rule set contains at least one enabled `include` rule, the
   filter switches to **whitelist mode**: entries that match no rule are
   excluded by default. Without any include rule the default is to keep
   everything.
2. For every rule whose pattern *and* predicates match the entry, the
   verdict is updated to that rule's `kind`. The **last matching rule
   wins**, so users can express overrides cleanly:

   ```text
   exclude **                       # drop everything…
   include src/**                   # …except sources…
   exclude src/**/__tests__/**      # …but skip the test trees.
   ```

3. Disabled rules are skipped entirely and do not flip the engine into
   whitelist mode.

## Size and mtime predicates

Both predicates are **exclusive** comparisons:

```ts
size:  { gt: 1024 }            // strictly greater than 1 KiB
size:  { gt: 100, lt: 1000 }   // a (100, 1000) byte band
mtime: { before: 1700000000000 } // strictly before this epoch ms
mtime: { after:  1700000000000 } // strictly after  this epoch ms
```

When a rule has predicates but the entry lacks the relevant metadata
(e.g. previewing an arbitrary path string), the predicate is treated as
*not matched* and the rule does not fire.

## Global vs per-session rules

There are two rule sets:

- **Global** — persisted to `<userData>/rules.json` and applied to every
  session. Edited via the toolbar's **Rules** button with scope set to
  *Global*.
- **Per-session** — stored on the {@link Session} object and travel with
  saved sessions. Edited via the same dialog with scope set to *This
  session*.

When a scan runs the renderer concatenates `[...globalRules,
...sessionRules]` before calling `fs.scan`. Because the engine
evaluates in order, session rules can override globals (last-wins).

## Live preview

The rules editor includes a **Preview** pane: enter one path per line in
the textarea on the right and the verdict for each path against the
current draft is shown below. The preview goes through the typed
`rules.test` IPC channel so it uses the exact same matcher the scanner
will use.
