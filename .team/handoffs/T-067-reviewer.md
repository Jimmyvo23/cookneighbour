# Handoff: T-067 Saved allergy profile, backend part (reviewer)

From: reviewer  To: planner
Verdict: **APPROVE** on head 3a251f6. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/120#issuecomment-6182615220

## Checked
- lint, typecheck clean; vitest 72 files, 1856 pass, 3 expected fail; CI green (run 38666304184) incl. `tests/rls/privacy.test.ts` (20), `tests/api/saved-intake-tester.test.ts` (8), `tests/api/saved-intake.test.ts` (4).
- Migration `20261014200000_saved_intake.sql`: two nullable columns on `profile_private`, `jsonb_typeof = 'object'` check, no backfill, no policy/grant change, no function rewrites.
- `/api/me/intake`: `requireCustomer()` on all handlers (role from `profiles`); user id from session; `no-store`. Validation shared (`parseSavedIntake` wraps `parseIntake`). `savedAt` ISO `Z` on GET and PUT.
- Privacy: not in `/api/me` or other `profile_private` reads; never shown to chefs; DELETE clears it. Booking create neither reads nor writes it. Contract 4A and data-model match.

## Findings (none blocking)
- **LOW** `src/app/api/me/intake/route.ts:60`: DELETE runs `requireJson` before `requireCustomer` (anon wrong content type -> 400 not 401); convention is session (401), role (403), content type (400). Swap in the frontend-part PR or a follow-up.
- **NIT** contract 4A does not state the order of checks.
- **NIT** `docs/api-contract.md:3` status line reads oddly.
- **NIT** `src/lib/domain/savedIntake.ts:26`: an older saved form with a dropped allergen value silently reads as nothing saved; add a comment.

## Admin read access
Acceptable for prototype (admin already reads booking intake copies via `intake_forms_select_admin` and phone/address via the same policy). Allergy/dietary notes can reveal health or religion: record an optional open-risk question for a real launch.

## After merge
Hosted `npx supabase db push --linked` needed (ask Jimmy).
