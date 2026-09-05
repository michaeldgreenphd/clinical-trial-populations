# CLAUDE.md

Read `AGENTS.md` first — it is the source of truth; nothing is repeated here so
the files cannot drift.

## Claude Code specifics

- After opening a pull request, subscribe to its activity
  (`subscribe_pr_activity`) so Codex's review wakes the session, and schedule
  a fallback check-in about an hour out (`send_later`) until the PR is merged
  or closed; re-arm it silently if nothing changed.
- `.claude/settings.json` holds the permission allowlist for the read-only
  commands a contributor runs constantly. Add to it only commands that do not
  write, push or delete.
