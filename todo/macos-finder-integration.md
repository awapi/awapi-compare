# macOS Finder Integration — Implementation Guide

> A self-contained implementation brief for a fresh session.
> Read this file, read `todo/shell-integration.md` for the outcome-level
> plan, then implement top-to-bottom.

---

## Background and prior art

Windows Explorer integration was already implemented (see `todo/shell-integration.md`
Phase C). It works via registry-based context menus:

- `--set-left <path>` → writes `{userData}/pending-left.txt`, quits without a window
- `--compare-pending <path>` → reads pending-left, opens comparison, clears the file
- `--register-shell` / `--unregister-shell` → writes/removes HKCU registry keys via PowerShell

The macOS implementation reuses the same CLI flags and the same pending-left file
(`ShellIntegrationService.getPendingLeft` / `setPendingLeft` / `clearPendingLeft`).
Only the registration mechanism differs.

Key source files to read before starting:

| File | Why |
|------|-----|
| `src/desktop/src/main/cliArgs.ts` | CLI arg parsing — `--set-left`, `--compare-pending` already handled |
| `src/desktop/src/main/services/shellIntegrationService.ts` | Pending-left state + Windows registration |
| `src/desktop/src/main/index.ts` | How `--set-left` / `--compare-pending` are handled at startup |
| `src/shared/src/ipc.ts` | IPC channels — `shell.*` channels already declared |

---

## What to build

### Step 1 — Quick Action (top-level right-click, no signing required)

This is the macOS equivalent of the Windows right-click menu. It places
"Select as Left Side" and "Compare with AwapiCompare" directly in Finder's
right-click menu without needing code signing or notarization.

**How it works:**

A Quick Action is an Automator workflow saved as a `.workflow` bundle.
It lives at `~/Library/Services/<name>.workflow`. Finder picks it up
automatically; no registration step is needed beyond copying the file.

Each workflow runs a shell script:
```sh
# "Select as Left Side" workflow
for f in "$@"; do
  /path/to/AwapiCompare.app/Contents/MacOS/AwapiCompare --set-left "$f"
done
```

```sh
# "Compare with AwapiCompare" workflow  
for f in "$@"; do
  /path/to/AwapiCompare.app/Contents/MacOS/AwapiCompare --compare-pending "$f"
done
```

**Implementation tasks:**

1. Create two Automator workflow bundles as template directories in
   `resources/macos/`:

   ```
   resources/macos/
     AwapiCompare - Select Left Side.workflow/
       Contents/
         Info.plist
         document.wflow
     AwapiCompare - Compare.workflow/
       Contents/
         Info.plist
         document.wflow
   ```

   The `document.wflow` is a plist that defines the workflow. See the
   template structure below.

2. Add `registerQuickActions(appBundlePath: string)` and
   `unregisterQuickActions()` to `ShellIntegrationService`:
   - Copy the `.workflow` bundles from `resources/macos/` to
     `~/Library/Services/`, substituting the actual app bundle path
     into the shell script.
   - For unregister: delete the files from `~/Library/Services/`.

3. Extend `--register-shell` / `--unregister-shell` in `index.ts` to call
   the new methods on macOS (`process.platform === 'darwin'`).

4. Add IPC handler coverage (already declared as `shell.register` /
   `shell.unregister`) — no changes needed there; the service impl handles it.

**Automator workflow plist structure (`document.wflow`):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AMApplicationBuild</key><string>521.1</string>
  <key>AMApplicationVersion</key><string>2.10</string>
  <key>AMDocumentVersion</key><string>2</string>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key><string>List</string>
          <key>Optional</key><true/>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.path</string>
          </array>
        </dict>
        <key>AMActionVersion</key><string>2.0.3</string>
        <key>AMApplication</key>
        <array><string>Automator</string></array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key><dict/>
          <key>shell</key><dict/>
          <key>source</key><dict/>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key><string>List</string>
          <key>Types</key>
          <array><string>com.apple.cocoa.path</string></array>
        </dict>
        <key>ActionBundlePath</key>
        <string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key><string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key>
          <string>for f in "$@"
do
  "APP_BINARY_PLACEHOLDER" --set-left "$f"
