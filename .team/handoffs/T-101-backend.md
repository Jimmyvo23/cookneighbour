# Handoff: T-101 Contact filter on self text and intake read window

From: backend  To: tester

## What changed
- Branch: `feature/T-101-self-text-intake` (from main 81ca381). Pull request: see PR title "T-101: Contact filter on self text and intake read window".
- D-147: new `src/lib/domain/contactText.ts` (`contactProblem`, `failureForFields`, shared message "Remove phone numbers, email addresses and links."). Filter added to: `displayNameProblem` (browser + MOCK), `Fields.publicText` (server sign-up and `PATCH /api/me`), `parseUpdateBody` bio, `parseDishBody` name and description, `parseIntake` notes, browser `intakeProblems`. Routes answer 422 `CONTACT_DETAILS_NOT_ALLOWED` through `fieldsFailure` (`src/lib/api/errors.ts`) when contact details are the only field problem, else `VALIDATION_FAILED`. MOCK adapter and mock bookings use `failureForFields` too.
- D-148: migration `supabase/migrations/20261026100000_intake_read_window.sql`: `can_read_intake(booking)` (SECURITY DEFINER) and a replaced `intake_forms_select_party`. Customer always; chef when `requested` or `booking_contact_open` (accepted, completed, no-shows, until 00:00 Toronto on last day + 8); admin policy untouched.
- Docs: api-contract v1.23, domain-rules, data-model.
- Tests: `src/lib/domain/contactText.test.ts` (unit, includes a seed-data check), `tests/api/self-text-contact.test.ts`, `tests/rls/intake-window.test.ts`.

## How to verify
- `npx vitest run` (unit, local): 3044 passed. `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` clean.
- API and RLS tests need local Supabase (no Docker on this Mac), so they run only in CI: `npm run test:api`, `npm run test:rls` (check package.json names).
- Seed data: every seeded name, bio, dish name and description passes the filter; no seed text changed.

## Known gaps or risks
- API and RLS tests ran only in CI (all green on the final run; round 1 failed only the function-privilege snapshot, fixed by adding `can_read_intake`).
- Text saved before this change is not re-checked or migrated. Hosted data could already hold a phone number, email or link in a display name, bio, dish text or saved intake. A saved allergy profile that now fails the filter reads as "nothing saved". Approximate hosted pre-check (read only, regex is looser than the real filter): `select 'chefs' t, profile_id::text id, bio v from public.chefs where bio ~* '(@|https?://|www\.|[0-9]{3}[^0-9]{0,3}[0-9]{3}[^0-9]{0,3}[0-9]{4})' union all select 'dishes', id::text, name||' '||coalesce(description,'') from public.dishes where name||' '||coalesce(description,'') ~* '(@|https?://|www\.|[0-9]{3}[^0-9]{0,3}[0-9]{3}[^0-9]{0,3}[0-9]{4})' union all select 'profiles', id::text, display_name from public.profiles where display_name ~* '(@|https?://|www\.|[0-9]{3}[^0-9]{0,3}[0-9]{3}[^0-9]{0,3}[0-9]{4})';` Hosted needs `npx supabase db push` (Jimmy).
- After the window, the chef's booking detail shows empty allergy and dietary text (shape unchanged). Frontend may want a "no longer shared" line; no new field was added.

## What the next agent needs
- Builder choices, unconfirmed by Jimmy: contact error only when every field error is the contact message (a mixed failure stays `VALIDATION_FAILED`); the chef's bio uses the same filter as dish text; sign-up display name is filtered too; the intake filter applies to estimate and the saved allergy profile as well as booking create; the admin keeps reading all intake forms; the window reuses `booking_contact_open`, so `requested` plus the D-52 statuses only.
- Test ideas: estimate with phone notes, RLS at last day + 7 vs + 8 for each accepted status, chef detail after decline.
