REQUEST CHANGES (Reviewer, T-079 round 2, head ed6b392)

The LOW and NIT items are fixed. The MED fix went too far: it now misses camelCase field names, so the "no markup" check is weaker than it was on main. This is a one-line fix.

Verified: the diff from 7ed92c9 to ed6b392 touches only tests, docs and handoffs. No product code or SQL changed. ci is green on run 38928361959.

**MED tests/api/groceries-tester.test.ts:161: the whole-word regex misses camelCase field names.**
Round 2 applied both of my options: it drops `fileUrl`, `id` and `bookingId`, and it also adds `\b`. Together they are weaker than either one alone. In JSON, keys are camelCase, and `\b` needs a non-word character after "fee", so the check no longer catches the field names it most needs to catch. Checked with node:
- `/\b(markup|fees?)\b/i` on `{"platformFeeCents":1}` gives false
- `/\b(markup|fees?)\b/i` on `{"markupCents":1}` gives false
- `/markup|fee/i` on `{"platformFeeCents":1}` gives true

So a future `markupCents` or `serviceFeeCents` field would get through. That is exactly what this test exists to catch. My first note offered (b) as an alternative to (a), not as something to add on top. I should have said the two options do not combine; sorry.
Fix: keep the destructuring and go back to the plain regex: `expect(JSON.stringify(visible)).not.toMatch(/markup|fee/i);`. With the random values gone, nothing in `visible` is random: amounts, "CAD", the status word, ISO timestamps, booleans, `null` for the dispute note, and the key names. I checked a sample payload of this shape, and `/markup|fee/i` does not match it ("differenceCents" has "ffe", not "fee"). Update the comment at :157-158 if needed.
Also fix the new lessons-learned row (docs/lessons-learned.md:51) to match. Its fix column says "match whole words (`\b`)". Change it to: "drop those fields first, then match the plain word (no `\b`: JSON keys are camelCase, so `\b` misses `platformFeeCents`)".

**Resolved: LOW tests/rls/booking-api.test.ts:36-40.**
`ids()` now asserts `r.error` is null before it returns, so `not.toContain` at :155, :209-211 and :226 can no longer pass on a failed RPC.

**Resolved: NIT docs/lessons-learned.md:50-51.**
The date row is shorter and accurate, and the random-value lesson is its own row. The `\b` wording in it needs the change above.

**INFO .team/handoffs/T-079-reviewer.md:**
This file is new in the PR. It holds my round 1 comment word for word, which matches how the Planner records review notes. Nothing to change.

**INFO:**
My round 1 notes on assert meaning and the grep for other shared-list asserts still apply. Nothing else changed in booking-api.test.ts.

