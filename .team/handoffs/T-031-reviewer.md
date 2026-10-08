# Handoff: T-031 Chef onboarding API (Reviewer)
From: reviewer  To: planner
Verdict: **APPROVE** (head dd2c9f6). No blockers.

## Inputs reviewed
- `.team/handoffs/T-031-backend.md` (round 2)
- `.team/handoffs/T-031-tester.md` (round 2: PASS)
- The full PR diff, `docs/api-contract.md`, `docs/data-model.md`, `docs/work-orders/WO-3-chef-side.md`, CLAUDE.md, and `docs/lessons-learned.md` (from origin/feature/T-058-lessons-learned).

## CI and local checks
- CI `ci` **passed** on dd2c9f6 (run 37782726482): unit 165, RLS 111, API 207, Playwright real-route 7, mock mode 6.
- Locally on the PR branch: lint, typecheck, `prettier --check .` and `npm test` (165 tests) all pass.

## Verified sound
- **Gate:** `requireCaller` takes identity from `getUser()` and the role from `profiles.role`. JWT `user_metadata.role` is ignored. The service-role client is created only after the role check; row repair runs only after it too.
- **Ownership:** every client-supplied path goes through `checkStoragePath` (own folder only; rejects `..`, leading `/`, backslashes, control characters; lower-case `<prefix>-<uuid>.<ext>` names per kind). A foreign folder gets 403 before any Storage call. DELETE only removes registered paths.
- **Check-then-act:** every `chef_private` write is conditional on `updated_at`; lost races re-read and rebuild, 409 after 12 losses. Submit's rejected-to-pending move is conditional on `status = 'rejected'`. Both buckets are insert-only for the chef.
- **Migration** `20261008150000_kitchen_photos_insert_only.sql`: drops exactly `kitchen_photos_update_own` and `kitchen_photos_delete_own`; insert policy still requires own folder and `is_chef()`; RLS tests cover it.
- **Privacy:** no hash, phone, email or home address in any response. Repaired `display_name` is copied from `profiles`, not derived from the email.
- **MOCK honesty:** every check-status write and mapping is commented MOCK; submit returns `mock: true`.
- **Contract and validation:** contract matches code. **Secrets:** none in the diff.

## Findings
- **R1 (Non-blocking): dangling kitchen-photo registration after a race.** `src/lib/server/chef-application.ts:472-495`: `registerDocument` skips `objectExists` based on the initial `chef.state`. A parallel DELETE of that photo, then a retry, can re-add a path whose object is gone. Fails safe (check pending, chef's home off). Fix: inside `build`, if the path is not registered in `s` but was skipped as "already registered", throw `NOT_FOUND` or re-probe Storage.
- **R2 (Non-blocking, action for T-035): submit completeness is not locked.** `src/lib/server/chef-application.ts:540-582`: `missing` reads `chefs` and `dishes` but only `chef_private` is locked. Fix in T-035: admin approve recomputes completeness server-side in the same conditional write and refuses if anything is missing.
- **R3 (Non-blocking): scope and deploy.** Migration was a Planner-decided fix for tester F3, well under the 25% threshold. After merge: `npx supabase db push`, record in PLAN.md notes.
- **R4 (Informational):** `supabase/migrations/20261007221003_storage_buckets.sql:5` comment is stale; already applied, do not edit. `docs/data-model.md` is accurate.
- **R5 (Non-blocking): carry-forwards.**
  - README known limits (T-054): orphan uploads the chef never registers can no longer be deleted by the chef.
  - T-033: badge every check status MOCK; upload with fresh lower-case uuid names and `upsert: false`.
  - T-035: admin verdict writes stay conditional on the reviewed paths and bump `chef_private.updated_at`. See R2.

## Could not verify
- API and RLS suites not run locally (no Docker); evidence is green CI on the exact head plus code reading.
- R1 and R2 races are reasoned from code, not observed.

## Next
Planner: update branch, wait for CI, merge, `npx supabase db push`, PLAN.md notes, start T-033.
