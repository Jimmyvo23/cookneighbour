# T-078 — Reviewer

APPROVE (T-078, PR #149, head ed857c6). Posted as a PR comment on #149.

Scope: test-only. 2 test files + 2 handoffs; no app, mock or migration code changed. Item 1 (On hold marker on lists) is out of scope per D-76 (moved to T-082). The PR says "Refs #148" (issue stays open), the title says "list marker blocked", and the body and `.team/handoffs/T-078-frontend.md` both say plainly that item 1 is NOT included and why (`BookingSummary` has no `frozen`). Honest; no overreach.

Verified myself (worktree at ed857c6):
- `npx vitest run src/components/booking/FrozenBooking.test.tsx`: 13/13 pass.
- `npm run lint`, `npm run typecheck`: clean. `prettier --check` on the changed files: clean.
- `npm run test:e2e:mock -- e2e-mock/t077-frozen-booking-mock.spec.ts`: 7/7 pass.
- CI `ci` green (run 38981587943). Tester handoff `.team/handoffs/T-078-tester.md` reports a mutation check (frozen gates removed in `PickupSections.tsx`) that turned both new tests red.

Item 2 (unit, `FrozenBooking.test.tsx`): new test pins the chef's uncooked-day hint with a frozen case and a not-frozen control in the same test. Data built by `pastUncooked` (relative to `torontoToday()`), no literals. Good.

Item 3 (mock e2e): control (not frozen: `missed-pickup` visible) plus frozen case (`frozen-notice` visible, then `missed-pickup` count 0). The frozen test waits for the notice before the absence check, so it cannot pass on a half-loaded page. Seed A05 (9105) has its only day at `offset: -4`, cooked, so the pickup deadline is always in the past, relative to today. Date-independent, no clock hook and no `toISOString` "today". Storage block and afterEach check are kept.

Findings (none blocking):
- NIT-1: in the new unit test, the positive check `toContain("Pickups are paused while this booking is on hold.")` reads the whole `pickups` section. When frozen, the intro paragraph has the same sentence (`PICKUPS_PAUSED` in `PickupSections.tsx` lines ~440 and ~465), so that line passes even if the per-day hint is dropped or changed. The pin really comes from `not.toContain("Mark this day as cooked first")` (which the Tester's mutation confirms). Scoping the positive check to the first `pickup-day` element would make it exact. Optional, can ride along with T-082.
- NIT-2: the PR body did not name T-082 / D-76. (Planner added it before merge.)
- INFO: the control e2e only checks that `missed-pickup` is visible, not that pressing it works. Acceptable; other mock specs cover it.

Security, privacy, accessibility, mocks: no impact (tests only; made-up seed data; no secrets).
