REQUEST CHANGES (Reviewer, T-079, head 7ed92c9)

The date-clash fix is correct and keeps its meaning. The groceries fix still has the same kind of flake, from a different field, and it needs a one-line change. Two small follow-ups go with it.

Verified: lint, `tsc --noEmit`, prettier and `npm test` pass locally (85 files, 2025 passed, 3 expected fail). ci is green on run 38921381750. The PR touches tests, docs and the handoff only. No product code changed and no SQL or migration was touched. The scope fits WO D-70.

**MED tests/api/groceries-tester.test.ts:158-160: `id` and `bookingId` can still match /fee/i.**
The response (`receiptView`, src/lib/server/groceries.ts:138-139) still has `id` and `bookingId`. Both are random UUIDs in hex, and f, e and e are all hex digits. So "fee" shows up in a UUID by chance about once in 190 times (around 22 places in each UUID, 1/4096 at each place). With two UUIDs, this test still flakes on about 1% of runs. That is the same class of bug this PR is closing. Fix it either way:
- (a) also drop `id` and `bookingId`: `const { fileUrl: _u, id: _i, bookingId: _b, ...visible } = ok.body;`
- (b) keep the whole body and match words only: `/\b(markup|fees?)\b/i`. UUID groups are 4, 8 or 12 hex characters, and the URL token is base64url, so a word on its own never appears there by chance. Check the second claim if you pick (b).
Option (a) matches the PR's intent best: check every field a user sees and drop only the random ones. All the fields a user sees are still checked (amount, currency, status, dispute note, reimbursement and so on). Only random values get dropped.

**LOW tests/rls/booking-api.test.ts:37: `ids()` turns an RPC error into `[]`, so the negative checks can pass without proving anything.**
Before this PR, `toEqual([])` on `data: null` would fail. Now `not.toContain(chef.id)` at :155, :209-211 and :226 passes even if the RPC errors. Only :152 checks `error`. Fix: have `ids()` assert first, for example `expect(r.error).toBeNull()` inside it, with `type Rpc = { data: unknown; error: unknown }`. That keeps the pending/rejected and stale checks able to fail.

**NIT docs/lessons-learned.md:50: make the row shorter.**
The row is accurate. The date maths checks out: 2026-10-16 + 15 = 2026-10-31, and booking-changes.test.ts:352 is the source. The second sentence of the fix column is about a different lesson. Either cut it down to "Do not regex a response that holds random tokens or UUIDs (signed URLs, ids) for a short word; strip them first", or make it its own row. After the MED fix, say "random ids" and not only "signed URL".

**INFO: what the asserts still prove (booking-api.test.ts):**
- Outside-window `chefs_booked_on` still uses exact `toEqual([])` for all chefs at :184-187, for today, today+300 and today-5. That is correct, because the function's window check covers every chef. `chef_booked_dates` stays exact everywhere, which is fine because it is scoped to one chef.
- Pending/rejected: :195 first proves the chef is listed while approved, and :209-211 then proves `not.toContain` after each status change. So the negative check can fail and has not been hidden by `toContain`. The LOW item above is the only gap.
- far(12) declined (:155) and stale-expired (:226) keep their negative intent.

**INFO: grep for the same weakness elsewhere.**
`chefs_booked_on` is only asserted in booking-api.test.ts. visibility.test.ts:204 checks a grant snapshot, not data. tests/api/search.test.ts uses exact sets, but every query filters on a cuisine tag unique to each test (search.test.ts:3, 22, 43), including the date filter at :328-330, so it is safe. The exact lists in bookings.test.ts are filtered by their own booking or customer ids. I found no other exact list on shared public data.

