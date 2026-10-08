# Handoff: T-059 Reject unsafe text in display name and address (Tester)

From: tester  To: reviewer

Verdict: **PASS** (no blocking findings). Head tested: cf8ef90 plus my test commit.

## What changed (tests only)
- `src/lib/api/validate.test.ts`: verdict table (17 cases) for `Fields.text`, written to match the T-033 client rule.
- `tests/api/auth.test.ts`: new describe "unsafe text: tester additions (T-059)" with 3 API tests (CI only).
- Branch `feature/T-059-display-name-validation`, PR #72.

## How to verify
- Fresh `npm ci`; lint, `npm run typecheck`, `prettier --check .`, build clean on cf8ef90. `npm test` 174 pass on cf8ef90, 191 with my additions.
- CI run 37794418065 on cf8ef90: unit 174, RLS 111, API 210, real-route Playwright 7, mock 6, all green. API and RLS need Supabase (no Docker here), so those are CI evidence; the CI result for my API additions is in the final report.

## Checks
- All three routes use `Fields.text` (`src/app/api/me/route.ts:24`, `src/app/api/auth/signup/route.ts:31`, `src/app/api/me/address/route.ts:17-18`) and validate before any write; `f.done()` throws 422 first, so nothing is stored (PATCH, sign-up before `signUp`, address before the hash and upsert). API tests assert the stored name and address columns stay unchanged.
- Rejected: NUL, other control characters, tab, newline, DEL, lone high and lone low surrogates (unit table plus API cases; I added DEL for sign-up and address, and the chef public copy staying unchanged after a rejected PATCH).
- Accepted: accents, apostrophes, hyphens, emoji surrogate pairs including a ZWJ sequence (unit table and my API cases).
- `hasUnsafeText` moved to `src/lib/domain/text-safety.ts` with an identical body; `chef-application.ts` re-exports it, so all existing callers (bio, lists, kitchen address) are unaffected; the chef-application unit tests pass.
- Contract sections 3 and 4 match the code (messages, limits 80 / 120 / 80).
- Client/server agreement with T-033: the T-033 `displayNameProblem` trims, requires 1 to 80 characters and calls the same `hasUnsafeText`; server `Fields.text` trims, 1 to 80, same function. Same verdict on every case in the table. Not run as one test because T-033 is not merged into this branch; after both merge, a cross-test could import both.

## Findings
- **T1 (Info):** `Fields.string` trims before the check, so `"Mai\n"` is accepted and stored as `"Mai"` (clean). Same on the client. Fine.
- **T2 (Info):** C1 control characters (U+0080 to U+009F) and zero-width / bidi characters are not refused, by design of the shared rule on both sides. Acceptable for the prototype; note for a later hardening pass.
- **T3 (Info, carried by the Planner):** email validation unchanged; `tsc` bare needs `next typegen` first.

## What the next agent needs
Reviewer: nothing blocking. After T-033 and T-059 both merge, consider one shared test importing the client and server rule.
