# CookNeighbour API contract v1

Status: v1 (T-026), covers WO-2 (sign-up, phone, address) and WO-3 (chef application, admin chef queue, public chef basics). Later work orders extend it (search with distance, bookings, pricing, free trial, chat, reviews, reports). Implementations: T-028 (auth), T-031 and T-035 (chef and admin). Shared types: `src/lib/api/types.ts` (types only). If code and this page disagree, fix one of them in the same PR.

Everything involving SMS, ID, food-handler, kitchen and police checks is **MOCK**. Responses and UI must say so.

Items marked **ASSUMPTION** or **PROPOSED** are not requirements; they need a nod from the Planner or Jimmy.

## 1. Conventions

- Routes are Next.js Route Handlers under `src/app/api/`. JSON in, JSON out, `Content-Type: application/json`. Success responses are the bare response type (no envelope). Money is integer cents. Dates are ISO 8601 strings.
- **Session:** Supabase Auth email + password. The session lives in HttpOnly cookies set by `@supabase/ssr`; no tokens appear in request or response bodies. The browser never calls these routes with an `Authorization` header. **ASSUMPTION:** email confirmation is switched off on the hosted project for the demo, so sign-up returns a signed-in session (`signedIn: true`). If it is on, `signedIn` is false and the UI shows "check your email".
- **CSRF (ASSUMPTION):** state-changing routes require `Content-Type: application/json` (rejects plain form posts, 400 `BAD_REQUEST`) and rely on SameSite=Lax cookies. A stricter `Origin` check may be added in hardening (WO-8).
- **Error format** (every non-2xx):

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Check the highlighted fields.", "fields": { "postalCode": "Not a GTA postal code." } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, wrong content type |
| 401 | `UNAUTHENTICATED` | No valid session |
| 401 | `INVALID_CREDENTIALS` | Login failed (same message for unknown email and wrong password) |
| 403 | `FORBIDDEN` | Signed in but wrong role (or not allowed) |
| 404 | `NOT_FOUND` | Missing row, or a row the caller must not know exists |
| 409 | `EMAIL_IN_USE`, `PHONE_IN_USE`, `PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `INVALID_STATE`, `APPLICATION_INCOMPLETE` | State conflicts |
| 422 | `VALIDATION_FAILED` | Field errors in `fields` (keyed by request field names) |
| 429 | `RATE_LIMITED` | `retryAfterSeconds` plus `Retry-After` header |
| 500 | `INTERNAL` | Generic message only; details go to server logs, never the body |

- Error messages never contain secrets, hashes, other users' data, SQL or stack traces.
- Pagination: `?limit=` (default 20, max 50) and `?cursor=`; responses are `{ items, nextCursor }`. The cursor is opaque.
- Names in JSON are camelCase; the database uses snake_case. The route maps between them.

## 2. Authorization rules every route must follow (server-side)

Row-level security protects the browser path, but route handlers that use the **service role bypass RLS**, so these checks are mandatory in code and are what the Tester verifies.

1. **Identity from the session only.** Call `supabase.auth.getUser()` on the server client (it re-validates with Supabase). Never use `getSession()` for decisions. Never accept `userId`, `chefId` or `role` from the body, query or headers (except the `:id` of an admin route, which is checked against admin rights first).
2. **Role from the database**, not from JWT metadata or the request: read `profiles.role` for the caller. `user_metadata` is user-editable and must never be trusted for authorization.
3. **Prefer the user-scoped client** (publishable key + cookie) so RLS applies. Use the service-role client only for the operations marked "service" below, and only after steps 1 and 2 pass. The service-role module is `server-only` and never imported into client code.
4. **Admin routes** (`/api/admin/**`): first check `role = 'admin'`; otherwise 403 before any query. Unauthenticated is 401.
5. **Ownership:** chef routes act on the caller's own `chefs.profile_id` only. A path or body that names another chef's file or id is rejected (403 for a foreign path prefix).
6. **Whitelist columns.** Build the update object from the allowed fields of the request type; never spread the request body into an update. Moderation columns (`chefs.status`, `chef_home_enabled`, `rating_avg`, `review_count`, all `chef_private` check statuses and `reject_reason`) are written only by admin routes or the sign-up route, even though the database also guards them for clients.
7. **Storage paths:** a path is accepted only if it starts with `<caller id>/`, has no `..`, no leading `/`, and the object exists in the expected bucket (check with a service-role `list`/`info`, not trust). Stored paths are object names; the bucket is implied by the field.
8. **Private data never leaves in a list or public response:** no phone (full), hashes, address, documents, reject reason, check statuses in public routes. Hashes (`phone_hash`, `address_hash`) are never returned by any route, including to admin.
9. **Secrets:** `HASH_PEPPER` and the secret key are read only in server-only modules; never logged, never in error bodies.
10. **Validation** with a schema on every body and query before touching the database; reject unknown role values (`admin` can never be requested at sign-up).
11. **Status transitions** are checked against the current row inside the same request (e.g. approve only from `pending` or `rejected` as listed below), preferably as one conditional `update ... where status = ...` to avoid races.

## 3. Auth and own profile

### POST /api/auth/signup
- **Who:** anyone (anonymous). If already signed in: 409 `INVALID_STATE`.
- **Request:** `SignUpRequest` `{ email, password, role: "customer"|"chef", displayName }`
- **Response 201:** `SignUpResponse` `{ user: MeProfile, signedIn }`
- **Errors:** 422 (`email` invalid, `password` under 8 or over 72 characters, `role` not customer/chef, `displayName` empty or over 80), 409 `EMAIL_IN_USE`, 429.
- **Does:** `supabase.auth.signUp({ email, password, options: { data: { role, display_name } } })`. The only metadata keys sent are `role` and `display_name`. Trigger `handle_new_user` creates `profiles` and an empty `profile_private`. Metadata `role` other than `chef` becomes `customer`; `admin` is impossible. A missing display name becomes "New user" (never derived from the email).
  - **Chef (service):** also insert `chefs` (`status = 'pending'`, `display_name`, defaults) and `chef_private` (all statuses `not_started`). There is no client insert policy on these tables, so this must be the service role. Do it right after sign-up succeeds; if it fails, return 500 and leave the auth user (the next `GET /api/chef/application` must create the missing rows idempotently with `on conflict do nothing`).
- **Tables:** `auth.users`, `profiles`, `profile_private`, `chefs`, `chef_private`.
- **MUST check:** role value whitelisted; password never logged; response contains no tokens.
- **Rate limit:** 10 per hour per IP (**ASSUMPTION**, see section 9).
- Email enumeration: `EMAIL_IN_USE` is returned (**ASSUMPTION**, accepted for a prototype; a real launch should answer neutrally).

### POST /api/auth/login
- **Who:** anyone. **Request:** `LoginRequest`. **Response 200:** `LoginResponse`.
- **Errors:** 401 `INVALID_CREDENTIALS` (single message), 422, 429 (10 per 15 minutes per IP and email, **ASSUMPTION**).
- **Does:** `signInWithPassword`; session cookies set by the SSR client. **Tables:** `auth.users`, `profiles`.

### POST /api/auth/logout
- **Who:** signed in (a call without a session still returns 200 `{ ok: true }`). **Response:** `LogoutResponse`. Does `signOut()` and clears cookies.

### GET /api/me
- **Who:** any signed-in user, own data only. **Response 200:** `MeResponse` `{ profile, private, chef }`.
- `private.phoneMasked` is masked; full phone, `phone_hash`, `address_hash` are never returned. `chef` is `null` unless role is chef. `chef` is the summary part of the application (`ChefOwnSummary`).
- **Errors:** 401. **Tables:** `profiles`, `profile_private`, `chefs`. User-scoped client (RLS gives own rows only).

### PATCH /api/me
- **Who:** signed in, own profile. **Request:** `UpdateMeRequest` `{ displayName? }`. **Response:** `MeProfile`.
- **MUST:** only `display_name` is written (`role`, `country`, etc. ignored/rejected as unknown keys with 422). For a chef, also update `chefs.display_name` so the public name matches (service, same request).
- **Errors:** 401, 422. **Tables:** `profiles` (+ `chefs`).

## 4. Phone (MOCK SMS) and home address

Phone verification is simulated: no SMS is sent. The flow is real (submit, then verify) so the free-trial rule (WO-4) can rely on `phone_verified`.

### POST /api/me/phone
- **Who:** signed in (customer or chef), own record.
- **Request:** `PhoneSubmitRequest` `{ phone }`. **Response 200:** `PhoneSubmitResponse` `{ phoneMasked, mock: true, mockHint }`.
- **Errors:** 422 `phone` malformed or not Canadian (`+1` + 10 digits after normalization), 409 `PHONE_IN_USE` (see section 8), 429.
- **Does (service, `profile_private` has no client writes):** normalize to E.164 (PLAN.md A-3, `src/lib/domain/phone.ts`); compute `phone_hash` = SHA-256 with `HASH_PEPPER`; store `phone_e164`, `phone_hash`, set `phone_verified = false`. Resubmitting a different number resets verification.
- **Tables:** `profile_private`.
- **MUST check:** identity from session; hash computed server-side only; nothing about the code is stored (MOCK accepts any code); do not reveal who owns a number that is in use beyond `PHONE_IN_USE`.

### POST /api/me/phone/verify
- **Who:** signed in, own record. **Request:** `PhoneVerifyRequest` `{ code }`. **Response 200:** `PhoneVerifyResponse` `{ phoneVerified: true, mock: true }`.
- **MOCK rule:** in demo mode any string of exactly 6 digits (`/^\d{6}$/`) is accepted. Anything else is 422 `VALIDATION_FAILED` with `fields.code`. Controlled by a server constant `MOCK_SMS_ENABLED`; if it is ever false the route must refuse with 500 `INTERNAL` and not verify (real SMS is out of scope). Never claim the number was really verified; the UI shows a MOCK badge.
- **Errors:** 409 `PHONE_NOT_SUBMITTED` (no pending number), 409 `PHONE_IN_USE` (race with another account verifying the same hash), 422, 429.
- **Does (service):** set `phone_verified = true` where `profile_id = caller` and `phone_hash is not null`. Relies on the proposed unique index (section 8) to settle races.
- **Tables:** `profile_private`.

### PUT /api/me/address
- **Who:** signed in (customers need it for the free-trial check; chefs may also store one). **Request:** `AddressRequest` `{ line, city, postalCode }`. **Response 200:** `AddressResponse`.
- **Errors:** 422 (`line` 1 to 120 chars, `city` 1 to 80, `postalCode` malformed or `fields.postalCode = "Not a GTA postal code."` when its first 3 characters are not in `postal_prefixes`; A-1), 401.
- **Does (service):** normalize the postal code (uppercase, no space); look up the prefix in `postal_prefixes`; normalize the address and compute `address_hash` (A-2, peppered SHA-256); store `address_line`, `city`, `postal_code`, `postal_prefix`, `address_hash`.
- **Tables:** `postal_prefixes` (read), `profile_private`.
- **MUST check:** the address is written only to the caller's row. The route does not decide free-trial eligibility (WO-4 compares `address_hash` at booking time). The hash is not returned. The address is shown only to its owner here; the other party sees it only after acceptance through `get_booking_contact`.

## 5. Chef application (own)

All routes: role must be `chef` (else 403). Acts only on `chefs.profile_id = caller`.

### GET /api/chef/application
- **Response 200:** `ChefApplication` (includes own MOCK `checks`, `rejectReason`, document paths, kitchen address, acknowledgements, and `missing`). `missing` lists items still needed: `displayName`, `bio`, `photo`, `cuisines`, `languages`, `hourlyRate`, `servicePostalPrefix`, `locationOptions`, `idDocument`, `foodHandler`, `allergenAcknowledgement`, `phoneVerified`, `sampleDish` (see approve preconditions), and for chef's home: `kitchenAddress`, `kitchenPhotos`, `kitchenHygieneAcknowledgement`.
- **Tables:** `chefs`, `chef_private`, `profile_private` (phone flag), `dishes` (count). Creates missing `chefs`/`chef_private` rows idempotently (service) if sign-up was interrupted.

### PATCH /api/chef/application
- **Request:** `UpdateChefApplicationRequest` (all fields optional). **Response 200:** `ChefApplication`.
- **Validation:** `bio` up to 2000; `cuisines` and `languages` 1 to 10 entries each, trimmed, 1 to 40 chars (**ASSUMPTION:** free text now; a fixed list may come later); `hourlyRateCents` integer 500 to 20000 (**ASSUMPTION** bounds, DB only requires > 0); `servicePostalPrefix` must exist in `postal_prefixes`; `serviceRadiusKm` 1 to 200; `locationOptions` non-empty subset of `customer_home`, `chef_home`; `kitchenAddress.postalCode` must be a GTA postal code; acknowledgements accept only `true`.
- **Does:** user-scoped client update on `chefs` (public fields) and `chef_private` (kitchen address, acknowledgement timestamps set by the server clock). Editing kitchen address or photos makes the database reset the kitchen MOCK status to `pending` and set `chef_home_enabled = false`; the response shows this.
- **MUST check:** whitelist of columns (no `status`, `chefHomeEnabled`, ratings, checks, reject reason); role chef. `photoPath` must pass the storage path rule (prefix `<chefId>/`, object exists in `profile-photos`). Selecting `chef_home` in `locationOptions` is allowed, but the option only works for bookings once an admin sets `chef_home_enabled` (trigger on bookings enforces it).
- **Errors:** 401, 403, 422, 409 `INVALID_STATE` if the chef is `rejected` and tries to edit (they must be reopened by `POST /api/chef/application/submit`, see below; **ASSUMPTION:** rejected chefs may edit and resubmit once).

### Document upload flow (ID, food handler, kitchen photos)
1. The browser uploads the file **directly to Supabase Storage** with the user session (`supabase.storage.from(bucket).upload(path, file)`). RLS lets a user with role chef write only under `<own uid>/`.
   - `id_document` and `food_handler`: bucket `chef-documents`, JPEG/PNG/PDF, 10 MB. Path: `<chefId>/id-<uuid>.<ext>` and `<chefId>/food-handler-<uuid>.<ext>`. Only admin can read these files back (the chef cannot).
   - `kitchen_photo`: bucket `kitchen-photos` (private), JPEG/PNG/WebP, 5 MB. Path: `<chefId>/kitchen-<uuid>.<ext>`.
   - Profile photo: bucket `profile-photos` (public URL, no listing), path `<chefId>/photo-<uuid>.<ext>`, then set `photoPath` via PATCH. Dish photos use `dish-photos` (WO-3 dishes, contract v1.1).
   - Use a fresh uuid per upload; do not overwrite (the chef has no update right on `chef-documents`).
2. The browser then registers the path with the route below. Uploading alone changes nothing in the application.

### POST /api/chef/application/documents
- **Request:** `RegisterDocumentRequest` `{ kind, path }`. **Response 200:** `RegisterDocumentResponse`.
- **Does:** sets `chef_private.id_document_path` / `food_handler_path`, or appends to `kitchen_photo_paths` (max 10, **ASSUMPTION**). Changing an already-verified document or the kitchen photos makes the DB reset the matching MOCK status to `pending` (and disable chef's-home).
- **MUST check:** role chef; path starts with `<caller id>/`, no `..`, matches the kind's file pattern; object exists in the right bucket (service-role storage `info`); the path was not already registered by someone else (it cannot be: prefix is the owner id). Database trigger `chef_private_check_paths` is the backstop.
- **Errors:** 403 (foreign prefix), 404 (object not uploaded), 422 (bad kind/path), 401.
- **Tables:** `chef_private`; storage `chef-documents`, `kitchen-photos`.

### DELETE /api/chef/application/documents
- **Request:** `RemoveDocumentRequest` `{ kind: "kitchen_photo", path }` (only kitchen photos are removable by the chef; replacing an ID or food-handler document is done by registering a new one). **Response 200:** `RegisterDocumentResponse`. Same checks as above; removes the path from the array and, with the service role, deletes the object. Resets kitchen check as for any kitchen change.

### POST /api/chef/application/submit
- **Request:** none. **Response 200:** `SubmitApplicationResponse` `{ application, mock: true }`.
- **Does (service, because check statuses are moderation columns):** requires `missing` to be empty; sets `id_check_status`, `food_handler_status` to `pending`, and `kitchen_status` to `pending` when `chef_home` is selected; if the chef was `rejected`, sets status back to `pending` and clears `reject_reason`. MOCK: nothing is verified automatically; an admin sets results (section 6).
- **Errors:** 409 `APPLICATION_INCOMPLETE` with `missing`, 409 `INVALID_STATE` if already `approved`, 401, 403.

## 6. Admin chef queue (all checks are MOCK)

All routes: caller must be `admin` (check 4 in section 2). Writes use the service role after that check. Every change should append a line to the server log with the admin id and chef id (no document content).

### GET /api/admin/chefs
- **Query:** `status` (`pending` default, `approved`, `rejected`, `all`), `limit`, `cursor`. **Response:** `AdminChefListResponse`. Newest first (`created_at`).
- **Tables:** `chefs`, `chef_private` (checks).

### GET /api/admin/chefs/:id
- **Response:** `AdminChefDetail` `{ application, email, documents }`. `documents` are 300-second signed URLs (service role `createSignedUrl`) for ID, food handler (`chef-documents`) and kitchen photos (`kitchen-photos`).
- **MUST:** admin only; URLs never cached or logged; hashes not returned. 404 if chef id unknown. **Tables:** `chefs`, `chef_private`, `auth.users` (email), storage.

### POST /api/admin/chefs/:id/approve
- **Request:** none. **Response:** `AdminChefActionResponse`.
- **Preconditions (else 409 `APPLICATION_INCOMPLETE` + `missing`):** status is `pending` (a `rejected` chef must resubmit first; approved is 409 `INVALID_STATE`); display name, bio, photo, at least one cuisine and language, hourly rate, service prefix, `allergen_ack_at`, ID and food-handler documents present; the chef's phone is verified (**ASSUMPTION**); at least one active dish with a photo (the "sample menu with photos", CLAUDE.md 6.7; depends on WO-3 dishes). MOCK `id_check_status` and `food_handler_status` must be `verified` (**ASSUMPTION**, the admin sets them first via `/checks`; a demo shortcut may be added later).
- **Does:** `chefs.status = 'approved'`, clear `reject_reason`, add a row to `notifications` for the chef ("approved"). Does **not** enable chef's-home (see kitchen review).
- **Tables:** `chefs`, `chef_private`, `dishes`, `profile_private`, `notifications`.

### POST /api/admin/chefs/:id/reject
- **Request:** `RejectChefRequest` `{ reason }` (3 to 500 chars). **Response:** `AdminChefActionResponse`.
- **Does:** `status = 'rejected'`, `reject_reason = reason`, notification to the chef with the reason. Allowed from `pending` or `approved` (an approved chef disappears from search immediately). **Errors:** 422 `fields.reason`, 409 `INVALID_STATE` if already `rejected`.
- Pending and rejected chefs never appear in public routes (RLS plus the route filter).

### PATCH /api/admin/chefs/:id/checks
- **Request:** `AdminChecksRequest` `{ idCheck?, foodHandlerCheck?, policeCheck? }`. **Response:** `AdminChefActionResponse`.
- **MOCK:** these are simulated outcomes recorded by the admin, not real checks. Writes the matching `chef_private` status columns. At least one field required (422). The UI labels each with MOCK.

### POST /api/admin/chefs/:id/kitchen-review
- **Request:** `KitchenReviewRequest` `{ decision, note? }`. **Response:** `AdminChefActionResponse`.
- **Does:** `approve` requires `chef_home` in `location_options`, kitchen address, at least 1 kitchen photo, `kitchen_hygiene_ack_at`, else 409 `APPLICATION_INCOMPLETE`; then `kitchen_status = 'verified'` and `chef_home_enabled = true`. `reject` (note required) sets `kitchen_status = 'failed'` and `chef_home_enabled = false`, and notifies the chef. MOCK.
- **Tables:** `chef_private`, `chefs`, `notifications`.

Admin lists of bookings, reports and free-trial blocks come in WO-4/WO-5 (contract v1.1).

## 7. Public chef listing (read only, no auth needed)

User-scoped (anon-capable) client only; RLS returns approved chefs. No service role.

### GET /api/chefs
- **Query:** `PublicChefListQuery` `cuisine`, `language`, `prefix` (3-char GTA prefix), `limit`, `cursor`. **Response:** `PublicChefListResponse`. Sorted by `rating_avg` desc then name (**no distance sort yet**; distance and the full search are WO-4).
- **MUST** add `.eq('status','approved')` to the query. RLS alone is not enough here: a signed-in chef also passes the "own row" and "booking counterparty" policies, so without the filter a chef's own pending row, or a shared-booking chef, could appear in the public list. Includes `chefHomeEnabled` and `locationOptions` so the UI can show the choice. Contains no kitchen address, documents, statuses, phone or email.
- **Errors:** 422 (bad `prefix`, `limit`). **Tables:** `chefs`, `postal_prefixes` (city).

### GET /api/chefs/:id
- **Response:** `PublicChef`. 404 for unknown, pending or rejected (same response, so existence is not leaked). **Tables:** `chefs`. Dishes and availability come in contract v1.1.

### GET /api/reference/postal-prefixes
- **Response:** `PostalPrefixListResponse`. Public reference data for the city picker and client-side hints; cacheable. **Tables:** `postal_prefixes`.

## 8. Proposed rule: phone uniqueness across accounts (for T-028)

CLAUDE.md section 10 lists "duplicate or malformed phone numbers". The free trial already blocks a second claim by phone hash, but nothing stops two accounts from holding the same phone.

**PROPOSED (needs Planner confirmation, then T-028 adds a migration):** a **verified** phone hash may belong to only one account.
- Migration: `create unique index profile_private_phone_hash_verified on public.profile_private (phone_hash) where phone_verified;` (partial, so an unverified number does not block the real owner).
- `POST /api/me/phone` returns 409 `PHONE_IN_USE` if another account already has that hash with `phone_verified = true` (pre-check). `POST /api/me/phone/verify` relies on the unique index and maps the unique-violation (SQLSTATE 23505) to 409 `PHONE_IN_USE`.
- Same account resubmitting its own number is fine (idempotent).
- Risks: reveals that a number is registered (enumeration); mitigated only by rate limits in this prototype. A user cannot free their number except by contacting an admin or deleting the account (account deletion is out of scope). Cheap-SIM evasion still exists (README known limit).
- With MOCK SMS anyone can "verify" any number, so a malicious user can squat someone else's number in the demo. Accepted for a prototype; real SMS removes this.

## 9. Rate-limit expectations (MOCK verify and sign-up)

**ASSUMPTION** (values are placeholders until Q-11 is decided in WO-4; prototype uses an in-memory or Postgres-backed counter, and in-memory limits on serverless are best effort only):
- `POST /api/me/phone`: 5 per hour per account and 10 per hour per IP.
- `POST /api/me/phone/verify`: 10 per hour per account. Although any 6 digits pass in MOCK mode, the limit is enforced now so the real-SMS swap does not change behaviour.
- `POST /api/auth/signup`: 10 per hour per IP. `POST /api/auth/login`: 10 per 15 minutes per IP and email.
- Exceeded: 429 `RATE_LIMITED` with `retryAfterSeconds` and `Retry-After`. Counters never store the raw phone number or code.

## 10. Route and table summary

| Route | Role | Client | Writes via |
|---|---|---|---|
| POST /api/auth/signup | anon | anon + service (chef rows) | service for `chefs`, `chef_private` |
| POST /api/auth/login, /logout | anon / any | SSR client | Supabase Auth |
| GET, PATCH /api/me | any signed in | user-scoped (+ service for chef display name) | user / service |
| POST /api/me/phone, /phone/verify | customer, chef | service for `profile_private` | service |
| PUT /api/me/address | customer, chef | service | service |
| GET, PATCH /api/chef/application | chef | user-scoped | RLS + guard triggers |
| POST, DELETE /api/chef/application/documents | chef | user-scoped + service (storage info/delete) | RLS |
| POST /api/chef/application/submit | chef | service | service (check statuses) |
| /api/admin/chefs/** | admin | service after admin check | service |
| GET /api/chefs, /api/chefs/:id, /api/reference/postal-prefixes | anyone | anon-capable user-scoped | none |

## 11. Not in v1 (planned)

Dishes and availability CRUD (WO-3, v1.1), search with distance, bookings, estimate, free trial, receipts (WO-4), messaging, reviews, reports, notifications read API (WO-5), admin booking/report/free-trial lists. Dishes and availability can already be written by the chef's browser under RLS; a route contract is added when Frontend needs one.

## 12. Open points for the Planner

1. Confirm the phone uniqueness rule (section 8) so T-028 adds the migration.
2. Approve preconditions (phone verified, sample dish, MOCK checks verified before approve) are assumptions beyond CLAUDE.md 6.7.
3. Rejected chefs editing and resubmitting (section 5) is an assumption.
4. Cuisine and language lists are free text for now; a fixed list is a product choice.
5. Rate-limit numbers (section 9) are placeholders.
