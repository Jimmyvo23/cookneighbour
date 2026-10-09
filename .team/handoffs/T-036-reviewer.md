# T-036 Reviewer handoff

**Task:** T-036 Admin chef-queue UI (PR #81)
**Verdict:** APPROVE on head b86e60d (review comment 6072989604; CI run 37873576684 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## What was checked
- Server guard: `src/app/admin/layout.tsx` runs `requireAdminPage()` before rendering and fails closed; raw HTML tested for visitor, customer and chef, with an admin positive control.
- No `dangerouslySetInnerHTML`, no server Supabase clients in admin components; signed links never logged or stored. Email and kitchen address only on the admin review page.
- MOCK badge on every check status (ID, certificate, kitchen, police) and on the controls; no claim of real verification.
- Contract match: exact reviewed paths and address (`null` when none), `Content-Type` on every write, 409 handling and missing-list wording. Mock adapter matches the real routes' checks and order.
- Accessibility: labels, list semantics, focus to errors, 375 px, long-text wrapping. 30-second link retry cannot stack; queue filter ref fix correct. Root-layout Suspense around `AccountBar` and the corrected `src/app/chef/layout.tsx` comment are sound.
- Scope: 31 files, no backend, contract, migration or `src/lib/domain/*` edits.

## Findings (none blocking)
1. LOW `src/components/admin/ChefReviewView.tsx:64,79,105-110,123-133`: `reload()` returns `false` for both a real failure and a superseded request, so a "links may have expired" notice can show on fresh links (tester round-2 finding 7) and a second click on "Reload application and file links" briefly shows "Could not reload" (`aria-disabled` at :182 does not block the click). Fix: return `ok | failed | superseded`, ignore `superseded`, and return early from `manualReload` while refreshing.
2. LOW (UI honesty) `src/components/admin/ChefQueueView.tsx:255`: "Applied {createdAt}" is the sign-up time, not the submit time. Say "Signed up" until a `submittedAt` exists.
3. INFO: Q-16 defaults not flagged in the UI; waits for Jimmy.
4. INFO: build-log `cookies()` line from the T-035 GET list handler; harmless; Backend could add `await connection()`.
5. INFO `ChefQueueView.tsx:68-71`: re-showing the queue reloads only the first page (intended).

## Follow-ups
- Next frontend task: findings 1 and 2. Next backend task: finding 4.
- WO-4: chef's-home search and booking require `approved` AND `chef_home_enabled`; decide what happens to future bookings when an approved chef is rejected.
- After Q-16: flag an approved chef with a `failed` MOCK check; apply the kitchen-review status rule in UI and API.
- WO-5: extend `AdminNav` to bookings, reports and free-trial blocks; backend `submittedAt` would make finding 2 exact.
- T-054 README: mock admin login (email starting with `admin`) works only in mock mode; hosted demo admin needs Jimmy's `SEED_ADMIN_PASSWORD`.
