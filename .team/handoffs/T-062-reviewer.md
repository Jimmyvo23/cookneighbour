# Handoff: T-062 Reviewer (written by the Planner from the Reviewer's report; the Reviewer is read-only)

**Verdict:** REQUEST CHANGES (PR #98, head 077e47b). One MEDIUM, four LOW. Local lint/tsc/prettier clean, unit 1519, mock Playwright 29/29 on affected specs.

## Findings
1. **MEDIUM — false promise** `src/lib/chef/calendar.ts:134`: the 409 message says "ask the customer to cancel first", but cancel does not exist yet (T-063) and the chef cannot contact the customer before acceptance (§6.8, no chat until WO-5). Fix: "Keep it ticked." / "Keep them ticked."; add a test that the message has no "cancel".
2. **LOW** `src/components/chef/AvailabilityView.tsx:207`: "You cannot untick a day that has a booking" — the save is refused, not the untick. Fix: "If a day has a booking, clearing it is refused and nothing is saved."
3. **LOW** `src/components/admin/ChefQueueView.tsx:267`: "still listed until you reject them" is not always true (D-25, A-20). Fix: "The chef stays approved until you reject them."
4. **LOW** `src/lib/api/types.ts:487`: `firstBookableDay` should now be required; remove `?? chef.today` (`ChefDetailView.tsx:141`) and the `!` in `mock-search.test.ts:183`.
5. **LOW** `e2e/search-real.spec.ts:445`: the 404 branch never runs (helper always offers both places). Assert the 200 path unconditionally and fix the title.

## Passed
Honest "Nothing was saved"; focus to `role="alert"`; dark-mode contrast ~7:1; mocks match contract v1.4; `blockStorage` in every photo spec; scope within the T-062 row; tests meaningful.

## Later
- T-063/WO-5: the 409 message may suggest cancel/chat once they exist.
- `parseSavedForm` compares raw length, `validate` trimmed length (compare `.trim().length`).
- README demo script: mention the MOCK booked day (today + 3).
