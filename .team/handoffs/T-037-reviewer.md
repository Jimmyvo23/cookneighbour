# T-037 Reviewer handoff

**Task:** T-037 Domain rules (TDD) (PR #84)
**Verdict:** APPROVE on head 8490c94 after three rounds (comments 6074028776, 6092112056, 6092306442; CI run 38013586157 green on 8490c94)
**Written by:** Planner, from the Reviewer's reports (D-7)

## Rounds
- Round 1 (head 56acb19): REQUEST CHANGES. MEDIUM `allergy.ts:61` matched only when all allergen words were in the intake ("nuts" vs "tree nuts" missed); LOW `docs/domain-rules.md:12` said 10% instead of 15% (A-15).
- Round 2 (head bffe82d): REQUEST CHANGES. The reverse match needed every non-filler intake word inside the allergen, so "Extremely allergic to nuts", "my son: nuts" and similar were missed.
- Round 3 (head 8490c94): APPROVE. Conflict when the intake contains the allergen words in order, or any non-filler intake word equals any allergen word (lower case, punctuation stripped, trailing "s"). Tests written first; guard test that no FILLER word is an `ALLERGEN_CHOICES` word. Over-warning ("gluten-free", "tree pollen") is acceptable: a conflict is a warning the customer acknowledges, never a block.

## Confirmed
- Money in integer cents, half-up rounding, lines add up to the total; A-13 to A-16 and the D-15 window match PLAN; Toronto midnight and DST correct; `src/lib/domain` pure; no routes, migrations or UI; N11/NANP and Canada Post letter rules correct; seed postal fixes keep the same prefixes.

## Findings (none blocking)
1. Rules in code not yet in PLAN: `MAX_DISH_QUANTITY = 10`; cook time and cost scale linearly with quantity; cancellation day 1 starts 00:00 Toronto, 48-hour cutoff inclusive, same timing for chef cancellations; labour and platform fee rounded half up per day; `ALLERGENS_RAW_MAX = 50`; allergy matching rule (both directions, filler list, trailing "s" only). Record as assumptions A-21 onward.
2. Existing hosted rows under the stricter phone and postal rules: problems appear on the next save. An admin kitchen review that sends a now-invalid stored address gets 422 (`src/lib/domain/admin-chefs.ts:268-285`); a stored N11 phone makes `phoneHash` throw (`hash.ts:17`). Real Canadian data never hits this; only typed test data could.
3. Allergy gaps left: run-together words, "-es" plurals, spelling variants (soya, mollusks, sulfites) and synonyms (gluten vs wheat, dairy vs milk, shrimp vs crustaceans, nuts vs peanuts). Decision for Jimmy before T-042 ships the intake form (Q-20); building the intake from `ALLERGEN_CHOICES` removes most of the risk.
4. Tester LOW/INFO accepted: receipt tolerance rounded half up before a strict compare (`receipt.ts:33`, at most half a cent); blank intake strings accepted (Q-19); no cross-day overflow check; DB postal regex shape-only.

## Follow-ups
- T-038: a stored phone the new rule rejects must give a clean 409 or 422, not a 500; use `freeTrialEffect` as the single source for hold, consume and release.
- T-039: reuse `centreForPostal` and `distanceMetres`; keep `.eq('status','approved')`; use `chefMatchesDietary` (A-17).
- T-042: pass `torontoToday()` as `ctx.today`; `chefBookedDates` must match the database `is_active` index; map `CHEF_NOT_BOOKABLE` to 404 and `DOUBLE_BOOKED` to 409; build the intake allergy field from `ALLERGEN_CHOICES` plus free text; decide Q-19 and Q-20 first; no-show and pickup handling.
