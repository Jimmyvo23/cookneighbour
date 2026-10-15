# Handoff: T-067 Saved allergy profile (tester)

From: tester  To: reviewer

## Verdict: PASS (pending CI on the added API/RLS tests; see CI line below)

## What I checked (code read plus tests)
- Routes `GET/PUT/DELETE /api/me/intake`: customers only via `requireCustomer()` (role from the `profiles` row, not JWT metadata). DELETE checks content-type before auth (400 for a bad type even when anonymous; harmless).
- Validation: `parseSavedIntake` reuses the booking `parseIntake` (same text-safety, 300/dietary limits, allergen picker, unknown-field refusal, blank refused). The booking has no contact-data guard, so none is expected here.
- Isolation: the id comes from the session, never the body. Writes go through the service role to the caller's own row only. Migration adds two nullable columns plus an object check; no new grant or policy; `profile_private` is owner and admin read only, and the default grants give clients no insert, update or delete. The trigger creates the row at signup, so the upsert never creates a partial row.
- Migration safe on existing data: nullable columns, no backfill, no rewrite of functions.
- `savedAt`: ISO with ms and `Z` on PUT and GET (CI fix verified in code).
- Not in `GET /api/me`, not in booking detail; booking create neither reads nor writes the profile.

## Tests added
- `tests/api/saved-intake-tester.test.ts` (new): admin 403 on all three handlers; chef with a "customer" metadata claim 403; customer with chef/admin claims still works as customer; `savedAt` regex on PUT and GET and equal; failed PUT keeps old value; save and clear leave phone, address and verification untouched; stored garbage reads as nothing saved; DB check refuses non-object jsonb (23514); clear with nothing saved is 200; array or string body 400; saved text never appears in the chef's booking view or `/api/me`; later profile edits do not change the booking's own copy; chef gets 403 on the route. All text tags are unique per test.
- `tests/rls/privacy.test.ts`: extra assertions for no client delete, another customer cannot forge an update, and the owner's value is unchanged afterwards.

## Results
- Local: `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` all green (1856 pass, 3 expected fail). API and RLS tests need Docker and run only in CI.

## Bugs
None found. Notes (info, not blocking):
- Admin can read any customer's saved form with the existing `profile_private` admin policy (same as phone and address); stated by the builder.
- `PUT` with an empty form returns 422 with keys `allergies`, `dietaryNotes` (covered by the builder's test).

## For the Reviewer
Check the CI run for the two test files above. Hosted `supabase db push` is needed after merge (Jimmy).
