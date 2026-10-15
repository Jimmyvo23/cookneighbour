# Handoff: T-067 Saved allergy profile (backend part)

From: backend  To: tester

## What changed
- Branch: `feature/T-067-allergy-profile` (from main 8bb6bb6). Pull request: see PR "Part of #119" (frontend part follows).
- Migration `supabase/migrations/20261014200000_saved_intake.sql`: adds `profile_private.saved_intake` (jsonb, object check) and `saved_intake_at`. No new policy or grant: `profile_private` is already owner + admin read, no client writes. Does not touch `sweep_booking_changes`, `change_booking`, `admin_reject_chef` (PR #116). NOT pushed to hosted; the Planner asks Jimmy to run `supabase db push` after merge.
- Contract: `docs/api-contract.md` v1.7, new section 4A. `docs/data-model.md` updated.
- Code: `src/app/api/me/intake/route.ts` (GET, PUT, DELETE, customers only), `src/lib/domain/savedIntake.ts` (+test), `parseIntake` exported from `src/lib/domain/bookingRequest.ts` (now also returns the normalized `form`; booking behaviour unchanged), types `SavedIntake`, `SavedIntakeResponse` in `src/lib/api/types.ts`.
- Tests: `src/lib/domain/savedIntake.test.ts` (unit), `tests/api/saved-intake.test.ts` (API), `tests/rls/privacy.test.ts` (new describe: owner/admin read, other customer/chef/anon none, client update denied).

## How to verify
- Local (done, green): `npm run lint`, `npm run typecheck`, `npx vitest run` (1856 pass).
- API and RLS tests need local Supabase (none on this Mac): they run in CI (`npm run test:api`, `npm run test:rls`).

## Known gaps or risks
- API/RLS tests were not run locally (no Docker); CI is the check. SQL is a plain ALTER TABLE.
- Admin can read the saved form through the existing `profile_private` admin policy (as for phone and address).
- A chef or admin calling the routes gets 403 (customers only); a chef has no booking intake.

## What the next agent needs
Assumptions: (1) saved form is stored structured (not the flattened "None"/"peanuts, ..." text) so the form prefills exactly; (2) customers only; (3) DELETE added for privacy (clear saved data), small; (4) booking create does NOT read or write the profile.
Open questions for Jimmy: none blocking. Optional: should existing customers be asked once to save? (UI choice.)

Frontend carry-ins:
- Routes: `GET /api/me/intake` -> `{ intake: SavedIntake | null, savedAt }`; `PUT /api/me/intake` with the form itself (same fields as booking `intake`: `noAllergies, allergens[], allergyNotes, noDietaryNeeds, dietaryNotes`); `DELETE /api/me/intake` (needs JSON content-type header).
- Prefill: on the booking intake step call GET; if `intake` is not null, fill the five fields from it (picker allergens from `allergens`, tick boxes from the two booleans) and show it as editable. Send the (possibly edited) form as `intake` in `POST /api/bookings` exactly as now; the booking keeps its own copy.
- Save: after a successful create (or from a profile page), if the customer ticked "save to my profile", call `PUT /api/me/intake` with the same object. Handle its failure without failing the booking.
- Conflict check still happens at create and needs the one acknowledgement tick (`allergyConflictAcknowledged`) as before (D-38).
- 422 field keys from PUT are plain (`allergies`, `dietaryNotes`, `allergens`, `allergyNotes`, `noAllergies`, `noDietaryNeeds`), unlike `intake.*` on booking create.
- Mock mode: the frontend must mock these routes itself in mock-mode specs.

## CI fix (run 38623264680)
Root cause: PUT returned the JS ISO string (`...481Z`), GET returned Postgres text (`...481+00:00`), so `savedAt` differed. Fix: GET (`shape()` in `src/app/api/me/intake/route.ts`) now normalises with `new Date(x).toISOString()`; contract v1.7 states `savedAt` is always ISO 8601 UTC with ms and `Z`. Test unchanged.
