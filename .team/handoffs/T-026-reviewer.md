# Handoff: T-026 review — changes requested

From: reviewer (written by planner)  To: backend

Review: https://github.com/Jimmyvo23/cookneighbour/pull/58#issuecomment-6049293071
Planner decisions (Jimmy delegated) are marked **Decision**.

## Blocking
- B1. Admin MOCK verify can approve a file the admin never saw. Add `idDocumentPath`, `foodHandlerPath` to `AdminChecksRequest`; reviewed kitchen photo paths + address (or a version token) to `KitchenReviewRequest`. Route saves only if stored values still match; else 409 `INVALID_STATE`.
- B2. The client role can update `chefs` and `chef_private` directly, bypassing route checks (ack timestamps, hourly-rate bounds, `chefs.photo_path` pointing at another chef's file, unregistered paths).
  **Decision: option (a).** Routes are the only writers of `chefs` and `chef_private`: revoke client UPDATE on both (and drop the own-row update policies). Dishes and availability stay client-writable under RLS, but add a folder check on `dishes.photo_path` (must start with the chef's own folder) and on `chefs.photo_path`/profile photo paths where stored. Approve confirms each document object exists. The migration lands in T-028 (Backend). State this in the contract.
- B3. Rejected-chef flow contradicts itself. **Decision:** rejected chefs may edit while still `rejected`; `/submit` moves `rejected` → `pending`; approve only from `pending` (fix §2 item 11); drop "resubmit once".

## Non-blocking (also fix in the contract)
- N1. `chef_private` writes in documents/PATCH routes: with decision B2(a) the server is the writer, so the re-verification reset trigger (which only fires for user-scoped writes) will not fire. Either make the route reset statuses itself, or have the trigger also cover server writes from these routes. State which.
- N2. `/submit` moves only `not_started` or `failed` checks to `pending`; re-submit while pending → 409 or no-op. Never overwrite `verified`.
- N3. Kitchen-address change while a chef_home booking is accepted → WO-4 requirement (record in contract "later").
- N4. Public reviews expose author/booking ids → WO-5 reviews contract.
- N5. State: approved chef with a re-uploaded ID stays public while check is pending (MOCK, acceptable). Rejecting an approved chef with accepted bookings → WO-4 question.
- N6. §2 item 6: list `/submit` as a writer of moderation columns.
- N7. Add `AdminChefListQuery` type; document the `missing` field in the error table; decide whether chef display name comes from `profiles` (single source) to avoid drift.
- CSRF: exact `application/json` match, applied to login and logout too.
- README known limits (T-054): MOCK SMS lets anyone claim a real number; one phone cannot hold both a chef and a customer account.

Re-review needs: B1–B3 and N1–N7 in `docs/api-contract.md` and `src/lib/api/types.ts`, CI green.
