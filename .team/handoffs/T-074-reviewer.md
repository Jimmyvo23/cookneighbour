# Handoff: T-074 Backend follow-ups from T-065 (reviewer)

From: reviewer  To: planner
Verdict: **APPROVE** on head dbc978a. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/129#issuecomment-6194823779

## Verified
- `can_view_kitchen_photos` = core_rls body, with the only change `booking_contact_unlocked(b.status)` -> `booking_contact_open(b.id, b.status)` (D-58). Still SECURITY DEFINER with `search_path = ''`; `create or replace` keeps the grant to authenticated. Storage policy `kitchen_photos_select_customer` unchanged and picks up the new rule.
- `answer_booking` = 20261015100000 body, with only the D-59 block (returns `kitchen_address_missing` before any write, after `chef_home_not_enabled`) and the N4 re-indent. Still SECURITY INVOKER, `search_path = ''`, grants kept.
- `set_chef_kitchen_address`: old 8-argument signature dropped; new 9-argument one revoked from public/anon/authenticated, granted to service_role only, `search_path = ''`. Whitelist = the 8 keys the PATCH builder can produce (`chef-application.ts:465-478`). N3 assert refuses any `chef_private` column outside the six the RPC writes. L1 is one transaction.
- Lock order chefs -> chef_private -> bookings (header). `FOR NO KEY UPDATE` (N1) still conflicts with `answer_booking`'s `FOR SHARE`. N2 explicit revoke; N5 comment and data-model note accurate.
- Contract v1.10, data-model, domain-rules and storage table match the code. D-59 message matches the contract word for word. MOCK wording unchanged.
- Tests cover the photo status/window matrix with real storage downloads, D-59 per missing part, L1 rollback and whitelist. Toronto dates.
- Local: lint, typecheck, prettier, `npm test` (1949 passed, 3 expected fail).

## LOW
- L1 `answer_booking` (20261016100000:102-103) checks `is null` only; admin functions (`20261010120000:85,169`) use `coalesce(x,'') <> ''`. Not reachable today. Follow-up: `coalesce(btrim(x),'') = ''` plus one RLS test.

## NIT
- N1 `set_chef_kitchen_address` header says "JSON null clears", but array columns become an empty array. Route never sends it; fix the comment.

## INFO
- I1 Kitchen photos are allowed per chef, not per booking: a past customer inside the window also sees photos the chef uploads later. Pre-existing design; for Jimmy's information.

## After merge
- Merge after `ci` green (update-branch if behind). Jimmy runs `npx supabase db push --linked` for `20261016100000_kitchen_followups.sql` (Planner verified `20261015100000` is already on hosted).
