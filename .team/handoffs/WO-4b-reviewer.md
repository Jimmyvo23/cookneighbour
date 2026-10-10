# WO-4b Reviewer handoff (PR #92, round 1)

Written by the Planner from the Reviewer's report (the Reviewer is read-only).

Verdict: REQUEST CHANGES (docs only). CI green.

1. HIGH D-19 "never later than start of day 1" was a Planner addition. Jimmy confirmed it 2026-10-10 together with D-27 (24 h notice).
2. MEDIUM T-042 depends on T-061; T-062 depends on T-042 (the D-22 409). Fixed in PLAN and WO.
3. MEDIUM §10 missed pickup had no build task. Jimmy decided D-29; added to T-042 and T-045.
4. MEDIUM Q-11 rate-limit half was undecided. Jimmy decided D-28 (max 3 open requests).
5. LOW A-6, A-10, A-16, A-24 marked confirmed or changed by D-18, D-20, D-24, D-26, D-29.
6. LOW T-033 notice is owned by T-043 and T-045; contract §11 N3 is owned by T-042.
7. LOW D-26 needs a per-day "cooked" marker: added to T-042 (contract v1.4, input to `freeTrialEffect`).
8. LOW The D-22 admin flag is stored in T-042 and shown in the WO-5 admin bookings list.
9. INFO The extra wording in D-20 and D-24 is from the Planner; Jimmy accepted the Planner suggestions D-21 to D-26 on 2026-10-10.
10. LOW Seven photo-rendering mock specs do not block storage URLs. The backfill and a shared fixture are added to T-062.
11. LOW `parseSavedForm` allows 200 characters instead of `TEXT_MAX` 40 (`src/lib/search/search.ts:279`). Added to T-062.

INFO: `isSafeStoragePath` does not reject C1 controls. This is harmless because segments are URL-encoded.
