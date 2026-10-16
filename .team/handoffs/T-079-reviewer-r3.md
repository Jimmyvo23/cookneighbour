APPROVE (Reviewer, T-079 round 3, head 28b55b7)

All my findings are fixed. ci is green on run 38938109560.

**Resolved: MED tests/api/groceries-tester.test.ts:161.**
The plain `/markup|fee/i` is back. It runs on `visible`, which has `fileUrl`, `id` and `bookingId` removed (:159-160). The random values are gone, and every field a user sees is still checked, field names included. A future `platformFeeCents` or `markupCents` field would now fail this test.

**Resolved: NIT docs/lessons-learned.md:51.**
The row now says to drop the random fields and then match the plain word, without `\b`, and it explains why (camelCase JSON keys). It is accurate and short.

**Resolved earlier and unchanged:**
- LOW: `ids()` asserts that `error` is null (tests/rls/booking-api.test.ts:36-40).
- The date-clash fix, with the negative checks for pending and rejected chefs intact.

**INFO: scope.**
Round 3 changes only the two lines above, plus `.team/handoffs/T-079-tester.md` and a new `.team/handoffs/T-079-reviewer-r2.md` (my round 2 notes). Across the whole PR (main...28b55b7) there is no product code and no SQL or migration. Only tests, docs and handoffs changed. The scope fits D-70 and D-72.

