# Work Order WO-6a: Backend hardening follow-ups

Tasks, in this order (Backend works one at a time; each task gets its own branch and PR, then Tester and Reviewer):
1. **T-088**: narrower phone rule in `findContactDetails`. Branch `feature/T-088-phone-rule`.
2. **T-090**: T-048 Reviewer LOW-2 (`decide()` in `src/lib/server/admin-engagement.ts` ignores an error on the final `free_trial_claims` read and answers `freeTrial: "none"`; drop the extra `reports` read if `admin_decide_booking` can return `booking_id`), **plus** T-048 Reviewer INFO-4: drop the unused `reports.admin_note` column so the reporter can't read it. One PR.
3. **T-060**: refuse bidi and zero-width characters in public text (issue #73); a test that client and server agree.

Jimmy chose all four items and their order on 2026-10-20 ("go all in now").

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-088 | Test-first. A phone number is 10 digits, or 11 starting with 1 (North American shapes), with optional spaces, dots, dashes, brackets and a leading +. Shorter digit runs (order numbers, dates such as 20261031) pass. Emails and links are unchanged. The rule applies wherever `findContactDetails` is used (chat before acceptance, decline and cancel reasons, customer review comments). Update the domain rules and contract text. Client and server share the module. | S | Phone shapes split across lines or with letters |
| backend | T-090 | Throw on `r.error` like the rest of the file; return `booking_id` from the function if cheap. New migration drops `reports.admin_note` (Jimmy approved the delete: no code writes it, and hosted rows are expected empty, checked before the push). Update types, contract, data model and RLS or grant tests. | S | Dropping a column that a view or test still uses |
| backend | T-060 | One shared check for bidi controls (U+202A–202E, U+2066–2069) and zero-width characters (U+200B–200D, U+2060, U+FEFF) in public text fields (display name, bio, dish text, reviews, chat). Refuse with 422 and the field name. A client/server agreement test over the same cases. | M | Which fields count as "public" |
| tester | each | Edge cases per task, the full suites, `ci` gate. | S–M | Low |
| reviewer | each | Plan compliance, no over-matching or under-matching, migration safety, code quality. | S | Low |

## Decision already made
- T-088 rule: Jimmy chose "10–11 digits, phone shape (Recommended)": "Refuse only North American shapes: 10 digits, or 11 starting with 1, allowing spaces, dots, dashes and brackets. 'order 20261031' (8 digits) and dates pass."
- Dropping `reports.admin_note`: chosen by Jimmy ("Dropping it deletes a column, which needs your OK. Choosing this gives it."). The hosted push still asks Jimmy and runs a read-only check that no row has a note.

## Left out
Street-address detection (Q-23), filtering report text (T-048 builder choice).

## Decision
Decide ids `WO-6a-backend`, `WO-6a-tester`, `WO-6a-reviewer`.
