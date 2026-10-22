# Lessons learned

Mistakes we already paid for once, and the habit that prevents each one. Every agent reads this before starting a task. Add to it when a new mistake costs time.

Last updated: 2026-10-22 (T-099, T-101).

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

- **Reviewers never `git checkout` in the main folder, and Testers never `supabase db reset` the shared local stack while other agents run.** Use `git show`/`git diff`, the task worktree or `git archive`. *(2026-10-22: a Reviewer left the main folder on a detached commit; a Tester's reset wiped the stack other agents used.)*
- **Prove a "cannot do X" test with a bite test:** remove the protection locally and watch the test fail. *(T-105: the framing test passed with both frame headers removed, because Chromium blocked the loopback frame for another reason.)*
- **A Planner merge that changes code gets a Reviewer glance and a doc grep.** *(T-102: the T-101 merge replaced a message the docs still quoted.)*

- **Check a Tester's CI claim in the log.** T-099's Tester reported a Docker rate limit; the log had none, and the real failure was an unrelated flaky e2e (T-106).

- An agent's final message is a **full report**: what changed, PR number, test results, what's next. Never "placeholder" or an empty hand-back. *(Two agents returned empty reports.)*
- The Planner never trusts a report alone. It checks the handoff file, `gh pr view <n>` and the CI result itself.
- **The Reviewer agent is read-only (no Write tool).** Do not ask it to write a handoff file; it puts the full review in its final message and its PR comment, and the Planner copies it into the notes PR (T-087).

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
| Mock mode reaching hosted services | Mock pages built photo URLs from `NEXT_PUBLIC_SUPABASE_URL` and asked hosted storage for made-up files (T-040) | In mock mode build no storage URLs; every mock Playwright spec that renders photos blocks `**/storage/v1/object/public/**` (older specs were backfilled in T-062) |
| Paths from an API used in URLs | A photo path with `..` could leave the bucket folder in the browser (T-041) | Use the shared `isSafeStoragePath` (`src/lib/chef/dishes.ts`): it rejects dot and empty segments, a leading slash, backslashes and control characters |
| Test data that pollutes shared searches | Many booking-test chefs with cuisine "Vietnamese" pushed `search.test.ts` chefs off the first page of `cuisine=vietnamese` (T-042) | API tests share one database: give every test chef a unique cuisine tag by default and filter on it |
| A rule change reaching old tests | D-27 (no same-day booking) changed the search date window, which broke mock, e2e and Tester tests that assumed "today" (T-042) | Before changing a shared rule, grep the unit, API, mock and Playwright tests for the old value and update them in the same PR |
| Map markers without a name | (found by the builder, T-040) Leaflet `divIcon` pins had no accessible name and Enter did nothing | Set `aria-label` and a key handler on custom markers |
| Hidden copies of a page share ids | (found by the builder, T-043) After in-app navigation an earlier page stays mounted but hidden, so two copies of the booking form had the same `id`s: a label or an error link could point at the hidden copy | Give every id on a page a per-instance prefix (`useId`, see `FieldScopeProvider` in `src/components/booking/parts.tsx`); test with a client-side `window.next.router.push` to a second form and click a label |
| Remounted state that outlives the action | (found by the builder, T-043) A sent booking's review stayed in state; coming back re-ran the chef load, the dates were now taken, the review crashed on an empty date | After a successful send close the form (a "sent" state with a link), and make render code tolerate a cleared field |
| Focus decided by two components | (found by the builder, T-043) A child and its parent both moved focus after an error, and React StrictMode re-ran only the child, so the summary stole focus from the alert | One owner moves focus per attempt (the form passes refs down), alert first, else the error summary |
| Tests fed data the API never sends | (T-043) A unit test passed non-zero per-day labour with the free trial on, so a caption that said labour was "before the free booking" passed while the API really sends $0.00 | Build test data with the real domain function (`estimateBooking`) or copy a real API response, never hand-made values that cannot happen |
| UTC date used as "today" | (T-070) `new Date().toISOString().slice(0, 10)` is the UTC date, which is tomorrow in Toronto from 19:00/20:00 to midnight, so the test fails only in the evening. | Use `dayPlus(0)` (`e2e-mock/helpers.ts`) or `torontoToday()`. Adding days to an existing YYYY-MM-DD string at noon UTC is fine. |
| Exact lists on a shared date | (T-066) A new RLS test booked a chef on `far(5)`, and another file running in parallel on the same database expects exactly one chef on that date | A test that asserts an exact list on a date must use a date no other test file uses |
| Fixed calendar dates inside the public window | (T-079) `booking-changes.test.ts` books 3 chefs on the literal date 2026-10-31 = Toronto today + 15 on 2026-10-16, so `chefs_booked_on(far(5))` returned 4 chefs, not 1. Any literal date or random offset can land on a relative date some day. | Assert on a public list (`chefs_booked_on`, search) only with this test's own ids (`toContain` / `not.toContain` after checking `error` is null), never `toEqual([...])`. |
| Short word regex over random values | (T-079) `not.toMatch(/markup\|fee/i)` on a response flaked about 1% of runs: a hex UUID or a signed-URL token contained "fee" by chance. | Do not regex a response that holds random ids or tokens for a short word; drop those fields first, then match the plain word. Do not use `\b`: JSON keys are camelCase (`platformFeeCents`), so a whole-word match misses them. |
| Fake clock jumps past the API timeout | (T-075) With the 20 s `apiFetch` timeout, a large Playwright `clock.fastForward` can fire the timeout before the mock adapter answers, so a retry lands one step later | In mock e2e, move the fake clock in steps shorter than `API_TIMEOUT_MS` while a call is in flight, or allow one extra retry step |
| Updating several rows one at a time under a unique rule | (found in CI, T-086) `shiftDays` moved a booking's days with no `order by`; when day 2 was updated first it landed on day 1's date and hit `booking_days_one_per_chef_date` (23505), failing CI at random | When a helper moves several rows that share a unique key, update them in a safe order (earliest first when moving earlier, latest first when moving later) (one `UPDATE` does not help: a non-deferrable unique index is checked row by row) |
| A test helper that silently never runs | (T-047) The `testkit.tsx` fallback checked `!init?.method`, but `apiFetch` always sends `method: "GET"`, so it never ran; fixing it made the chat render in older page tests and exposed a too-broad selector and an always-present empty `role="alert"` | When adding a fallback to a shared test helper, add a test that proves the fallback actually runs |
| Random ids inside user text in tests | `tests/api/t048-tester.test.ts` put `randomUUID()` hex into a review comment; a long digit run tripped the phone rule, so `main` failed at random (T-048) | Use a digit-free marker in test text (map digits to letters) |
| Test fakes that are kinder than the real library | (T-050) The chat unit tests used a fake Realtime client that made a new channel on every call, but the real `@supabase/ssr` browser client is a singleton and `channel(topic)` returns the existing channel; an overlapping remount closed the topic the new mount used, and only the real-stack e2e saw that live messages never arrived (B-1, T-094) | When faking a library, copy the behaviours that matter (shared instances, reuse by key) from its source, and keep at least one real-stack test for live features |
| Extensionless import in a file the seed script loads | (found in CI, T-060) `address.ts` imported `./text-fold`; the seed script runs plain Node, which needs `./text-fold.ts`, so the `supabase` job failed with ERR_MODULE_NOT_FOUND after 16 minutes | Files under `src/lib/domain` that `hash.ts`/the seed script reach import siblings with the `.ts` extension; after adding an import there, run `node --experimental-strip-types -e "import('./src/lib/domain/hash.ts')"` |

## 4. Git and GitHub

- **Before merging:** `gh pr update-branch <n>`, wait for `ci` to go green, then merge. *(Branch protection refuses PRs that are behind `main`.)*
- **No loose files in the main folder.** Builders commit their handoff on the task branch; the Planner commits Tester and Reviewer handoffs (D-7). Never leave handoffs uncommitted in the main folder across branch switches. *(Uncommitted handoffs clashed with branch switches.)*
- **Work Orders go straight into the task worktree.** Create the file in the task worktree (or move it there with plain `mv`); do not leave a copy in the main folder. *(T-046: an uncommitted WO-5a copy blocked `git pull` after the merge.)*
- Switching branches with local changes: use `git stash`, never copy + `rm`. *(A tracked handoff file was deleted by accident.)*
- When the main folder is busy on another branch, the agent works in a git worktree. `team-status` is still run from the main project folder.
- Never push to `main`, never force-push. Never loosen branch protection to go faster.
- **Installers that write `.claude/settings.local.json` write to the checkout that runs them.** In a worktree the hook lands in the worktree and the session (which loads the main folder's settings) never sees it. Have the builder put the block in its handoff; the Planner places it in the main folder after merge and Jimmy's OK. *(T-068 Impeccable hook.)*
- **Several agents at once share one GitHub rate limit.** With four agents polling `gh pr checks`, one hit the limit (2026-10-21). Poll about every 60 s. `gh run watch` refreshes every 3 s by default, so pass `--interval 60`.
- On macOS, `sed -i` needs an empty suffix: `sed -i '' 's/a/b/' file`. *(GNU-style `sed -i` failed during T-040.)*
- If `gh pr checks <n> --watch` says "no checks reported" right after a push, or returns at once, use `gh run watch <run id> --exit-status` on the new run instead. *(T-073 round 2; again in T-084.)*

## 5. Supabase and secrets

- **Parallel tasks with migrations need distinct timestamps in the brief.** T-098 and T-101 both used `20261026100000`; T-101 had to rename its file and renumber the contract.
- **After merging a PR that adds a migration**, run `npx supabase db push` so hosted matches. Write it in the task's PLAN.md notes.
- In auto mode the permission check refuses `npx supabase db push` ("production deploy") and a Reviewer agent that approves a PR ("self-approval"). Do not work around it: ask Jimmy to run the push (`npx supabase db push --linked` from the main folder, then check with `npx supabase migration list --linked`) and to choose how the PR gets reviewed. *(T-063: the merge went ahead on Jimmy's chat approval and the review ran after the merge.)*
- Since T-043 the Reviewer agent can start in auto mode, but one GitHub account cannot approve its own PR. The Reviewer posts its verdict as a comment that starts with "APPROVE" or "REQUEST CHANGES". `main` protection requires only `ci`. For T-043 Jimmy approved the merge plan in chat, and the Planner merged on the Reviewer's APPROVE comment plus green CI. Since D-42 (2026-10-13) this is the standing rule inside an approved Work Order; hosted migrations, deploys and anything outside a Work Order still go to Jimmy.
- Never read, print or check the prefix of any key in `.env.local`. To check keys, run `npm run db:check` or ask Jimmy. *(A safety check blocked an attempt to read key prefixes.)*
- A 401 from Supabase usually means a wrongly copied key: Jimmy copies it again and we run `npm run db:check`.
- Loading seed data into hosted needs Jimmy's `SEED_ADMIN_PASSWORD` and his OK.

## 6. Sessions and usage

- Claude can't see the usage meter. **Checkpoint after every task:** PLAN.md notes, task state with `team-status`, and the resume note.
- If the usage limit stops agents mid-task, nothing is lost: resume each one with SendMessage after the reset.
- **Start a fresh session for each Work Order.** Long sessions cost more for every message. Everything needed to resume lives in PLAN.md, `docs/work-orders/`, `.team/handoffs/` and this file.
- Jimmy says "stop" to pause. Don't start a new task if he says the limit is close.
- **Hard pause to save tokens (2026-10-20).** Stop the running agents (TaskStop), then check every worktree with `git status -sb`: no uncommitted changes and not ahead of origin. Restart later with a fresh agent that reads its own commits and the Work Order, and tell it not to redo committed work. If `git status -sb` shows uncommitted work or the branch is ahead of origin, the restarted agent commits and pushes it first.

## 7. What speeds things up without cutting quality

- **No Docker on this Mac, so API and RLS tests run only in CI.** A builder can still check new SQL locally: `npm i @electric-sql/pglite` in a scratch folder (not the project), load the migrations after stubbing `auth`, `storage` and the three roles, and call the functions with plain SQL (T-042 did this for `create_booking` and friends). It catches syntax and logic errors before the 8 minute CI round; it cannot test races or RLS.

- Builders run the section 3 checklist and the full local test suite before handing off, so the Tester's first round usually passes.
- Hand over handoff files instead of re-explaining in chat.
- Batch small review fixes into one round instead of one push per fix.
- Keep Builder → Tester → Reviewer on every task. Skipping steps has never saved time here; it only moves bugs later.
- **A new required field on a shared type (T-082).** If Backend and Frontend each add it in their own PR, each PR fails typecheck alone (one lacks the server query, the other the mock). Build both on one branch, or let one PR own the type change and its first fill in both places.
- **Lock order across database functions (T-063).** When two functions lock a chef row and a booking row, they must take them in the same order (chef first), or an accept and an admin reject can deadlock. Write the order in the migration header.
