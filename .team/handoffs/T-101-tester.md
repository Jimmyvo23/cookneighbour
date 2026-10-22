# Handoff: T-101 Tester

From: tester  To: reviewer

## Result
PASS pending CI (see final report). Local: eslint, tsc, full vitest green. API and RLS tests run only in CI (no Docker).

## Tests added
- `src/lib/domain/contactText-tester.test.ts`: 13 normal texts (years, ranges, quantities, temperatures, Vietnamese with tones) pass on display name, bio, dish name/description, intake notes; 12 contact variants (phone shapes, full-width digits and email, en dash, spaced digits, url, bare domain) refused on every field; saved intake refusal and legacy-row behaviour.
- `tests/rls/intake-window-tester.test.ts`: no-show statuses inside/outside window, 30 days past, future accepted, other chef/customer/anon, requested -> declined closes at once, chef cannot write/delete, unfiltered read leaks nothing.

## Findings
- LOW: a legacy saved allergy profile that now fails the filter reads as "nothing saved" with no message (`src/lib/domain/savedIntake.ts` readSavedIntake). Already listed as a known gap by backend; nothing is lost in the database, and a new save is refused with a clear field error. Suggest the Reviewer confirm acceptance.
- LOW: zero-width characters inside a number are refused with "Remove control or invalid characters." rather than the contact message (still refused).
- Migrations apply in order: T-098 20261026100000 then T-101 20261026110000.

## CI status (update)
- Run 39787845436 (head cc6e97d): `RLS tests` success, `API route tests` success, seed success, `checks` pass, `e2e-mock` pass. The `supabase` job was then cancelled in the Playwright (real routes) step at the 30 minute cap (slow runner: `playwright install` took 9 min), so `ci` gate failed with "A needed job did not succeed (cancelled)". Infra, not a test failure.
- Re-run was not possible, so an empty commit was pushed (046bc12). No CI started: the PR is now CONFLICTING with main (T-103 #203 and T-099 #202 merged). Conflict is only `docs/api-contract.md` (version entry numbering, v1.23-v1.25). Tester does not edit docs; builder must merge origin/main, resolve, push.
- Migration order on main is unchanged up to 20261026100000; T-101 20261026110000 still sorts last.
