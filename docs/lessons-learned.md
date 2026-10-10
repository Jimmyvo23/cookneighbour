# Lessons learned

Mistakes we already paid for once, and the habit that prevents each one. Every agent reads this before starting a task. Add to it when a new mistake costs time.

Last updated: 2026-10-08 (after WO-1, WO-2, WO-3 and the D-17 status rule).

## 1. Office status (Planner and every agent)

The office only shows what agents report. Nothing updates on its own.

- **Right after every `team-status decide`**, the Planner sets its own status to `working`. *(The office said "waiting for Jimmy's approval" long after Jimmy had approved.)*
- **After every handoff, merge or interruption**, the Planner sets each agent that is not running to `idle` or `done`. *(Agents stopped by the usage limit kept showing "working".)*
- Agents write the handoff first, then set `--status done` before the final report and stopping. *(Never show done without a handoff on disk.)*
- When the session pauses, the Planner sets itself to `idle` with a `--next` that says exactly where to resume.
- **Before starting any agent** (including a resumed one for a new round), the Planner records that agent's status itself: `team-status status --agent <id> --status working --task <T-xxx> --progress 0`. Jimmy's rule (D-17). *(The office showed Frontend "working" with no task at 0% and Tester "done" with no task.)*
- Every agent prompt tells the agent to report `--task <T-xxx> --progress <n>` on every status call, at each milestone: 25, 50, 75, and 100 with `--status done`. *(Without it the office cannot show real progress.)*
- **Run `team-status` with the project root set** when working in a worktree: `CLAUDE_PROJECT_DIR="<main folder>" node .team/bin/team-status.mjs ...`. Without it the report goes to the worktree's own `.team/events.jsonl` and the office never shows it. *(The T-037 builder's and a reviewer's progress reports were lost this way.)*

## 2. Agent reports

- An agent's final message is a **full report**: what changed, PR number, test results, what's next. Never "placeholder" or an empty hand-back. *(Two agents returned empty reports.)*
- The Planner never trusts a report alone. It checks the handoff file, `gh pr view <n>` and the CI result itself.

## 3. Bugs reviews keep finding. Builders check these before handing off

Each of these reached the Tester or Reviewer at least once, except the rows marked "(preventive)". Validate free text on the server too, not only in the form (T-033/T-059). Catching them in the builder's own check saves a full fix round.

| Bug class | Example we had | Check |
|---|---|---|
| Pointing at someone else's data | A chef could link another chef's documents | Every ID from the client is checked against the signed-in user's own rows |
| Check-then-act race | The admin could verify a file that was swapped after review; approval didn't require both checks to still be `verified` | Do the check and the write in **one** conditional update (`... where status = 'verified'`) |
| Overwrite in place | A kitchen photo could be replaced at the same path | Storage paths are insert-only and use a new name per upload |
| Privacy leak through derived data | Display name built from the email | Never derive public fields from private ones |
| False promises in the UI | A hint said data was private when it wasn't | UI text about privacy or mocks must match what the code really does |
| Accessibility after errors | Focus was lost after a server error | After any error, move focus to the error message |
| Unsafe text input | Control characters and lone surrogates were accepted | Validate text fields with the shared helpers |
| Missing MOCK label | (preventive) | Every mocked check status shows a MOCK badge |
| Pages with private data | (preventive) | Guard on the server, not only in the client |

## 4. Git and GitHub

- **Before merging:** `gh pr update-branch <n>`, wait for `ci` to go green, then merge. *(Branch protection refuses PRs that are behind `main`.)*
- **No loose files in the main folder.** Builders commit their handoff on the task branch; the Planner commits Tester and Reviewer handoffs (D-7). Never leave handoffs uncommitted in the main folder across branch switches. *(Uncommitted handoffs clashed with branch switches.)*
- Switching branches with local changes: use `git stash`, never copy + `rm`. *(A tracked handoff file was deleted by accident.)*
- When the main folder is busy on another branch, the agent works in a git worktree. `team-status` is still run from the main project folder.
- Never push to `main`, never force-push. Never loosen branch protection to go faster.

## 5. Supabase and secrets

- **After merging a PR that adds a migration**, run `npx supabase db push` so hosted matches. Write it in the task's PLAN.md notes.
- Never read, print or check the prefix of any key in `.env.local`. To check keys, run `npm run db:check` or ask Jimmy. *(A safety check blocked an attempt to read key prefixes.)*
- A 401 from Supabase usually means a wrongly copied key: Jimmy copies it again and we run `npm run db:check`.
- Loading seed data into hosted needs Jimmy's `SEED_ADMIN_PASSWORD` and his OK.

## 6. Sessions and usage

- Claude can't see the usage meter. **Checkpoint after every task:** PLAN.md notes, task state with `team-status`, and the resume note.
- If the usage limit stops agents mid-task, nothing is lost: resume each one with SendMessage after the reset.
- **Start a fresh session for each Work Order.** Long sessions cost more for every message. Everything needed to resume lives in PLAN.md, `docs/work-orders/`, `.team/handoffs/` and this file.
- Jimmy says "stop" to pause. Don't start a new task if he says the limit is close.

## 7. What speeds things up without cutting quality

- Builders run the section 3 checklist and the full local test suite before handing off, so the Tester's first round usually passes.
- Hand over handoff files instead of re-explaining in chat.
- Batch small review fixes into one round instead of one push per fix.
- Keep Builder → Tester → Reviewer on every task. Skipping steps has never saved time here; it only moves bugs later.
