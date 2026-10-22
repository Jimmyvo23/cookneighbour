# Security and privacy review (T-053)

Reviewer agent, 2026-10-21, read-only review of `main` at `9674e51` (includes T-093, PR #192). Scope: CLAUDE.md sections 6, 10 and 11; all 25 migrations; all 51 API route files; server libraries; Supabase clients; `src/proxy.ts`; `next.config.ts`; the CI workflow; seed scripts; MOCK labels in the UI.

Checks run: `npm test` (124 files, 2978 passed, 3 expected fail); `npm audit --omit=dev` (0 vulnerabilities); a pattern scan of tracked files and git history for keys and committed `.env` files (none). Not run: RLS and API suites (need Docker; CI runs them). Nothing was run against the hosted Supabase project and `.env.local` was not read.

## Verdict

No HIGH findings. Deny-by-default holds: RLS is on for every table; execute is revoked from browser roles on every function and given back only to named policy helpers; every SECURITY DEFINER function sets `search_path = ''`; contact details reach the other party only through `get_booking_contact` inside the window after acceptance; every API route reads the role from `profiles.role` after `getUser()` and enforces ownership through RLS or an explicit `customer_id` / `chef_id` match.

4 MED, 8 LOW, 9 INFO. Each fix needs its own Work Order approved by Jimmy. Follow-up task ids and Jimmy's decisions are recorded in `PLAN.md`.

## MED

**MED-1. A customer can post a public review straight to the database, skipping the contact filter and the unsafe-text check.**
- Where: `supabase/migrations/20261007221002_core_rls.sql:203` (insert grant on `reviews` for `authenticated`, never revoked); `supabase/migrations/20261022100000_reviews_reports.sql:42-57` (the policy still allows a direct insert). The checks exist only in the route: `src/lib/server/reviews.ts:106-120` (`findContactDetails`) and `src/lib/domain/reviews.ts:120` (`hasUnsafeText`).
- Failure: a customer with a completed booking uses the publishable key and their own session to call `POST /rest/v1/reviews` with a comment such as "Book me direct 416 555 0199". The policy passes, and the comment shows on the public chef page through `GET /api/chefs/:id/reviews`. Bidi and zero-width text gets in the same way.
- Fix: as T-046 did for `messages`: drop `reviews_insert_party`, revoke the insert grant, and let the route insert with the service role (or a service-role-only `create_review` function) after its checks. Add an RLS test that a browser insert fails with 42501.
- Status: fixed by T-098 (PR #200, hosted 2026-10-22).

**MED-2. Demo account passwords are in a public repo, and the seed script can load them into the hosted project.**
- Where: `scripts/seed-data.ts:64-65` (`DEMO_CHEF_PASSWORD`, `DEMO_CUSTOMER_PASSWORD`), used by `scripts/seed.ts:180,205` including `--hosted`.
- Failure: after a deploy with hosted seed data, anyone who reads the repo can sign in as a demo chef. If a real visitor books that chef and it is accepted, the attacker sees the visitor's phone and address. A demo customer login allows reviews and reports under that name. (The admin password comes from the environment and is safe.)
- Fix: for `--hosted`, take demo passwords from environment variables or generate them and print them once; keep the constants for `--local` only.
- Status: fixed by T-099 (PR #202). Re-seeding hosted with the new variables is a separate step for Jimmy.

**MED-3. No security headers (no frame protection, no CSP).**
- Where: `next.config.ts:3-14` has no `headers()`; there is no `vercel.json`; `src/proxy.ts` adds none.
- Failure: once deployed, a hostile site can frame the app and trick a signed-in admin into clicking Approve or Reject, or a chef into Accept (clickjacking). No CSP means no second line of defence against a future XSS bug. Next.js also sends `X-Powered-By`.
- Fix: `headers()` with `Content-Security-Policy` (`frame-ancestors 'none'`, self, the Supabase URL over https and wss, OpenStreetMap tiles), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `poweredByHeader: false`; a Playwright check on the response headers.
- Status: partly fixed by T-100 (PR #204): framing is blocked; injected inline script is not (`script-src 'unsafe-inline'`, no nonce).

**MED-4. Public text people write about themselves is not checked for contact details (product rule).**
- Where: display name (`src/app/api/me/route.ts:24`, chef copy at 34-41), chef bio (`src/lib/server/chef-application.ts`), dish name and description (`src/lib/server/dishes.ts`). `findContactDetails` runs only on messages, decline/cancel/change reasons and customer reviews.
- Failure: an approved chef sets their display name to "Anna 4165550199" or puts an email in the bio or a dish description; it shows on search cards and the chef page, so customers can book off the platform. A customer can put a phone number in their display name, which the chef sees on a request.
- Fix (Jimmy decides): run `findContactDetails` on these fields with 422 `CONTACT_DETAILS_NOT_ALLOWED`, or record it as a known limit.
- Status: fixed by T-101 (PR #205, D-147, hosted 2026-10-22). Text saved before T-101 is not re-checked.

## LOW

**LOW-1. A party can file problem reports straight to the database.** `20261007221002_core_rls.sql:204` and `20261025100000_decide_booking_id_drop_admin_note.sql:10-17`. A direct insert skips the route's rate limit, `hasUnsafeText`, the T-089 empty-text rule and the `client_id` retry key. Only admins read reports, so the impact is spam or odd text in the admin queue. Fix: make the route the only writer, as in MED-1.

Status: fixed by T-098 (PR #200).

**LOW-2. The chef can read the customer's allergy and dietary notes on every booking indefinitely, even after decline, cancel or expiry.** `20261007221002_core_rls.sql:335-336` (`intake_forms_select_party` uses `is_booking_party` only). Intake notes are not contact-filtered (`src/lib/domain/bookingRequest.ts:178` checks unsafe characters only). The spec needs the chef to see the form before accepting, not afterwards forever. Fix (Jimmy decides): limit the chef's read to `requested` and the accepted statuses (or the D-52 window) and contact-filter the notes, or record it as a limit.

Status: fixed by T-101 (PR #205, D-148).

**LOW-3. Signing up directly with Supabase Auth skips the app's sign-up rules.** `20261007221001_core_schema.sql:99-115` (`handle_new_user` only trims and cuts `display_name` to 80 characters) and `supabase/config.toml:177` (`enable_signup = true`) and `:183` (minimum password length 6). A direct `/auth/v1/signup` call allows a 6-character password and a display name with bidi, invisible-only text or a phone number. Fix: apply the same rules in the trigger and set the minimum password length to 8 locally and on hosted; consider leaked-password protection on hosted.

Status: fixed by T-102 (PR #207); the hosted minimum password length is Jimmy's dashboard step.

**LOW-4. Login and sign-up rate limits trust a header the client controls.** `src/lib/api/request.ts:79-84` uses the first `x-forwarded-for` value (`src/app/api/auth/login/route.ts:23`, `signup/route.ts:14`). A new value per request resets the limit. The limiter is also in-memory per instance (`rate-limit.ts:1-8`, a known placeholder). Fix: use the platform's client IP on Vercel and add an email-only key, or move limits to the database.

Status: fixed by T-102 (PR #207); the limiter is still in memory per instance.

**LOW-5. Profile and dish photos can be replaced after admin approval, and public photo buckets accept uploads from any account.** `20261007221003_storage_buckets.sql:14-15` and `:75-96`. A chef can overwrite an approved photo in place; any customer can upload up to 5 MB per file into their own folder of `profile-photos` (free public image hosting); only the declared MIME type is checked. (Kitchen photos were already fixed in `20261008150000`.) Fix: insert-only for owners with a new path per file, optionally send changed public photos back for review, and limit `profile-photos` uploads to chefs if customers never show a photo.

Status: fixed by T-102 (PR #207, hosted 2026-10-22).

**LOW-6. Database error messages go to the server log.** `src/lib/api/errors.ts:76-79` logs `e.message`; routes such as `src/app/api/me/phone/route.ts:33,44,58` and `address/route.ts:32,44` pass Supabase messages into it. Unique-violation messages can name constraints and sometimes key values (hashes). Nothing reaches a response body. Fix: log `error.code` and a fixed label in the private-data routes.

Status: partly fixed by T-102 (PR #207): `/api/me*`, free trial, chef application and the caller lookup log label and code only; bookings, admin, groceries, messages and `removeObject` still log messages.

**LOW-7. `HASH_PEPPER` strength is not checked.** `src/lib/server/pepper.ts:4-7` checks only that it is not empty. With a short pepper the HMAC phone hashes are easy to brute-force (Canadian numbers are about 10^10 values). Fix: refuse a pepper shorter than 32 characters outside tests and document it in `.env.example`.

Status: fixed by T-102 (PR #207); the hosted seed check is T-109.

**LOW-8. Sign-up says when an email is already registered.** `src/app/api/auth/signup/route.ts:46-54,72-77` (409 `EMAIL_IN_USE`) lets anyone test whether an email has an account. Fix: accept for the prototype as a known limit, or answer the same way once email confirmation is on.

## INFO

1. Owners can read their own `phone_hash` and `address_hash` (`free_trial_claims_select_own`, `core_rls.sql:421-422`, and `profile_private_select_own`, `core_rls.sql:231-232`). Harmless while the pepper is strong and secret (LOW-7); a column grant without the hash columns would be tighter.
2. The admin can read every user's phone and address from the browser (`profile_private_select_admin`, `core_rls.sql:233-234`, and the admin policies on `booking_addresses` and `messages`). By design (D-95); one stolen admin session exposes everyone, so use a strong admin password and consider MFA on hosted.
3. Anyone can see which dates an approved chef is booked (`chef_booked_dates`, `chefs_booked_on`, `20261011100100_booking_api.sql:433-434`). Dates only, not who; intended (D-27).
4. The chat topic is not protected but the chat data is (`src/lib/chat/realtime.ts:47-62`). No Realtime Authorization policies exist, so anyone can broadcast on a `chat:<id>:…` topic, but the client listens only to `postgres_changes`, which RLS filters. Turn on private channels before adding broadcast or presence.
5. MOCK mode turns the page guards off (`src/lib/server/page-guard.ts:51`, `src/lib/api/client.ts:6`). If `NEXT_PUBLIC_API_MOCK=1` were set on a deployment, the UI would show fake data; API routes still check access. Consider failing the build when `VERCEL_ENV=production` and the flag is set.
6. CI is safe: `pull_request` (not `pull_request_target`), `permissions: contents: read`, no repo secrets, throwaway local keys. Third-party actions are pinned by tag; pinning by commit hash is stronger. Playwright failure reports on the public repo hold seed data only.
7. No production dependency vulnerabilities (`npm audit --omit=dev`: 0). The full audit shows 5 high findings in dev-only tooling (`braces`), not shipped.
8. The browser bundle cannot reach the secret key: it is read only in `src/lib/supabase/admin.ts` (`server-only`); the only `NEXT_PUBLIC_*` values are the URL, the publishable key and the mock flag; `.env*` is git-ignored except `.env.example`, which holds no values.
9. Local `supabase/config.toml` has email confirmations off (fine for the demo). Supabase's default PUBLIC execute cannot be removed per schema, but every later migration revokes execute explicitly (all 33 later functions checked).

## Done well

- Private data lives in separate tables (`profile_private`, `chef_private`, `booking_addresses`, `booking_kitchen_addresses`, `admin_decisions`) with no browser grant, or owner/admin reads only. Contact details come only through `get_booking_contact` inside the D-52 window.
- The database enforces access: RLS on every table; the browser can no longer write `messages`, `profiles`, `chefs`, `dishes` or `availability`; trigger guards stop role and moderation changes.
- Every API route checks access (`requireCaller`, role from the database, ownership). Booking routes answer 404 without revealing whether a booking exists. Every write needs `application/json` (CSRF protection). Unplanned errors become a generic 500 with no stack trace.
- Pending and rejected chefs stay hidden: search and chef pages filter on `status = 'approved'`, the database refuses bookings with non-approved chefs, and public reviews check visibility first.
- The free trial is enforced on the server and in the database: HMAC-SHA256 hashes with a server-only pepper, no raw values in rate-limit keys or logs, partial unique indexes on customer, phone hash and address hash.
- Every MOCK area is labelled in the UI: SMS, ID, food-handler, police and kitchen checks, payments, reimbursement.

## Not verified

- Hosted Auth settings: email confirmation, minimum password length, leaked-password protection, MFA.
- Whether hosted Storage settings and migrations match `main` (`npx supabase migration list --linked`).
- Vercel environment variables.
- RLS and API suites (CI only).
