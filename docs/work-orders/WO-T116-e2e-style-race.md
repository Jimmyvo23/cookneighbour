# Work Order WO-T116: e2e-mock addStyleTag navigation race + local t052:82

Task: T-116 (tester builds, like T-113), Issue #225. Branch `feature/T-116-e2e-style-race`, worktree `../CookNeighbour-wt-T116`. Jimmy 2026-10-23: "Approve (Recommended)". Parallel with T-115 and T-118.

| Agent | Task | Plan | Effort | Risk |
|---|---|---|---|---|
| tester | T-116 | Move specs that call `addStyleTag` right after `goto` to the shared `openPage` init-script approach from T-113 (`e2e-mock/helpers.ts`): `booking-flow-mock.spec.ts:23`, `booking-flow-tester.spec.ts:13`, `chef-detail-tester.spec.ts:175,195`, `chef-detail-mock.spec.ts:22`, `t077-tester-mock.spec.ts:25`, `allergy-profile-mock.spec.ts:26`, `allergy-profile-tester-mock.spec.ts:22`, `search-mock.spec.ts:18`, `search-t040-tester-mock.spec.ts:22` (grep for any others). Keep every assertion and axe rule. Then investigate `e2e-mock/t052-a11y-mock.spec.ts:82` (local-only: `region` on `/bookings`, `document-title` on `/address`): fix if it is a real app or test bug (small app fix allowed), else report it as environment-only with evidence. Repeat runs with `--retries=0`. | M | Only e2e-mock files (plus a small a11y app fix if proven) |
| reviewer | T-116 review | No assertion or axe rule dropped; race really gone. | S | Low |
