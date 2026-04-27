# Shell Integration — Plan

> Outcome-focused plan for OS-level "compare from the file manager"
> integration, equivalent to Beyond Compare's shell extension
> ([reference](https://www.scootersoftware.com/v5help/bcshellex.html)).
>
> Read [`todo/README.md`](./README.md) for the workflow rules. Only tick
> a checkbox once the change is merged to `main`. Items describe
> **outcomes**, not implementation — rationale belongs in `docs/`.

The headline user stories:

1. Select two files (or folders) in Finder / Explorer / Files, right-click,
   and pick **"Compare with AwapiCompare"** to open them in a new tab.
2. Right-click one item, pick **"Select Left Side for Compare"**, then
   right-click another item later and pick **"Compare to <left>"** —
   even across windows or sessions.
3. Drag two items onto the AwapiCompare dock/taskbar icon to compare them.
4. Power users can invoke the same flow from the terminal / scripts.

---

## Phase A — Cross-platform foundations

Pre-work shared by every platform, so the OS integrations are thin shims.

- [ ] **A1** — Launching the app with one or two file/folder paths opens
      a new compare tab for them, regardless of whether another instance
      is already running (single-instance handoff).
- [ ] **A2** — A persistent, per-user "left side pick" exists: choosing
      one item now and another later produces a compare, even after the
      app has been closed in between. Pick expires after a configurable
      window and is cleared on explicit "Clear Pending Pick".
- [ ] **A3** — Drag-and-drop of one or two items onto the running app
      window or its dock/taskbar icon opens a compare tab.
- [ ] **A4** — Mixed selections (file + folder, or unsupported types)
      produce a clear, non-blocking error toast instead of a silent
      failure or a broken tab.
- [ ] **A5** — User-facing docs describe every entry point (Finder,
      Explorer, Files, CLI, drag-and-drop) and the "Select Left / Compare
      to" workflow in one place.

---

## Phase B — macOS (Finder)

Ship the easy, declarative integration first; add the richer extension later.

- [ ] **B1** — Finder's **Services** menu offers "Compare with
      AwapiCompare" when 2 or 3 files/folders are selected, and
      "Open in AwapiCompare" for a single item.
- [ ] **B2** — Finder's **Services** menu offers "Select Left Side for
      Compare" and "Compare to <left>" entries that drive the Phase A2
      pending-pick state.
- [ ] **B3** — A built-in **Quick Action / Automator workflow** is
      installable from the app's Preferences with one click, for users
      who want a top-level right-click entry instead of the Services
      submenu.
- [ ] **B4** — A **Finder Sync extension** ships inside the signed,
      notarized app bundle and adds a top-level **AwapiCompare**
      submenu in Finder's context menu with the same verbs as B1 + B2,
      matching Beyond Compare's UX.
- [ ] **B5** — The Finder Sync extension respects the app's "shell
      integration enabled" preference and disappears from Finder when
      the user turns it off, without requiring a logout.
- [ ] **B6** — Uninstalling or moving the app cleanly removes the
      Services entries and the Finder Sync extension on next launch /
      logout, with no stale menu items.

---

## Phase C — Windows (Explorer)

The classic shell-extension route, matching Beyond Compare's behaviour
on Windows 10 and Windows 11.

- [ ] **C1** — Right-clicking 2 or 3 items in Explorer shows a
      **"Compare with AwapiCompare"** entry that opens them in a new
      compare tab. Works for files **and** folders.
- [ ] **C2** — Right-clicking one item shows **"Select Left Side for
      Compare"**; right-clicking a second item later shows
      **"Compare to <left>"**, driven by Phase A2 state. The pending
      pick is visible (and clearable) from the app itself.
- [ ] **C3** — On Windows 11, the entries appear directly in the modern
      context menu (not only behind "Show more options"), grouped under
      an **AwapiCompare** submenu when more than two verbs are visible.
- [ ] **C4** — The shell extension is installed and registered by the
      regular AwapiCompare installer (per-user by default, per-machine
      when the installer is run elevated) and is fully removed by the
      uninstaller, including registry entries and the extension binary.
- [ ] **C5** — The shell extension is code-signed with the same
      identity as the main app, loads in 64-bit Explorer without
      blocking other extensions, and never crashes Explorer when
      AwapiCompare itself is missing or out of date.
- [ ] **C6** — A **Preferences → Shell Integration** screen lets the
      user enable/disable the Explorer entries without reinstalling,
      and shows the current registration state (per-user / per-machine
      / disabled).

---

## Phase D — Linux file managers

Best-effort coverage of the major desktops; ship as the app gains a
Linux installer.

- [ ] **D1** — A **Nautilus** (GNOME Files) extension adds "Compare
      with AwapiCompare" and "Select Left / Compare to" entries when
      one to three items are selected.
- [ ] **D2** — Equivalent integrations exist for **Dolphin** (KDE) and
      **Thunar** (XFCE), or — where extensions aren't practical —
      installable **`.desktop` actions** provide the same verbs.
- [ ] **D3** — The Linux package (deb / rpm / AppImage) installs and
      removes the file-manager integrations cleanly, with no manual
      steps required from the user.

---

## Phase E — Polish & parity

Round out the feature so it feels first-class on every OS.

- [ ] **E1** — Telemetry-free usage counters (local only) let the user
      see how often each entry point is used, to validate the feature
      is discoverable.
- [ ] **E2** — End-to-end tests cover at least one happy path per OS:
      "select two files in the file manager → AwapiCompare opens with
      both sides populated".
- [ ] **E3** — Release notes and the marketing site call out shell
      integration as a headline feature, with screenshots per OS.
- [ ] **E4** — A short troubleshooting guide covers the common failure
      modes (entries missing after install, antivirus blocking the DLL,
      Finder Sync disabled in System Settings, etc.).
