# Handoff: T-083 + T-085 Tester

From: tester  To: reviewer
Head tested: 101eeb8 (PR #165)

## Result: PASS (no HIGH or MED findings)

## Checked
- LOW-1: all 409 texts in changes.ts and BookingDetailView.tsx end "This page shows its current status."; grep of src, e2e, e2e-mock finds no assertion on "Reload the page to see its status." Remaining "Reload the page" texts are 404/file-link/availability/dish, not 409.
- LOW-2: Refusal409.test.tsx and the T-080 mock spec carry realistic later states.
- LOW-3: new test in Refusal409.tester.test.tsx: page alert gone after a successful receipt answer, groceries notice (role=status, takes focus) stays. Focus is not lost (alert was not focused at that moment; notice takes focus).
- NIT-1..4 and T-085 seed dates verified in the diff.
- Duplicate chef+date unit check (mock-booking-changes.test.ts): ran it against the OLD seed (origin/main file): both new tests FAIL (dupes 2026-10-18, and 2026-10-20 with the hook); pass on the branch. File restored, tree clean.
- lint, typecheck, prettier clean. npm test: 2130 passed + 3 expected fail. test:e2e:mock: 270 passed.
- CI on PR 165 (run 39260773554, head 101eeb8): pass.

## Findings
- LOW-A (honesty): the 409 text "This page shows its current status." is also displayed when the quiet refetch fails (reportRefusal swallows the error), so the page is not refreshed and the claim is false. Worse than the old text only slightly (old text told the user to reload, which was always true). Suggest copy that is true in both cases (e.g. "...cannot be cancelled. If the page looks out of date, reload it.") or showing it only after a successful reload. Product copy, not changed by Tester.
- NIT-A: `clear` is page-wide, so a successful receipt action also removes a 409 alert that came from a different section (cancel, pickup). The page reloaded after that refusal so the dead button is gone, but the explanation disappears. Acceptable; mention for Reviewer.

## Re-check (e0b823a)
Result: PASS with one LOW. Tester added commit (see git log) with two test changes; tested e0b823a plus that commit.
- LOW-A fixed: sentence appended only after the refetch result (success, "current status"; fail/throw/replaced, "Reload the page"); none while running. Unit tests for both paths pass.
- (a) Only 409 refusals reach the page (`isStateRefusal` in BookingDetailView and chef/parts.tsx); 403/404/422/network keep the section alert, so no extra or doubled sentence. The section texts no longer carry the sentence, so no doubling. The punctuation guard avoids ".." for server messages with no full stop.
- (b) `refresh` callers: only passed to `useBookingRefusals` in both views (plus existing load paths ignore the return); boolean is true only when this fetch's data is shown.
- (c) NEW LOW-B: focus is stolen back. The focus effect depends on `last`, which is replaced when the sentence arrives, so if the user tabbed elsewhere while the refetch ran (up to the 20 s timeout) focus jumps back to the alert. Proven by `Refusal409.focus.tester.test.tsx` (`it.fails`, remove `.fails` when fixed). Fix hint: focus only when `id` changes, not `shown`. Also NIT-B: the alert text changes in place after it was announced; screen readers may read the whole alert a second time. Acceptable.
- (d) T072Tester loosening: tightened back to the exact string "There is no visit left to cancel. This page shows its current status." (passes), so a doubled or missing sentence is caught.
- lint, typecheck, prettier clean; npm test 2132 passed + 4 expected fail; test:e2e:mock 270 passed.
- CI: run 39265563634 on 39ec927 passed (the e0b823a run was cancelled by my push).