done</string>
          <key>shell</key><string>/bin/zsh</string>
          <key>source</key><string>pass-as-arguments</string>
        </dict>
        <key>BundleIdentifier</key>
        <string>com.apple.RunShellScript</string>
        <key>CFBundleVersion</key><string>2.0.3</string>
        <key>CanShowSelectedItemsWhen</key><false/>
        <key>CanShowWhenRun</key><false/>
        <key>Category</key>
        <array><string>AMCategoryUtilities</string></array>
        <key>InputUUID</key><string>__INPUT_UUID__</string>
        <key>Keywords</key>
        <array><string>Shell</string><string>Script</string></array>
        <key>OutputUUID</key><string>__OUTPUT_UUID__</string>
        <key>UUID</key><string>__ACTION_UUID__</string>
        <key>UnlocalizedApplications</key>
        <array><string>Automator</string></array>
        <key>arguments</key><dict/>
        <key>isViewVisible</key><integer>1</integer>
        <key>location</key><string>309.000000:253.000000</string>
        <key>nibPath</key>
        <string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/English.lproj/main.nib</string>
      </dict>
    </dict>
  </array>
  <key>connectors</key><dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>workflowTypeIdentifier</key>
    <string>com.apple.Automator.servicesMenu</string>
  </dict>
</dict>
</plist>
```

`Info.plist` for the workflow bundle:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>AwapiCompare - Select Left Side</string>
      </dict>
      <key>NSMessage</key><string>runWorkflowAsService</string>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.item</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
```

Use `public.item` as the file type to accept both files and folders.
For folders only: use `public.folder`.

---

### Step 2 — Installation UX

The registration needs to be triggered by the user once. Two options (implement
both):

**A) CLI flag (for dev/testing):**
Already works — `--register-shell` calls `shellIntegration.register(exePath)`.
Extend the macOS branch in `ShellIntegrationService.register()` to call
`registerQuickActions()`.

**B) Preferences UI:**
The IPC channels `shell.register`, `shell.unregister`, `shell.status` are
already declared in `src/shared/src/ipc.ts`. Wire a toggle into the
Preferences screen (wherever that lives in the renderer).

---

### Step 3 — `isRegistered()` on macOS

Check whether the `.workflow` files exist in `~/Library/Services/`:

```typescript
if (process.platform === 'darwin') {
  const servicesDir = join(homedir(), 'Library', 'Services');
  const exists = await fsp.access(
    join(servicesDir, 'AwapiCompare - Select Left Side.workflow')
  ).then(() => true).catch(() => false);
  return exists;
}
```

---

## What NOT to do (scope boundary)

- **Do not** implement a Finder Sync extension (Phase B4). That requires
  code signing + notarization and is a separate, larger task.
- **Do not** implement macOS Services menu via `Info.plist` in the app bundle
  (Phase B1). The Quick Action approach (Phase B3) gives the same top-level
  right-click entry with no signing and is easier to install/uninstall at runtime.
- **Do not** touch the Windows registry code — it is complete and tested.

---

## Testing checklist

- [ ] `--register-shell` on macOS copies `.workflow` files to `~/Library/Services/`
- [ ] Right-click a folder in Finder → "AwapiCompare - Select Left Side" appears
- [ ] Right-click a second folder → "AwapiCompare - Compare" appears and opens the app
- [ ] `--unregister-shell` removes the `.workflow` files
- [ ] `shell.status` IPC returns `true` after registration, `false` after removal
- [ ] Unit tests for `registerQuickActions` / `unregisterQuickActions` (mock `fsp`)
- [ ] Unit tests for macOS `isRegistered()` (mock `fsp.access`)
- [ ] All existing tests continue to pass

---

## Files to create / modify

| Action | File |
|--------|------|
| Create | `resources/macos/AwapiCompare - Select Left Side.workflow/Contents/Info.plist` |
| Create | `resources/macos/AwapiCompare - Select Left Side.workflow/Contents/document.wflow` |
| Create | `resources/macos/AwapiCompare - Compare.workflow/Contents/Info.plist` |
| Create | `resources/macos/AwapiCompare - Compare.workflow/Contents/document.wflow` |
| Modify | `src/desktop/src/main/services/shellIntegrationService.ts` — add `registerQuickActions`, `unregisterQuickActions`, extend `register`, `unregister`, `isRegistered` for darwin |
| Modify | `src/desktop/src/main/services/shellIntegrationService.test.ts` — add macOS tests |
