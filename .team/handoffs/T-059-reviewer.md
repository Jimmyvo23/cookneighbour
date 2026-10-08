# Handoff: T-059 Unsafe text in display name and address (Reviewer)
From: reviewer  To: planner (written by the Planner from the Reviewer's report, D-7)
Verdict: **APPROVE** (head 54e42d1). No blockers. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/72#issuecomment-6062579582

## Inputs reviewed
`.team/handoffs/T-059-backend.md` (Rounds 1–2), `.team/handoffs/T-059-tester.md` (PASS), issue #71, `docs/lessons-learned.md` §3, `docs/api-contract.md` §§3–4.

## CI and local checks
- CI `ci` passed on 54e42d1 (run 37795366098): unit 191, RLS 111, API 213, Playwright 7 + 6.
- Local: `npm test` (191), lint, `prettier --check .`, `npm run typecheck` clean.

## Verified sound
- `src/lib/domain/text-safety.ts` has the same body as the old `hasUnsafeText`; `chef-application.ts:14` imports and `:349` re-exports it, so bio, list and kitchen-address callers are unchanged.
- `Fields.text` (`src/lib/api/validate.ts:30-40`) calls `string` first and adds "Remove control or invalid characters." only when there is no earlier error; `Fields.string` (email callers) unchanged.
- Validation before write: signup `route.ts:31-32` (before `signUp`), PATCH /api/me `route.ts:24-25` (before `profiles`/`chefs` writes), PUT /api/me/address `route.ts:17-23` (before prefix lookup, hash, upsert).
- Contract §§3–4 match (message, limits 80/120/80, field keys). Tests cover refusals and must-accept cases and that nothing is stored. Scope: address fields folded in by Planner decision; no creep.

## Findings
1. **Low:** PR title/body and issue #71 said "display name" only. **Done by Planner** before merge.
2. **Info:** the re-export at `chef-application.ts:349` has no caller on this branch; keep while T-033 imports from there, remove later if unused.
3. **Info:** first signup test (`tests/api/auth.test.ts:82-100`) doesn't assert no user was created; the tester's DEL case covers it.

## Tester T2 (bidi / zero-width in public names)
Track as follow-up, not this PR: React escapes output (spoofing only), admin approves chefs before search, and ZWJ must stay allowed for emoji; client and server must change together. **Opened as T-060 (issue #73), Phase 6.**

## Follow-ups
- T-060 (#73): refuse bidi controls, U+200B, U+FEFF, C1 controls in public text; keep ZWJ; add a client/server agreement test (`displayNameProblem` vs `Fields.text`).
- Tester T3: email validation unchanged; bare `tsc --noEmit` needs `next typegen` first (`npm run typecheck` and CI are fine).
