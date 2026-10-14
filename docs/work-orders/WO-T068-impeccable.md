# Work Order WO-T068: Impeccable design skill for Frontend

Tasks: T-068 (issue to be created after approval)

## What the check found (2026-10-13, from the official repo and site)

- **Source:** https://impeccable.style and https://github.com/pbakaus/impeccable (author Paul Bakaus, about 81k stars, active: last push 2026-10-13).
- **Licence:** Apache-2.0 (repo `LICENSE`, npm package `impeccable`). One bundled file set is derived from MIT-licensed work (`NOTICE.md`). Both are free to use.
- **Cost:** free. There is no paid tier, account or API key. The detector rules run locally with no LLM. **Nothing costs money, so no stop was needed.**
- **Version:** 4.5.2 (release `skill-v4.5.2`, 2026-10-09; npm `impeccable@4.5.2`).
- **What it is:** 1 skill with 24 `/impeccable` commands (including `init`, `audit`, `polish`, `critique`, `harden`, `typeset`, `layout`) and 59 detector rules for common "AI-looking" UI patterns. It started from Anthropic's `frontend-design` skill.
- **Install for Claude Code at project level** (official "Option 1"): from the repo root, `npx impeccable@4.5.2 install --providers=claude --scope=project`. This writes the skill to `.claude/skills/impeccable/` (committed, so the whole team uses the same version) and makes no change to Jimmy's personal `~/.claude`. The other Claude Code route, `/plugin marketplace add pbakaus/impeccable`, is a per-user plugin install, so it is **not** used.
- **What else it touches** (things to know before approving):
  1. **Engine binary outside the repo.** On first use, the launcher downloads a pinned, self-contained engine binary once into `~/.impeccable/bin/`. It is a cache, not a setting, but it does live in Jimmy's home folder.
  2. **Optional design hook.** If accepted, the installer adds a hook to `.claude/settings.local.json` (gitignored, this Mac only). The hook runs the detector after every UI file edit, and it runs even when a tool call is denied, so it can download the engine. **Recommendation: skip the hook (`--no-hooks`) for the trial** and run the commands on purpose.
  3. **Telemetry.** When a new design starts, the skill calls impeccable.style to deal "visual worlds". It sends anonymous data (a random key, the catalogue id, client version) and never project files, code or names. The call itself always happens; recording can be turned off for the whole project with `"telemetry": false` in `.impeccable/config.json`. **Recommendation: turn it off**, to keep the rule of sending as little as possible.
  4. **New project files.** `/impeccable init` writes `PRODUCT.md` (and later `DESIGN.md`) at the repo root, and working files go under `.impeccable/`. The official `.gitignore` block keeps screenshots, caches and per-developer config out of git.

## Plan per agent

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-068 install and wiring | On branch `feature/T-068-impeccable`: run `npx impeccable@4.5.2 install --providers=claude --scope=project --no-hooks`; add the official `.gitignore` block; create `.impeccable/config.json` with `"telemetry": false`; write `PRODUCT.md` in the format `/impeccable init` uses, from CLAUDE.md §2–4 only (no invented facts). Update `.claude/agents/frontend.md`: Impeccable is the design skill to follow (read `.claude/skills/impeccable/SKILL.md`, run its launcher for `detect`), with `frontend-design` kept only as background and Impeccable winning on any conflict. Record command and version in PLAN.md. Open the PR. | S | The subagent has no Skill tool, so it uses the skill by reading its files and running the launcher; check this works |
| tester | T-068 checks | Confirm lint, unit, mock e2e and CI still pass; `git status` shows no screenshots or caches; nothing in `~/.claude` changed; `.impeccable/config.json` has telemetry off; no hook in any settings file; run the detector once on two existing pages (search and booking) and attach the findings as the trial baseline. | S | Detector findings may be noisy; report, do not fix |
| reviewer | T-068 review | Review the PR: licence and NOTICE kept, no secrets, no personal settings touched, `frontend.md` wording gives one clear rule (Impeccable first), `PRODUCT.md` has no invented requirements, `.gitignore` is correct. | S | Low |

The Planner also adds a proposed step to the WO-6 board: "Run `/impeccable audit` then `/impeccable polish` once across all pages before the mentor demo" (as part of T-052 or a new row). PLAN.md gets decision D-43 once Jimmy approves. A lessons-learned line is added only if setup goes wrong.

**Trial:** the next UI task (T-045, after T-044) uses Impeccable. After it, the Planner reports to Jimmy whether the result looked better, comparing it with the baseline findings from the Tester.

## Recommendation

Approve all three, with `--no-hooks` and telemetry off. Both are easy to switch on later. Total effort S.

## Left out

- The automatic design hook (can be turned on later with one command after the trial).
- Running `audit` and `polish` across the app now: that is the WO-6 step.
- Fixing anything the detector finds on existing pages: the baseline is only reported.
- The browser extension, live mode and other tools' folders (Cursor, Codex and so on).

## Decision

Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each answer with `team-status decide`, ids `WO-T068-frontend`, `WO-T068-tester`, `WO-T068-reviewer`.
