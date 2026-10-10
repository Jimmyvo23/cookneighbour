# T-041 Reviewer handoff

**Task:** T-041 Chef detail page (PR #90)
**Verdict:** APPROVE on head 35a9b8e (comment 6099928788; CI run 38068812624 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## Confirmed
- Privacy: only `GET /api/chefs/:id`; only §7 fields, as plain text; no storage URLs in MOCK mode; `isSafeStoragePath` (`src/lib/chef/dishes.ts`) rejects empty, `.` and `..` segments, a leading slash, backslashes and control characters, and encodes the rest.
- Honesty: allergen text never says "free"; MOCK badge on the kitchen line; booked days not yet removed is stated; Book is an inert stub with no request.
- States: one "Chef not found" for every 404; retry state for other errors and broken answers; neutral "cannot be booked yet" (Q-21); `error.tsx` as a last resort.
- Accessibility: h1, h2 sections, h3 dishes; labelled regions; allergens in words, not colour only.
- Saved search ("back keeps filters"): only a search the user ran, one tab, strict read-back. Acceptable for the demo.
- T-040 carry-overs done (A-25 label, kitchen MOCK note, `ChefReviewView` comment). Nadia Petrova (MOCK) only by direct URL. No backend, contract, migration or domain edits.

## Findings (none blocking)
1. LOW, shared devices, `src/components/search/SearchView.tsx:263`: the saved search can keep a full postal code in sessionStorage until the tab closes. Later: save only the 3-character prefix or add "Clear search".
2. INFO `src/lib/search/detail.ts:65`: shape check accepts any text in `locationOptions` (empty list item for an unknown value; broken server only).
3. INFO `src/components/chefs/ChefDetailView.tsx:142`: malformed `today`/`lastBookableDay` throws in date formatting; `error.tsx` catches it.
4. INFO, test quality, `e2e/search-real.spec.ts:443`: the helper always makes a chef offering both places, so "cannot be booked yet" is covered only by mock and unit tests.
5. INFO `ChefDetailView.tsx:348-352`: MOCK badge mid-sentence without punctuation reads awkwardly to a screen reader.
6. Accepted: tester round-1 INFO 3–6, round-2 INFO 7 (three `it.fails` "KNOWN GAP" tests).

## Follow-ups
- T-042: enable Book when the chef has at least one place to cook; remove booked days from `bookableDates`, the `date` filter and the page text (`ChefDetailView.tsx:142-145`); decide Q-21 and update `MOCK_NOT_BOOKABLE_CHEF`; re-check approved, `chef_home_enabled` and radius at booking; settle Q-20 before the intake allergy warning.
- T-043: reuse the dish cost and allergen display; keep the "estimate" wording.
- Later polish: findings 1, 2 and 4; align the 200-character saved text with the 40-character form limit; skip link (T-052).
