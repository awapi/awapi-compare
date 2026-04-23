# `todo/` — Persistent Project Plan

This folder is the **source of truth** for outstanding work on AwapiCompare.
It is committed to the repo so progress survives across sessions, branches,
contributors, and machines.

## Files

- **`plan.md`** — The canonical, checkbox-tracked task list. Organized by phase.
  Every actionable unit is a `- [ ]` checkbox.
- **`branches/<branch-name>.md`** *(optional)* — In-flight notes for long-lived
  feature branches. Use when you're mid-task and don't want to lose context.
  Delete the file when the branch merges.

## Rules

1. **Read `plan.md` first** at the start of every session to see what's done
   and what's next.
2. **Only tick a checkbox (`- [x]`) when the change is merged to `main`.**
   Work-in-progress belongs in a branch note, not in the main checkbox.
3. **Every PR that completes a task must tick the matching checkbox in the
   same PR.** This is enforced by the PR template and
   `.github/copilot-instructions.md`.
4. **If a task grows, split it** into sub-checkboxes rather than ticking a
   partial item.
5. **If scope changes**, update `plan.md` in a dedicated PR titled
   `plan: <reason>`; don't hide scope changes inside feature PRs.

## Workflow for Copilot / agents

1. Open `todo/plan.md`.
2. Find the next unchecked item whose prerequisites are satisfied.
3. Implement it (with tests, per `.github/copilot-instructions.md`).
4. Tick the box in the same commit/PR.
5. Repeat.
