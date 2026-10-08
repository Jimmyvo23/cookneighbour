# T-034 Reviewer handoff

**Task:** T-034 Dish menu and availability calendar UI (PR #77)
**Verdict:** APPROVE on head 7a9fa7d (review comment 6067991479; CI run 37835292484 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## What was checked
- Guard: `src/app/chef/layout.tsx` allows chefs only and fails closed.
- Dish photos go to `<uid>/dish-<uuid>.<ext>` (lower case, no overwrite); table writes only through API routes.
- Mock adapter mirrors the check order in `src/lib/server/dishes.ts`.
- Dollars to cents; D-15 window from the server's `today`/`lastBookableDay`; availability PUT sends only the diff.
- Upload reuse on retry (`uploadRejected`), accessibility of calendar and dish form, MOCK labels and D-14 wording, removed-kitchen-photo text matches the code.
- Scope: frontend, mock and test files only.

## Findings
1. LOW `src/app/chef/layout.tsx:5-9`: the comment says /chef pages need no guard of their own. Only true because they load data in the browser through guarded routes; a layout does not re-run on in-app navigation. Reword it; any page that reads private data on the server needs its own guard (T-036 /admin).
2. LOW `src/components/chef/DishesView.tsx:540-542`: replacing a dish photo does not say the old photo stays public at its old link (T-032 decision). Add a line or record it in the T-054 README known limits.
3. INFO `AvailabilityView.tsx:320`: "Discard changes" can be pressed during a save; harmless.
4. INFO, accepted: tester findings 3 (allergen duplicates, backend backlog), 4 (bidi, T-060), 5 (guard 200 + streamed redirect).
5. INFO, test gap: no raw-HTML /chef test for a signed-in admin (needs a seeded admin; T-035/T-036).

## Follow-ups
- T-035: keep admin decision writes conditional on the reviewed files; add a seeded admin for finding 5.
- T-036: server guard on /admin/* (page by page where data is read on the server); MOCK badge on every check status; fix the layout comment (finding 1).
- WO-4: search shows only active dishes and ticked dates inside the D-15 window.
- T-054 README: dish photos, including replaced ones, are public by link.
- Planner: correct the removed-kitchen-photo wording in PLAN.md T-033 and T-032 follow-ups (the code tries to delete the file).
