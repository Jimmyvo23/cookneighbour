# Handoff: T-033 Chef onboarding and profile UI (Reviewer)
From: reviewer  To: planner (written by the Planner from the Reviewer's report, D-7)
Verdict: **APPROVE** (head add3a88). No blockers. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/70#issuecomment-6062554504

## Inputs reviewed
`.team/handoffs/T-033-frontend.md` (incl. Round 2), `.team/handoffs/T-033-tester.md` (Round 1 FAIL, Round 2 PASS), `docs/lessons-learned.md`, `docs/api-contract.md` §§1, 2, 5, `.team/handoffs/T-031-reviewer.md` (R5), WO-3, CLAUDE.md.

## CI and local checks
- CI `ci` passed on add3a88 (run 37794812230): unit 236, RLS 111, API 207, Playwright real-route 11, mock 19.
- Local: lint, typecheck, `prettier --check .`, `npm test` (236), build, mock Playwright (19) pass. API/RLS/real-route evidence is CI (no Docker).

## Verified sound
- **Server guard** `src/lib/server/page-guard.ts:21-34`: `connection()` then `requireCaller()`; identity from `getUser()`, role from `profiles.role`; fails closed; no private HTML (view loads data via the API after the guard; real-route test checks it). Skipped only when `NEXT_PUBLIC_API_MOCK === "1"`, off by default.
- **Uploads** `src/lib/chef/upload.ts:90-137`: `<uid>/<prefix>-<uuid>.<ext>`, lower case, fresh uuid, `upsert: false`, uid from `/api/me`; storage error text hidden. Meets T-031 R5.
- **MOCK labels** on every check status, the hygiene acknowledgement and the submit notice; mock uploader stores nothing.
- **Contract** matches §5; 409/422 shown in the right places.
- **Accessibility:** focus to first invalid field or alert after errors (`src/components/chef/parts.tsx:46-54`), focus to heading after photo removal, labels and `aria-describedby`, 44 px targets, axe at 375 px dark mode, keyboard order.
- **Scope** within WO-3 T-033 row; `@axe-core/playwright` (MPL-2.0, free, dev-only) justified by the axe requirement.

## Findings (none blocking)
1. **Low, wording** `src/components/chef/ChefApplicationView.tsx:464`, `:536-538`: "sends its check back to pending" overstates for a `not_started` check. Suggested: "If it was already reviewed, a new file sends it back for review." Fix with T-034.
2. **Low, privacy wording** `ChefApplicationView.tsx:593`: "You can remove a photo" — removal only unlinks it; the file stays in the private bucket and the chef cannot delete it. The folder-based `kitchen_photos_select_customer` policy may let an eligible customer open it (not fully traced). Reword; README known limit (T-054); verify in booking work.
3. **Low, future risk:** the server guard is only on `/chef/apply`. T-034 should add `src/app/chef/layout.tsx` calling `requireChefPage()` (or call it in each new page).
4. **Info** `:538`: the kitchen address is "not shown on your public chef profile" — true, but CLAUDE.md §6.8 shares it with the customer once a chef's-home booking is accepted. Say so when booking lands.

## Builder's known gaps
Agrees with the Tester: inferred "submitted" label OK (consider `submittedAt` in T-035); meta-refresh 200 guard OK (README); draft acknowledgement wording needs Jimmy; orphan files → T-054; no photo preview and "dish editor not available yet" text OK until T-034.

## Follow-ups
- T-034: server guard for all `/chef/*` pages; finding 1 wording; remove "dish editor not available yet" (`src/lib/chef/form.ts:91-92`).
- T-035: approve recomputes completeness in the same conditional write (T-031 R2); verdict writes bump `updated_at`; consider `submittedAt`.
- T-036 / booking: tell chefs the kitchen address is shared on an accepted chef's-home booking; check unlinked kitchen photos are not visible to customers.
- T-054: orphan uploads and removed kitchen photos stay stored; meta-refresh guard; draft acknowledgement wording.
- Jimmy: approve or replace the draft allergen and hygiene statements.
