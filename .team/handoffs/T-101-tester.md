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
