# T-082 — Reviewer (reviewer-backend, PR #153)

## 2026-10-17T04:01:08Z

APPROVE (Reviewer, T-082 backend part, head 53fc04f)

Scope: the backend files only (the frontend part was approved on #154 round 2). Read: `.team/handoffs/T-082-backend.md`, `.team/handoffs/T-082-tester-backend.md`, the T-082 row in PLAN.md, `docs/lessons-learned.md`.

**Migration `20261019100000_list_frozen.sql`**
- `get_bookings_frozen(uuid[])` is `security definer`, `stable`, `set search_path = ''`, every name schema-qualified. Execute is revoked from `public, anon` and granted to `authenticated` only, the same as `get_booking_frozen`.
- Only parties get an answer: `(select auth.uid()) in (b.customer_id, b.chef_id)`. A stranger or an admin gets an empty set, so it gives nothing away about whether a booking exists. It returns ids only, with no reason, notes or flag rows.
- D-57 parity: it uses the same source of truth as `get_booking_frozen`, `public.booking_is_frozen` (an open flag other than `no_day_cooked`). `booking_is_frozen` stays service-only, and the definer owner calls it.
- A null array is handled by `coalesce`. Duplicate ids are harmless because `= any` does not repeat rows. The 100-id cap is above the 50-row page maximum.
- No table, column or policy changes. It only reads, so the lock order is unchanged.

**`listBookings` (`src/lib/server/booking-views.ts`)**
- One RPC per page, run in parallel with the days and people reads, so there is no N+1. It is skipped for an empty page. It passes only the page ids, not the look-ahead row. It uses the same user-scoped client as the detail view's `get_booking_frozen`, so `auth.uid()` is set.
- An RPC error throws the generic `list parts` failure, and the error text does not leak. A null answer means nothing is frozen.

**Contract v1.13 (section 7A)**: matches the code. `frozen` is always present, has the same meaning as `BookingDetail.frozen`, never says why, and names the function and the migration.

**Tests**
- RLS: covers the party customer and chef, the other chef, the stranger, the admin, an empty batch, anon denied, and `no_day_cooked` not frozen. It asserts `error` is null before the exact lists, and the lists are of this test's own ids.
- API: both lists, unflagged false, `no_day_cooked` false, the stranger never sees the row, no reason or notes keys, a mixed page, a `limit=1` cursor boundary, and `status=open`.
- Unit (Tester): mapping, exactly one call, page ids only, null answer, empty page, error path.
- Date-independence: dates are relative (`dayBody(chef, n)`, `daysAgo`, `shiftDays`). There are no literal calendar dates. The unit test's fixed `created_at` stamps are only fake rows.
- Privilege snapshot (`tests/rls/visibility.test.ts`) now lists `get_bookings_frozen`. That is correct.

**Merge coherence**: `BookingSummary.frozen` appears once in `src/lib/api/types.ts`, with the same lines in both branches. `git diff origin/feature/T-082-list-frozen-frontend 53fc04f` shows only the Tester's backend test files and handoff, so nothing was lost in the merge.

**Verification (run by me)**: `npm run lint` clean, `npx tsc --noEmit` clean, `npx vitest run` 2096 passed and 3 expected fails (89 files). CI `ci` run 38999463926 on 53fc04f passed (success).

**Notes (none blocking)**
- NIT-1: the contract's "Tables:" line for `GET /api/bookings` does not list the new RPC. It is named inline in the `frozen` text, so this is optional.
- INFO-1: no batch-level test for a *resolved* non-`no_day_cooked` flag. `booking_is_frozen`'s `resolved_at is null` is already covered by the T-064 tests, and the batch function reuses it.
- INFO-2: ids beyond 100 are dropped silently. This cannot happen while pages are at most 50.
- INFO-3: after merge, the hosted database needs `npx supabase db push --linked` (Jimmy) before the deployed list works against hosted.

Scope matches the Work Order (T-082, D-76). Mocks: nothing here touches money, ID or SMS.

