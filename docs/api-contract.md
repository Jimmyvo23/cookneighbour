# CookNeighbour API contract v1

Status: v1.4 (T-042), covers WO-2 (sign-up, phone, address) and WO-3 (chef application, dishes, availability, admin chef queue, public chef basics). v1.1 adds sections 5A (dishes) and 5B (availability) and moves dishes and availability to routes only; changes are marked **(T-032)**. v1.2 (T-035) replaces section 6 with the exact behaviour of the six admin chef-queue routes (order of checks, filters, errors, atomic decisions); changes are marked **(T-035)**. v1.3 (T-039) replaces section 7 with the real search (filters, distance sort, chef detail with dishes and bookable dates, postal-prefix list); changes are marked **(T-039)**. v1.3.1 (T-061) applies decisions D-21 (admin MOCK-check rules), D-24 (allergy synonyms) and D-25 (unbookable chef page is a 404); changes are marked **(T-061)**. v1.4 (T-042) adds section 7A (bookings: estimate, create, list, detail, accept, decline, expiry; proposed shapes for the T-063 routes), the booking error codes, the `expired` status, the 409 `DATE_BOOKED` on clearing a booked date (5B), tomorrow as the first bookable day and booked dates removed from the public chef page and search (7, D-27, A-19), the D-31 synonym filter, and the 11A notes; changes are marked **(T-042)**. Later work orders extend it (grocery receipts, chat, reviews, reports). Implementations: T-028 (auth), T-031 (chef application, implemented and clarified; changes are marked **(T-031)**), T-035 (admin). Shared types: `src/lib/api/types.ts` (types only). If code and this page disagree, fix one of them in the same PR.

Everything involving SMS, ID, food-handler, kitchen and police checks is **MOCK**. Responses and UI must say so. In practice: `POST /api/chef/application/submit` carries `mock: true`; the other chef responses return `checks` as plain statuses with no flag in the JSON, so **the UI must label every check status MOCK** (T-033, T-036). The code that writes a check status is commented MOCK.

Items marked **ASSUMPTION** or **PROPOSED** are not requirements; they need a nod from the Planner or Jimmy.

## 1. Conventions

- Routes are Next.js Route Handlers under `src/app/api/`. JSON in, JSON out, `Content-Type: application/json`. Success responses are the bare response type (no envelope). Money is integer cents. Dates are ISO 8601 strings.
- **Session:** Supabase Auth email + password. The session lives in HttpOnly cookies set by `@supabase/ssr`; no tokens appear in request or response bodies. The browser never calls these routes with an `Authorization` header. **ASSUMPTION:** email confirmation is switched off on the hosted project for the demo, so sign-up returns a signed-in session (`signedIn: true`). If it is on, `signedIn` is false and the UI shows "check your email".
- **CSRF (ASSUMPTION):** every state-changing request (POST, PUT, PATCH, DELETE), **including login and logout** and body-less actions such as approve and submit, must send `Content-Type: application/json`. The server compares the media type exactly (`application/json`, optionally with a `charset` parameter; `text/plain`, `multipart/*`, `application/x-www-form-urlencoded` and a missing header are all rejected with 400 `BAD_REQUEST`) and relies on SameSite=Lax cookies. Frontend: use one fetch helper that always sets the header. A stricter `Origin` check may be added in hardening (WO-8).
- **Error format** (every non-2xx):

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Check the highlighted fields.", "fields": { "postalCode": "Not a GTA postal code." } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, content type is not exactly `application/json` |
| 401 | `UNAUTHENTICATED` | No valid session |
| 401 | `INVALID_CREDENTIALS` | Login failed (same message for unknown email and wrong password) |
| 403 | `FORBIDDEN` | Signed in but wrong role (or not allowed) |
| 404 | `NOT_FOUND` | Missing row, or a row the caller must not know exists |
| 409 | `EMAIL_IN_USE`, `PHONE_IN_USE`, `PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `ADDRESS_NOT_SET`, `FREE_TRIAL_USED`, `INVALID_STATE`, `APPLICATION_INCOMPLETE`, **(T-042)** `DOUBLE_BOOKED`, `TOO_MANY_OPEN_REQUESTS`, `REQUEST_EXPIRED`, `DATE_BOOKED` | State conflicts. `FREE_TRIAL_USED` and `ADDRESS_NOT_SET` come from the free-trial server functions (T-038, section 11A); `FREE_TRIAL_USED` is deliberately generic. `APPLICATION_INCOMPLETE` always carries `error.missing` (list of item names, same vocabulary as `ChefApplication.missing`). **(T-042)** `DOUBLE_BOOKED` (the chef already has an active booking on a requested date, carries `error.issues`), `TOO_MANY_OPEN_REQUESTS` (D-28), `REQUEST_EXPIRED` (answering a request past its expiry) and `DATE_BOOKED` (the chef clears a date with an open booking, carries `error.dates`) are described in section 7A and 5B. `INVALID_STATE` also covers a stale admin review (stored file or kitchen data changed since the admin viewed it), an 11th kitchen photo, and a chef application write that lost 12 races (T-031) |
| 422 | `VALIDATION_FAILED` | Field errors in `fields` (keyed by request field names; nested keys use dots, for example `intake.allergies`). **(T-042)** A booking request also carries `error.issues` (domain issue codes, section 7A) |
| 429 | `RATE_LIMITED` | `retryAfterSeconds` plus `Retry-After` header |
| 500 | `INTERNAL` | Generic message only; details go to server logs, never the body |

- Error messages never contain secrets, hashes, other users' data, SQL or stack traces.
- Pagination: `?limit=` (default 20, max 50) and `?cursor=`; responses are `{ items, nextCursor }`. The cursor is opaque.
- Names in JSON are camelCase; the database uses snake_case. The route maps between them.

## 2. Authorization rules every route must follow (server-side)

Row-level security protects the browser path, but route handlers that use the **service role bypass RLS**, so these checks are mandatory in code and are what the Tester verifies.

1. **Identity from the session only.** Call `supabase.auth.getUser()` on the server client (it re-validates with Supabase). Never use `getSession()` for decisions. Never accept `userId`, `chefId` or `role` from the body, query or headers (except the `:id` of an admin route, which is checked against admin rights first).
2. **Role from the database**, not from JWT metadata or the request: read `profiles.role` for the caller. `user_metadata` is user-editable and must never be trusted for authorization.
3. **Prefer the user-scoped client** (publishable key + cookie) for reads so RLS applies. Use the service-role client for the writes marked "service" below, and only after steps 1 and 2 pass. The service-role module is `server-only` and never imported into client code.
   - **Routes are the only writers of `chefs` and `chef_private` (decision B2 option a, D-12).** The browser must not update these tables directly, because direct updates would skip the checks below (acknowledgement timestamps from the server clock, hourly-rate bounds, photo and document path ownership, registered and existing objects). **The T-028 migration (applied)** revoked client `UPDATE` on `public.chefs` and `public.chef_private`, dropped the own-row update policies (`chefs_update_own`, `chef_private_update_own`), and added folder checks so a stored `dishes.photo_path` and `chefs.photo_path` must start with the owner's own folder (`<chefId>/`). **(T-032, decision)** Dishes and availability are routes-only too: the T-032 migration revoked client `INSERT`, `UPDATE` and `DELETE` on `public.dishes` and `public.availability` and dropped their own-row write policies (select policies are unchanged), because bounds, unsafe-text rules, photo path ownership plus object existence, the past-date rule and the active-dish cap cannot be enforced from the browser. The `dishes.photo_path` folder check stays as a second line of defence. Photo **files** are still uploaded by the browser straight to Storage (bucket `dish-photos`, owner-writable by design, see `docs/data-model.md`).
4. **Admin routes** (`/api/admin/**`): first check `role = 'admin'`; otherwise 403 before any query. Unauthenticated is 401.
5. **Ownership:** chef routes act on the caller's own `chefs.profile_id` only. A path or body that names another chef's file or id is rejected (403 for a foreign path prefix).
6. **Whitelist columns.** Build the update object from the allowed fields of the request type; never spread the request body into an update. Moderation columns (`chefs.status`, `chef_home_enabled`, `rating_avg`, `review_count`, all `chef_private` check statuses and `reject_reason`) are written only by the admin routes, `POST /api/chef/application/submit` (sets statuses to `pending` and moves `rejected` to `pending`), the chef documents/PATCH routes (re-verification reset, see N1 below) and the sign-up route (initial rows). The database also guards them for clients.
   - **Re-verification reset is done by the routes (N1).** The database trigger `chef_private_reset_checks` fires only for user-scoped writes, so it will not fire for route writes (and clients can no longer write these tables at all, so it is inert). Therefore `PATCH /api/chef/application` and the documents routes must, in the same update: set `id_check_status` / `food_handler_status` back to `pending` when that document path **changes**; and when the kitchen photos (added or removed) or the kitchen address **change**, set `kitchen_status` back to `pending` and `chefs.chef_home_enabled = false`. **(T-031, Planner decision)** "Back to `pending`" applies to a `verified` check and also to a `failed` check (the chef has fixed what the admin failed); `not_started` and `pending` stay as they are. Registering the same path again, sending the same address again (compared after trimming and postal-code normalization) or sending the same photo set changes nothing, so it resets nothing. Removing `chef_home` from `locationOptions` does not touch `chef_home_enabled` or the kitchen check (bookings are already blocked because the location is no longer offered). Changing a document never touches the kitchen, and changing the kitchen never touches the documents. The chef can never write the police check. These resets are covered by route tests (`tests/api/chef-*.test.ts`) and by unit tests of the pure rules (`src/lib/domain/chef-application.test.ts`).
7. **Storage paths:** a path is accepted only if it is a string of at most 200 characters, contains no `..`, no backslash, no control character and no leading `/`, starts with `<caller id>/`, and the file name is `<prefix>-<uuid>.<ext>` for its kind, **all lower case** (the app generates these names, so `ID-...`, an upper-case uuid or `.PNG` is 422; **(T-031)** prefixes and extensions: ID `id-`, food handler `food-handler-` (jpg, jpeg, png, pdf); kitchen photo `kitchen-` and profile photo `photo-` (jpg, jpeg, png, webp)); and the object exists in the expected bucket (service-role storage `exists`, not trust). Stored paths are object names; the bucket is implied by the field. Answers: malformed path or name 422 (`fields.path`, or the request's own field name), a folder other than the caller's 403 **without contacting storage** (so another chef's files cannot be probed: an existing and a missing foreign file give the same answer), object not uploaded 404 on the documents route and 422 `fields.photoPath` on PATCH.
8. **Private data never leaves in a list or public response:** no phone (full), hashes, address, documents, reject reason, check statuses in public routes. Hashes (`phone_hash`, `address_hash`) are never returned by any route, including to admin.
9. **Secrets:** `HASH_PEPPER` and the secret key are read only in server-only modules; never logged, never in error bodies.
10. **Validation** with a schema on every body and query before touching the database; reject unknown role values (`admin` can never be requested at sign-up).
11. **Status transitions** are checked against the current row inside the same request (approve only from `pending`; reject from `pending` or `approved`; submit from `pending` or `rejected`), preferably as one conditional `update ... where status = ...` to avoid races.

## 3. Auth and own profile

### POST /api/auth/signup
- **Who:** anyone (anonymous). If already signed in: 409 `INVALID_STATE`.
- **Request:** `SignUpRequest` `{ email, password, role: "customer"|"chef", displayName }`
- **Response 201:** `SignUpResponse` `{ user: MeProfile, signedIn }`
- **Errors:** 422 (`email` invalid, `password` under 8 or over 72 characters, `role` not customer/chef, `displayName` empty, over 80, or containing control characters or lone surrogates), 409 `EMAIL_IN_USE`, 429.
- **Does:** `supabase.auth.signUp({ email, password, options: { data: { role, display_name } } })`. The only metadata keys sent are `role` and `display_name`. Trigger `handle_new_user` creates `profiles` and an empty `profile_private`. Metadata `role` other than `chef` becomes `customer`; `admin` is impossible. A missing display name becomes "New user" (never derived from the email).
  - **Chef (service):** also insert `chefs` (`status = 'pending'`, `display_name`, defaults) and `chef_private` (all statuses `not_started`). There is no client insert policy on these tables, so this must be the service role. Do it right after sign-up succeeds; if it fails, return 500 and leave the auth user (the next chef application request (any `/api/chef/application` route, T-031) creates the missing rows idempotently with `on conflict do nothing`).
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
- **MUST:** only `display_name` is written (`role`, `country`, etc. ignored/rejected as unknown keys with 422). `profiles.display_name` is the single source of truth. For a chef, the same route also writes the denormalized copy `chefs.display_name` (needed for the public listing) in the same request (service). `PATCH /api/chef/application` does not accept a display name.
- **Errors:** 401, 422 (`displayName` empty, over 80, or containing control characters or lone surrogates: `fields.displayName = "Remove control or invalid characters."`, same rule as the chef application text fields). **Tables:** `profiles` (+ `chefs` for chefs). Sign-up writes both with the same value.

## 4. Phone (MOCK SMS) and home address

Phone verification is simulated: no SMS is sent. The flow is real (submit, then verify) so the free-trial rule (WO-4) can rely on `phone_verified`.

### POST /api/me/phone
- **Who:** signed in (customer or chef), own record.
- **Request:** `PhoneSubmitRequest` `{ phone }`. **Response 200:** `PhoneSubmitResponse` `{ phoneMasked, mock: true, mockHint }`.
- **Errors:** 422 `phone` malformed or not Canadian (`+1` + 10 digits after normalization), 409 `PHONE_IN_USE` (see section 8), 429.
- **Does (service, `profile_private` has no client writes):** normalize to E.164 (PLAN.md A-3, `src/lib/domain/phone.ts`); compute `phone_hash` = HMAC-SHA256 keyed with `HASH_PEPPER` over the E.164 number (`src/lib/domain/hash.ts`, shared with the seed script); store `phone_e164`, `phone_hash`, set `phone_verified = false`. Resubmitting a different number resets verification; resubmitting the same number leaves its verified state alone (T-028 implementation note). Any signed-in role may call the phone and address routes (T-028: no role restriction was specified).
- **Tables:** `profile_private`.
- **MUST check:** identity from session; hash computed server-side only; nothing about the code is stored (MOCK accepts any code); do not reveal who owns a number that is in use beyond `PHONE_IN_USE`.

### POST /api/me/phone/verify
- **Who:** signed in, own record. **Request:** `PhoneVerifyRequest` `{ code }`. **Response 200:** `PhoneVerifyResponse` `{ phoneVerified: true, mock: true }`.
- **MOCK rule:** in demo mode any string of exactly 6 digits (`/^\d{6}$/`) is accepted. Anything else is 422 `VALIDATION_FAILED` with `fields.code`. Controlled by a server constant `MOCK_SMS_ENABLED`; if it is ever false the route must refuse with 500 `INTERNAL` and not verify (real SMS is out of scope). Never claim the number was really verified; the UI shows a MOCK badge.
- **Errors:** 409 `PHONE_NOT_SUBMITTED` (no pending number), 409 `PHONE_IN_USE` (race with another account verifying the same hash), 422, 429.
- **Does (service):** set `phone_verified = true` where `profile_id = caller` and `phone_hash is not null`. Relies on the unique index (section 8, decision D-11) to settle races.
- **Tables:** `profile_private`.

### PUT /api/me/address
- **Who:** signed in (customers need it for the free-trial check; chefs may also store one). **Request:** `AddressRequest` `{ line, city, postalCode }`. **Response 200:** `AddressResponse`.
- **Errors:** 422 (`line` 1 to 120 chars, `city` 1 to 80, and neither may contain control characters or lone surrogates: `fields.<key> = "Remove control or invalid characters."`, same rule as `displayName`; `postalCode` malformed or `fields.postalCode = "Not a GTA postal code."` when its first 3 characters are not in `postal_prefixes`; A-1), 401.
- **Does (service):** normalize the postal code (uppercase, no space); look up the prefix in `postal_prefixes`; normalize the address and compute `address_hash` (A-2 normalization in `src/lib/domain/address.ts`, HMAC-SHA256 with `HASH_PEPPER`); store `address_line`, `city`, `postal_code`, `postal_prefix`, `address_hash`.
- **Tables:** `postal_prefixes` (read), `profile_private`.
- **MUST check:** the address is written only to the caller's row. The route does not decide free-trial eligibility (WO-4 compares `address_hash` at booking time). The hash is not returned. The address is shown only to its owner here; the other party sees it only after acceptance through `get_booking_contact`.

## 5. Chef application (own)

All routes: 401 without a session; role must be `chef` (else 403, for customers and admins alike, decided from `profiles.role`, never from JWT metadata). Acts only on `chefs.profile_id = caller`. Order of checks: session (401), role (403), content type (400), body fields (422), then state (404, 409). Every response is `Cache-Control: no-store`. **(T-031)**

**Row repair (T-031, T-028 review N-e).** Every chef application route, not only GET, first makes sure the caller's `chefs` and `chef_private` rows exist and creates missing ones idempotently with the service role (`ON CONFLICT DO NOTHING`; `chefs.display_name` is copied from `profiles`, status `pending`, every check `not_started`). It runs only after the role check, so customers and admins never get chef rows.

**Concurrent writes (T-031).** The `chef_private` write of every route is conditional on `updated_at` still being the value that was read (optimistic lock). If an admin or a parallel request changed the row in between, the route reads again and rebuilds its change, including the re-verification reset, from the new values. After 12 lost races the route answers 409 `INVALID_STATE` ("changed while it was being saved, try again"). So registering several kitchen photos in parallel keeps all of them, and an admin's MOCK verdict that lands mid-request cannot leave a changed file `verified`. The `chefs` write of a kitchen change (`chef_home_enabled = false`) is made first; it only ever switches the option off.

### GET /api/chef/application
- **Response 200:** `ChefApplication`: own MOCK `checks`, `rejectReason`, document paths, kitchen address, acknowledgement times and `missing`.
- **`missing`** (type `ApplicationMissingItem[]`, empty means ready to submit), in this order:
  - `displayName` (blank, or the sign-up placeholder "New user"), `bio` (null or blank), `photo`, `cuisines`, `languages`, `hourlyRate`, `servicePostalPrefix`, `locationOptions` (never in practice: the database requires one);
  - `idDocument`, `foodHandler` (a path is registered; not that the check passed), `allergenAcknowledgement`;
  - `phoneVerified` (MOCK SMS), `sampleDish` (at least one **active** dish of this chef that has a photo, CLAUDE.md 6.7);
  - only when `chef_home` is in `locationOptions`: `kitchenAddress`, `kitchenPhotos` (at least one), `kitchenHygieneAcknowledgement`.
- **Tables:** `chefs`, `chef_private`, `profile_private` (phone flag), `dishes` (count). The reads use the user-scoped client (RLS); the response never contains hashes, the phone number, the email or internal columns.

### PATCH /api/chef/application
- **Request:** `UpdateChefApplicationRequest` (all fields optional; `{}` is a valid no-op). **Response 200:** `ChefApplication`.
- **Whitelist:** only the keys of the request type. Anything else, including `displayName` (use `PATCH /api/me`), `status`, `chefHomeEnabled`, ratings, `checks`, `rejectReason`, document paths, acknowledgement times, `chefId`, is 422 with `fields.<key> = "Unknown field."` and nothing is saved.
- **Validation (422, all errors reported at once, nothing saved on any error):**
  - `bio`: string up to 2000 after trimming, or `null`; a blank string is stored as `null`. **(T-031)** NUL and other control characters are refused (422), except line feed, carriage return and tab, so a bio may have several lines. A lone UTF-16 surrogate is refused in every text field below too (the database cannot store NUL or invalid Unicode, so this is a 422, never a 500).
  - `cuisines`, `languages`: array of 1 to 10 strings, each trimmed 1 to 40 characters without control characters (**ASSUMPTION:** free text now; a fixed list may come later). Entries that differ only in letter case are de-duplicated, keeping the first spelling.
  - `hourlyRateCents`: integer 500 to 20000 (**ASSUMPTION** bounds; the database only requires > 0).
  - `servicePostalPrefix`: 3 characters `A1A` (any case, trimmed, stored upper case) that exist in `postal_prefixes` (else "Not a GTA postal code area.").
  - `serviceRadiusKm`: integer 1 to 200.
  - `locationOptions`: non-empty, only `customer_home` and `chef_home`; duplicates removed.
  - `kitchenAddress`: object with exactly `line` (1 to 120), `city` (1 to 80), `postalCode` (a GTA postal code, stored normalized such as `L5B1A1`). Nested errors are keyed `kitchenAddress.line`, `kitchenAddress.city`, `kitchenAddress.postalCode`; a non-object is `kitchenAddress`. Allowed even when `chef_home` is not selected.
  - `acknowledgeAllergenStatement`, `acknowledgeKitchenHygiene`: only the boolean `true` (MOCK acknowledgement for the hygiene statement). The server clock sets the time; the client cannot send one. If already acknowledged, the **first** time is kept.
  - `photoPath`: `null` clears it; otherwise the storage path rule (section 2, rule 7) for bucket `profile-photos`, name `photo-<uuid>.<ext>`. 403 for a foreign folder (stops at once); 422 `fields.photoPath` for a bad name or an object that was never uploaded. Sending the photo that is already stored skips the storage check. The old object stays in Storage (the chef may delete it under RLS).
- **Does (service, after all checks):** updates `chefs` (public fields) and `chef_private` (kitchen address, acknowledgement times) and applies the N1 reset: a changed kitchen address sets `kitchen_status` back to `pending` (from `verified` or `failed`) and `chef_home_enabled = false`. The response shows the new state.
- **Allowed in every status.** A `pending` chef edits freely. A `rejected` chef edits while still `rejected` (the reason stays visible); `POST /api/chef/application/submit` sends it again and moves `rejected` to `pending` (Planner decision B3, no resubmit limit in v1). An `approved` chef who edits stays approved and public; changed documents or kitchen data go through the MOCK reset (N5, MOCK, acceptable). Note: an approved chef can also clear `bio` or `photoPath`; the listing then lacks them (open point 6).
- **Not atomic when it gives up (T-031, tester F2).** If the `chef_private` write loses 12 races in a row, the answer is 409 `INVALID_STATE` ("changed while it was being saved, try again"). The `chefs` columns of that request (bio, rate, cuisines, location options, photo and, for a kitchen change, the switch-off of `chef_home_enabled`) are written first and **may already be saved**; the `chef_private` columns (kitchen address and its reset, acknowledgement times) are not. Sending the same request again is safe: it is idempotent.
- **Errors:** 401, 403, 400, 422, 409 `INVALID_STATE` (only after repeated lost races).

### Document upload flow (ID, food handler, kitchen photos)
1. The browser uploads the file **directly to Supabase Storage** with the user session (`supabase.storage.from(bucket).upload(path, file)`). RLS lets a user with role chef write only under `<own uid>/`.
   - `id_document` and `food_handler`: bucket `chef-documents`, JPEG/PNG/PDF, 10 MB. Path: `<chefId>/id-<uuid>.<ext>` and `<chefId>/food-handler-<uuid>.<ext>`. Only admin can read these files back (the chef cannot).
   - `kitchen_photo`: bucket `kitchen-photos` (private), JPEG/PNG/WebP, 5 MB. Path: `<chefId>/kitchen-<uuid>.<ext>`. **(T-031, tester F3)** The chef can only **insert new objects** here: Storage RLS gives the chef no update and no delete on this bucket (migration `20261008150000_kitchen_photos_insert_only`), so a photo cannot be changed in place under a verified check. Replace a photo by uploading a new file and registering it; remove one with `DELETE /api/chef/application/documents`, which deletes the object with the service role.
   - Profile photo: bucket `profile-photos` (public URL, no listing), path `<chefId>/photo-<uuid>.<ext>`, then set `photoPath` via PATCH. Dish photos use `dish-photos`, path `<chefId>/dish-<uuid>.<ext>` (section 5A); the browser uploads, then sends `photoPath` to the dish routes.
   - Use a fresh uuid per upload (lower case, e.g. `crypto.randomUUID()`); do not overwrite (the chef has no update right on `chef-documents` or `kitchen-photos`). The file name **must** follow these patterns, in lower case, or the route answers 422. **(T-031)**
2. The browser then registers the path with the route below. Uploading alone changes nothing in the application.

### POST /api/chef/application/documents
- **Request:** `RegisterDocumentRequest` `{ kind, path }` (no other keys). **Response 200:** `RegisterDocumentResponse` `{ application }`.
- **Does (service):** sets `chef_private.id_document_path` / `food_handler_path` (a new path replaces the old one), or appends to `kitchen_photo_paths`. The route applies the re-verification reset itself (section 2, N1): a changed ID or food-handler path sets that MOCK check back to `pending` if it was `verified` or `failed`; a new kitchen photo does the same to `kitchen_status` and sets `chef_home_enabled = false`. A `not_started` or `pending` check is left alone (submit starts it). Registering a path that is already registered is a no-op that changes nothing (no reset, no storage call), so a retry is safe. The previous ID or food-handler object stays in Storage (admin records; see open point 7).
- **MUST check:** role chef; the path rule (section 2, rule 7); the object exists in the right bucket (service-role `exists`). The database trigger `chef_private_check_paths` is a backstop.
- **Errors:** 401, 403 (customer, admin, or a folder that is not the caller's), 404 `NOT_FOUND` (object not uploaded, or uploaded to the wrong bucket), 409 `INVALID_STATE` (an 11th kitchen photo: the limit is 10, **ASSUMPTION**; remove one first), 422 (`fields.kind` not one of the three kinds, `fields.path` missing or malformed, unknown key), 400 (content type).
- **Tables:** `chef_private`, `chefs` (chef's home switch); storage `chef-documents`, `kitchen-photos`.

### DELETE /api/chef/application/documents
- **Request:** `RemoveDocumentRequest` `{ kind: "kitchen_photo", path }` (only kitchen photos are removable by the chef; replacing an ID or food-handler document is done by registering a new one, so any other `kind` is 422 `fields.kind`). **Response 200:** `RegisterDocumentResponse`.
- **Does (service):** removes the path from `kitchen_photo_paths`, applies the same kitchen reset, then deletes the object (the chef cannot delete it from the browser, see the upload flow). The database is updated first, so a failed object delete only leaves an orphaned file (logged, not an error).
- **Checks:** the path rule (403 for a foreign folder, 422 for a malformed path). The path must be **registered** for this chef: a path that is not in the list is 404 and **no object is deleted**, even if the file exists in the chef's folder. The object does not need to exist, so a dangling registration can be cleaned up.
- **Errors:** 401, 403, 404, 422, 400.

### POST /api/chef/application/submit
- **Request:** none (a body is ignored; the request still needs `Content-Type: application/json`). **Response 200:** `SubmitApplicationResponse` `{ application, mock: true }`.
- **Does (service, because check statuses are moderation columns):** requires `missing` to be empty. Moves only checks that are `not_started` or `failed` to `pending` (`id_check_status`, `food_handler_status`, and `kitchen_status` when `chef_home` is selected); **never overwrites `verified` or an already `pending` check** (N2) and never touches the police check or `chef_home_enabled`. If the chef was `rejected`, sets status to `pending` and clears `reject_reason` (B3). If the chef is already `pending` with nothing to move, it is an idempotent no-op returning 200 (nothing is written). MOCK: nothing is verified automatically; an admin sets results (section 6).
- **Errors:** 409 `APPLICATION_INCOMPLETE` with `error.missing`, 409 `INVALID_STATE` if already `approved` (checked first, even when items are missing), 401, 403, 400.

## 5A. Dishes (own) **(T-032)**

All routes: 401 without a session; role `chef` (else 403, decided from `profiles.role`); acts only on dishes whose `chef_id` is the caller. Order of checks: session (401), role (403), content type (400); then, for `PATCH`, the dish must exist and belong to the caller (404, even when the body is also invalid); then unknown keys (422, reported on their own); then a `photoPath` in another chef's folder (403); then field rules (422, all at once) and, for a new `photoPath`, the uploaded-object check (422); then state (409). `Cache-Control: no-store`. They use the same gate as section 5 (`requireChef`), including the idempotent row repair. A chef of **any** status (`pending`, `approved`, `rejected`) manages dishes, because a sample dish with a photo is part of the application (`missing.sampleDish` in section 5 becomes satisfiable by `POST /api/chef/dishes` with a `photoPath`). Customers and anonymous visitors see only **active** dishes of **approved** chefs (RLS `dishes_select_public`); the customer-facing read route comes with the public chef detail in WO-4.

`Dish` (response):

```json
{ "id": "uuid", "name": "Pho bo", "photoPath": "<chefId>/dish-<uuid>.jpg", "description": "Slow-cooked beef broth.", "cuisine": "Vietnamese", "cookMinutes": 180, "ingredientCostCents": 2500, "servings": 4, "allergens": ["soy", "wheat"], "shelfLifeDays": 2, "isActive": true, "currency": "CAD", "createdAt": "ISO", "updatedAt": "ISO" }
```

Field rules (cook time, cost, servings and shelf life confirmed as **Decision D-16 (Jimmy, 2026-10-08)**; the cuisine and allergen bounds are still assumptions; the name and description lengths are database checks; all live in `src/lib/domain/dishes.ts`):

| Field | Rule |
|---|---|
| `name` | required on create; 1 to 120 characters after trimming; no control characters or lone surrogates (`Fields.text` rule: "Remove control or invalid characters.") |
| `description` | optional; string up to 1000 after trimming or `null`; blank is stored as `null`; line feed, carriage return and tab are allowed (several lines), other control characters and lone surrogates are 422 |
| `cuisine` | required on create; 1 to 40 characters, no control characters (free text, like the chef's `cuisines`) |
| `cookMinutes` | required on create; integer 5 to 360 (360 = the 6 hour soft visit limit of CLAUDE.md 6.5, so no single dish is unbookable) |
| `ingredientCostCents` | optional, default 0; integer 0 to 50000 |
| `servings` | optional, default 1; integer 1 to 50 |
| `allergens` | optional, default `[]`; array of up to 14 **distinct** allergens (counted after duplicates are merged, so a ticked one typed again is fine; at most 50 raw entries are read), each trimmed 1 to 40 characters without control characters; stored **lower case**, de-duplicated, order kept (so the WO-4 intake-form conflict check can compare them; **(T-061, D-24)** that check treats synonyms and spellings of the picker allergens as equal, for example gluten and wheat, dairy, lactose and milk, shellfish, shrimp and crustaceans, nuts and peanuts, soya and soy, mollusks and molluscs, sulfites and sulphites, see `SYNONYM_GROUPS` in `src/lib/domain/allergy.ts`; it warns more often than strictly needed on purpose). Free text; the UI offers a picker with the Canadian priority allergens |
| `shelfLifeDays` | optional, default 2 (A-7, kept by D-16); integer 0 to 7 (database check). The "eat by" date is visit date plus this value |
| `photoPath` | optional or `null`. Otherwise the storage path rule (section 2, rule 7) for bucket `dish-photos`, name `dish-<uuid>.<ext>` (jpg, jpeg, png, webp), in the caller's own folder. A foreign folder is 403 (stops at once, no storage call); a malformed name or an object that was never uploaded is 422 `fields.photoPath`. Sending the photo already stored skips the storage check. The old object stays in Storage |
| `isActive` | PATCH only; boolean |

Unknown keys are 422 `fields.<key> = "Unknown field."` (this includes `id`, `chefId`, `currency`, `createdAt`). Unknown keys are reported on their own, before any other body check; after that, all field errors are reported at once. Nothing is saved on any error.

### GET /api/chef/dishes
- **Response 200:** `ChefDishListResponse` `{ items: Dish[] }`: all of the caller's dishes, active and inactive, newest first (`created_at` desc, then `id`). No pagination: a chef has at most 50 active dishes and inactive ones are few.

### POST /api/chef/dishes
- **Request:** `CreateDishRequest` (`name`, `cuisine`, `cookMinutes` required; the rest optional). **Response 201:** `Dish` (always created active).
- **Errors:** 401, 403, 400, 422, 409 `INVALID_STATE` when the chef already has 50 active dishes (limit: **Decision D-16 (Jimmy, 2026-10-08)**, enforced by a database trigger under an advisory lock, so parallel creates cannot pass the cap).
- **Does (service):** `chef_id` is always the caller; the insert is built from the whitelist.

### PATCH /api/chef/dishes/:id
- **Request:** `UpdateDishRequest`: any subset of the create fields plus `isActive`; `{}` is a valid no-op returning the dish. **Response 200:** `Dish`.
- **Deactivate** with `{ "isActive": false }`; **reactivate** with `{ "isActive": true }` (409 `INVALID_STATE` over the cap). There is deliberately no DELETE: a deactivated dish disappears from the public menu and from new bookings, while bookings that used it keep their snapshot (`booking_day_dishes`), and nothing is deleted (deleting data needs Jimmy's approval).
- **Ownership:** the update is one statement filtered by `id` **and** `chef_id = caller`. A dish that does not exist, belongs to another chef, or whose `:id` is not a uuid is 404 `NOT_FOUND` (the same answer, so other chefs' dishes cannot be probed).
- **Errors:** 401, 403, 400, 404, 422, 409 `INVALID_STATE`.
- Editing or deactivating the **last** active dish with a photo of an `approved` chef is allowed (same as open point 6 for the profile); the public menu is then empty.

## 5B. Availability (own) **(T-032)**

Same gate and check order as section 5A. **Meaning (Decision D-15, Jimmy, 2026-10-08):** a date is bookable only if the chef marked it available; a date with no row is **not** available. Only rows with `available = true` are stored; clearing a date deletes its row. WO-4 enforces this at booking time together with the double-booking rule. **(T-042, D-22)** A date with a `requested` or `accepted` booking cannot be cleared: 409 `DATE_BOOKED`, see below. (Cancelling is T-063.)

Dates are `YYYY-MM-DD` calendar dates in **America/Toronto** (the server decides what "today" is, with the same rule as the booking-day trigger). The bookable window is **today up to today + 180 days** (**Decision D-15**, Jimmy, 2026-10-08).

### GET /api/chef/availability
- **Response 200:** `AvailabilityResponse` `{ days: string[], today: string, lastBookableDay: string }`: the caller's available dates from today on, ascending. `today` and `lastBookableDay` (today + 180) are the server's window, so the calendar needs no clock of its own.

### PUT /api/chef/availability
- **Request:** `SetAvailabilityRequest` `{ add?: string[], remove?: string[] }`. Mark dates available with `add`, clear dates with `remove`; either may be omitted. **Response 200:** `AvailabilityResponse` (the new state).
- **Validation (422, nothing saved on any error):** unknown keys; at least one date overall (`fields.add`); each list is an array of at most 200 strings; every entry is a real calendar date in `YYYY-MM-DD` (`2026-02-30` and year `0000` are refused; Postgres has no year 0); every `add` date is **not in the past** and **not after the horizon** (`fields.add`, message names the window); `remove` dates may be any valid date, including past ones (cleaning up); a date in both lists is refused (`fields.remove`). Duplicates inside a list are ignored.
- **Does (service):** one upsert of the `add` dates (`available = true`) and one delete of the `remove` dates, both filtered to `chef_id = caller`. The two sets are disjoint and each statement is idempotent, so a failed request can simply be sent again.
- **(T-042, D-22)** A date in `remove` that has a `requested` or `accepted` booking is refused: **409 `DATE_BOOKED`** with `error.dates` (the dates that are booked) and **nothing in the request is saved**, not even its `add` dates. The check and the delete are one database function (`chef_remove_availability`) that locks the availability rows before it looks at bookings, so a booking being created at the same moment either blocks the clear or fails with `CHEF_UNAVAILABLE`. Stale (expired but not yet swept) requests are expired first. Dates whose bookings are finished (`completed`, no-shows) or gone (`declined`, `cancelled`, `expired`) can be cleared.
- **Errors:** 401, 403, 400, 422, 409 `DATE_BOOKED`.

## 6. Admin chef queue (all checks are MOCK) **(T-035, v1.2)**

All six routes: `Cache-Control: no-store`. **Order of checks (every route):** session (401); role (403, decided from `profiles.role`, never from JWT metadata, before any other query); for the routes with a body, content type (400); `:id` is a uuid and names a chef application (404, also when the body is invalid, so an unknown chef is never "validated"); malformed JSON (400); unknown keys (422, on their own); field rules (422, all at once); then state (409). `GET /api/admin/chefs` has no `:id` or body: 401, 403, query (422). A customer, chef or visitor gets 401 or 403 for every `:id`, including ids that do not exist, so nothing about the queue leaks. The service-role client is created only after the role check. Decisions that touch several tables (approve, reject, kitchen review) are one database function each (`admin_approve_chef`, `admin_reject_chef`, `admin_review_kitchen`; migration `20261010120000`, service role only, `SECURITY INVOKER`, EXECUTE revoked from browsers): the function locks the chef's `chefs` and `chef_private` rows, re-reads everything under those locks, decides, writes and adds the notification in one transaction, so nothing can change between "checked" and "written". Every change appends one server log line `api: admin <action> admin=<id> chef=<id>`: no document, URL, reason, note or email is ever logged. **MOCK:** every status below is a simulated outcome recorded by an admin; nothing is really verified. The UI labels each with MOCK (T-036).

### GET /api/admin/chefs
- **Query:** `AdminChefListQuery`: `status` (`pending` default, `approved`, `rejected`, `all`); `checks=pending` (optional): only chefs with at least one of the ID, food-handler or kitchen check still `pending` (the police check does not count; it combines with `status` by AND, so `status=all&checks=pending` is "everything waiting for a verdict"); `limit` (integer 1 to 50, default 20); `cursor` (opaque, from `nextCursor`). Unknown query parameters are ignored; an invalid value is 422 with `fields.<name>` (`status`, `checks`, `limit`, `cursor`), all reported at once.
- **Response 200:** `AdminChefListResponse` `{ items: AdminChefListItem[], nextCursor }`. Newest first (`chefs.created_at` desc, then `profile_id` desc as tie-break). Keyset pagination: no gaps and no repeats while chefs are added; `nextCursor` is `null` on the last page. An item has the summary, the four MOCK statuses and, **(T-061, D-21a)**, `failedChecks` (the MOCK checks that are `failed`, in the order `id`, `foodHandler`, `kitchen`, `police`) and `flagged` (`true` when the chef is `approved` and `failedChecks` is not empty, so an admin sees an approved chef whose check was later failed; the chef's status does not change), and nothing private: no documents, paths, address, reason, phone or email.
- **Tables:** `chefs` joined to `chef_private` (user-scoped client, admin RLS policies apply). A chef without a `chef_private` row is not listed (sign-up repair creates it).

### GET /api/admin/chefs/:id
- **Response 200:** `AdminChefDetail` `{ application, email, documents }`. `application` is the same `ChefApplication` the chef sees (`missing` is the submit rule: it does not check that files exist; approve does). `email` is for the admin's review only (`null` if the account has none). `documents` are 300-second signed URLs (`expiresInSeconds: 300`, service-role `createSignedUrl`) for the ID and food-handler files (bucket `chef-documents`) and the kitchen photos (bucket `kitchen-photos`). The bucket comes from the kind, never from stored text; a stored path that is not one of our file names in this chef's folder, or whose object does not exist, is **left out** of `documents` (the application still lists the path, so the admin can see something is wrong). URLs are never cached (`no-store`) and never logged. No hashes are returned.
- **Errors:** 401, 403, 404 (unknown id, not a uuid, or an id that is not a chef application).

### POST /api/admin/chefs/:id/approve
- **Request:** none (the body is ignored, but the request must still be `application/json`, 400 otherwise). **Response 200:** `AdminChefActionResponse` `{ application }` with `status: "approved"`, `rejectReason: null`.
- **Does (one transaction, rows locked):** the chef must be `pending`; completeness is recomputed on the server with the same rules and item names as `missing` in section 5 (display name, bio, photo, cuisines, languages, hourly rate, service prefix, location options, ID, food handler, allergen acknowledgement, **verified phone (MOCK SMS)**, **at least one active dish with a photo**, and for a chef offering `chef_home`: kitchen address, kitchen photo and hygiene acknowledgement) **and every stored file must exist in Storage** (profile photo, ID, food handler, the sample dish photo, at least one kitchen photo when chef's home is offered; a stored path whose object is gone is reported as the missing item, for example `idDocument`); `id_check_status` and `food_handler_status` must **still be `verified`**, read in the same transaction as the write, so a file swapped while the application waits (which resets its check to `pending`) cannot be approved. Then `chefs.status = 'approved'`, `chef_private.reject_reason = null` (bumps `updated_at`, so a chef write that read the older row retries), and one `notifications` row `type = 'chef_approved'`, title "Your chef application was approved". It does **not** enable chef's home (kitchen review) and does not touch the kitchen or police check.
- **Errors, in this order:** 401, 403, 400, 404; 409 `INVALID_STATE` when the chef is not `pending` ("already approved", or "rejected: the chef has to update it and submit it again first"); 409 `APPLICATION_INCOMPLETE` with `error.missing` (same vocabulary and order as `ChefApplication.missing`); 409 `INVALID_STATE` when the ID and/or food-handler check is not `verified` (the message names which). Nothing is written on any error.
- **Tables:** `chefs`, `chef_private`, `profile_private`, `dishes`, `storage.objects`, `notifications`.

### POST /api/admin/chefs/:id/reject
- **Request:** `RejectChefRequest` `{ reason }`: trimmed, 3 to 500 characters, no control characters or lone surrogates (same rule as `Fields.text`; 422 `fields.reason`, unknown keys 422). **Response 200:** `AdminChefActionResponse` with `status: "rejected"` and `rejectReason`.
- **Does (one transaction):** allowed from `pending` or `approved` (an approved chef leaves public search at once); `reject_reason = reason`, `status = 'rejected'`, **(T-061, D-21d)** `chefs.chef_home_enabled = false` (approving the chef again does not bring chef's home back; an admin approves the kitchen again), one notification `type = 'chef_rejected'`, title "Your chef application was not approved", body = the reason. The reason is visible to the chef (`rejectReason` on their application) and to admins, never public.
- **Errors:** 401, 403, 400, 404, 422, 409 `INVALID_STATE` if already `rejected`. A rejected chef edits and calls `/submit`, which moves the application back to `pending` and clears the reason (section 5).
- Pending and rejected chefs never appear in public routes (RLS plus the route filter).

### PATCH /api/admin/chefs/:id/checks
- **Request:** `AdminChecksRequest` `{ idCheck?, idDocumentPath?, foodHandlerCheck?, foodHandlerPath?, policeCheck? }`; statuses are `not_started`, `pending`, `verified` or `failed`. **Response 200:** `AdminChefActionResponse`.
- **Stale-review protection (B1):** sending `idCheck` requires `idDocumentPath` and sending `foodHandlerCheck` requires `foodHandlerPath`: the paths the admin actually viewed (from `GET /api/admin/chefs/:id`). A path without its check, a check without its path, or no check at all is 422 (`fields.idCheck`, `fields.idDocumentPath`, `fields.foodHandlerCheck`, `fields.foodHandlerPath`). The write is **one conditional UPDATE** (`... where id_document_path = <reviewed> and food_handler_path = <reviewed>`), so a file the chef replaced after the admin opened it is never marked: 409 `INVALID_STATE` and **nothing** is written, not even the other fields of the same request. `policeCheck` has no file and is always allowed. Allowed for chefs of any status. An admin may set any MOCK check back to `not_started` or `pending`; setting a check to `failed` on an approved chef does not change the chef's status, it only flags the chef in the list **(T-061, D-21a)**.
- **MOCK:** these are simulated outcomes recorded by the admin, not real checks. The update bumps `chef_private.updated_at` (trigger), so a chef write that read the older row retries against the new statuses. The UI labels each status MOCK.
- **Errors:** 401, 403, 400, 404, 422, 409 `INVALID_STATE`.

### POST /api/admin/chefs/:id/kitchen-review
- **Request:** `KitchenReviewRequest` `{ decision, note?, reviewedPhotoPaths, reviewedAddress }`. **Response 200:** `AdminChefActionResponse`.
- `decision` is `approve` or `reject`. `note`: required for `reject`, optional for `approve` (then shown to the chef); 3 to 500 safe characters. `reviewedPhotoPaths`: up to 10 distinct strings (`[]` allowed). `reviewedAddress`: `{ line, city, postalCode }` (postal code with or without a space, any case) or **`null` when no kitchen address is stored**. Both reviewed values are required for both decisions (422 otherwise).
- **Stale-review protection (B1), inside the transaction:** `reviewedPhotoPaths` must be **set-equal** to the stored `kitchen_photo_paths` (order does not matter) and `reviewedAddress` must equal the stored address (`null` equals "no address stored"). Otherwise 409 `INVALID_STATE` and nothing is written. This check comes before the approve preconditions.
- **Does:** `approve` requires `chef_home` in `location_options` (else 409 `INVALID_STATE`, "does not offer cooking at their own home"), a kitchen address, at least one kitchen photo whose file exists, and `kitchen_hygiene_ack_at` (else 409 `APPLICATION_INCOMPLETE` with `missing` from `kitchenAddress`, `kitchenPhotos`, `kitchenHygieneAcknowledgement`); then `kitchen_status = 'verified'`, `chefs.chef_home_enabled = true` and a `kitchen_approved` notification. `reject` sets `kitchen_status = 'failed'`, `chef_home_enabled = false` and a `kitchen_rejected` notification with the note. MOCK. The chef's own `status` is untouched. **(T-061, D-21b)** The review is allowed only for a `pending` or `approved` chef; for a `rejected` chef (either decision) the answer is 409 `INVALID_STATE` ("The kitchen can only be reviewed for a pending or approved chef") and nothing is written. The status check runs inside the transaction, before the stale-review check. A later kitchen change by the chef resets the check and turns chef's home off again (section 2, N1).
- **Tables:** `chef_private`, `chefs`, `storage.objects`, `notifications`.

Notifications are rows in `notifications` (`type`, `title`, `body`, no booking); the read API comes in WO-5. Admin lists of bookings, reports and free-trial blocks come in WO-4/WO-5.

## 7. Public search and chef detail (read only, no auth needed) **(T-039, v1.3)**

Three routes, open to everyone, signed in or not. They use the user-scoped (anon-capable) client only; **no service role**. Row-level security already limits `chefs` to approved rows, active dishes and availability of approved chefs, and `postal_prefixes` to everyone. RLS alone is not enough, because a signed-in chef also passes the "own row" and "booking counterparty" policies and an admin passes the admin policies. So **every query adds its own filters**: `.eq('status','approved')` on chefs, `.eq('is_active', true)` on dishes, `.eq('available', true)` plus the date window on availability. A chef viewing their own pending row, a customer with a booking with a pending chef and an admin all get exactly what a visitor gets. No migration was needed. Responses are `Cache-Control: no-store` (they depend on today's date), except the reference route. **No private data ever:** no address, phone, email, kitchen address or photos, documents, check statuses, reject reason, hashes, postal prefix of the chef.

**Rules (all PLAN assumptions; Jimmy may change any):**
- **A-1 distance:** straight line (haversine) between the centre of the search point and the centre of the chef's service postal-area; shown in km with one decimal (`distanceKm`), sorted on whole metres. It is approximate (area centres), never an address.
- **A-18 search point:** `postalCode` (full code or its first 3 characters, GTA only) uses that area's centre; `city` uses the plain average of the centres of that city's areas. With neither, there is no distance (`distanceKm` is `null`).
- **A-20 hidden profiles (interim for Q-13):** an approved chef with no bio (blank counts as none), no photo or no active dish is left out of search and gets the 404 below.
- **Visible location options:** `customer_home` when the chef offers it; `chef_home` only when the chef offers it **and** `chef_home_enabled` (admin approved the kitchen, MOCK check). A chef with `chef_home` selected but not enabled is shown as customer's-home only.
- **Reach (A-18):** a chef is reachable at the customer's home when they offer it and the distance is within `serviceRadiusKm` (without a search point, reach is not checked). A chef who is not reachable but can be booked at their own home is still listed and marked `chefHomeOnly: true`. A chef who is neither reachable nor bookable at their home is left out. `chefHomeOnly` is also `true` for a chef who offers only chef's home.

### GET /api/chefs
- **Query:** `PublicChefSearchQuery`. All optional. Empty values are ignored. A parameter sent twice is 422. Unknown parameters are ignored.
  - `postalCode`: `L5B1A1`, `L5B 1A1` or `L5B` (any case). 422 `fields.postalCode` = "Not a GTA postal code." when malformed or the first 3 characters are not in `postal_prefixes` (A-1). `city`: a city name from the reference route (case-insensitive); unknown is 422 `fields.city`. Both together is 422 `fields.city`.
  - `cuisine`, `language`: 1 to 40 characters, no control characters; exact match on one entry of the chef's `cuisines` / `languages`, ignoring case and surrounding spaces.
  - `avoidAllergens` (A-17, diets such as vegetarian or halal are not supported, Q-18): comma-separated, at most 14 entries of 1 to 40 characters; the chef matches when **at least one active dish** has none of them. **(T-042, D-31)** Matching uses the same words and synonym map as the booking allergy warning (`SYNONYM_GROUPS`, D-24, D-32): avoiding "gluten" also leaves out a dish listing "wheat" or "barley", avoiding "shrimp" leaves out "shellfish" and so on. A dish is also left out when one of its allergens is a longer phrase that contains the avoided word. This is a convenience filter, not an allergy guarantee: the booking intake still checks.
  - `minRateCents`, `maxRateCents`: integers 0 to 100000 (`min` greater than `max` is 422 `fields.maxRateCents`); the chef's `hourlyRateCents` must be inside (a chef without a rate is left out when either bound is given).
  - `date`: `YYYY-MM-DD`, a real date from **tomorrow** (D-27: no same-day bookings, **(T-042)** today is now 422) to today + 180 days (Toronto, D-15) else 422 `fields.date`; the chef ticked that date (A-19) and is **not already booked** that day **(T-042)**.
  - `locationType`: `customer_home` or `chef_home` else 422. `customer_home`: chefs reachable at the customer's home, plus chefs out of reach who can be booked at their home (marked `chefHomeOnly`, A-18). `chef_home`: only chefs bookable at their own home (no radius check). Absent: same as `customer_home`.
  - `limit` integer 1 to 50, default 20; `cursor` opaque (a bad cursor is 422 `fields.cursor`).
  - All field errors are reported at once (422 `VALIDATION_FAILED`).
- **Response 200:** `PublicChefSearchResponse` `{ items: PublicChefSearchItem[], nextCursor }`. Item keys, exactly: `id, displayName, photoPath, cuisines, languages, hourlyRateCents, currency, ratingAvg, reviewCount, serviceCity, serviceRadiusKm, distanceKm, locationOptions, chefHomeOnly`.
- **Sort:** with a search point: `distanceKm` ascending (chefs without a centre last), then `ratingAvg` descending, `displayName`, `id`. Without one: `ratingAvg` descending, `displayName`, `id`. This replaces the v1.2 rating sort. The cursor is a keyset (sort key plus id), so pages have no repeats or gaps while chefs change.
- **Scale note:** the route reads all approved chefs (up to the database row cap of 1000) and filters and sorts in code; fine for the prototype.
- **MUST:** `.eq('status','approved')`; A-20; no private columns are selected at all (explicit column list). **Errors:** 422 only (plus 500).

### GET /api/chefs/:id
- **Response 200:** `PublicChefDetail`: `id, displayName, bio, photoPath, cuisines, languages, hourlyRateCents, currency, ratingAvg, reviewCount, serviceCity, serviceRadiusKm, locationOptions, dishes, bookableDates, today, firstBookableDay, lastBookableDay`. `dishes` are the **active** dishes (`PublicDish`: `id, name, photoPath, description, cuisine, cookMinutes, ingredientCostCents, servings, allergens, shelfLifeDays`), oldest first. `bookableDates` are the chef's ticked dates from `firstBookableDay` (**tomorrow**, D-27; **(T-042)** was today) to `lastBookableDay` (A-19, D-15), ascending, **without** the dates the chef already has an active booking on (`requested`, `accepted`, `completed`, no-shows; an expired request that nobody has swept yet does not count). The booking facts are read through a database function that returns dates only, never who booked.
- **404 `NOT_FOUND`** with one identical body for: an id that is not a uuid, an unknown id, a `pending` chef, a `rejected` chef, and an approved chef hidden by A-20. Nothing tells them apart, not even for the chef themselves or a booking counterparty.
- A chef who offers `chef_home` before the kitchen is approved shows only `customer_home`. **(T-061, D-25)** A chef with no bookable location option (for example one who offers only `chef_home` before an admin enables it) gets the same 404 as any other hidden chef, so `locationOptions` is never empty in a 200. They do not show in search either. **Errors:** 404, 500.

### GET /api/reference/postal-prefixes
- **Response 200:** `PostalPrefixListResponse` `{ items: [{ prefix, city, lat, lng }] }`, ordered by prefix. Public reference data for the city picker; the same for everyone, so it uses a cookie-free client and is cacheable: `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. The centres are approximate (A-1). **Tables:** `postal_prefixes`.

## 7A. Bookings: create, answer, expire **(T-042, v1.4)**

Routes of this section are implemented in T-042 unless marked **(T-063, PROPOSED)**: those shapes are published now so Frontend can plan, but they do not exist yet and T-063 may refine them. Everything involving payment is **MOCK**: no money moves, the platform fee is shown but never collected (`platformFeeCollected: false`), and the UI shows a MOCK payment step (D-18). All routes: `Cache-Control: no-store`. Order of checks, every route: session (401); role (403, from `profiles.role`); content type for POST/PUT/PATCH (400); `:id` is a uuid and names a row the caller may see (404, one identical answer for "missing" and "someone else's"); body (400 malformed, 422 unknown keys on their own, then field rules all at once); then state (404 hidden chef, 409). Identity is the session; `customerId` is never accepted from a body. Admins get 403 on every route here (the admin booking list is WO-5).

### Types (see `src/lib/api/types.ts`)

- `BookingStatus`: `requested | accepted | declined | cancelled | completed | no_show_customer | no_show_chef | expired`. **`expired` is new** (migration `20261011100000`): a `requested` booking nobody answered in time (D-19). Like `declined` and `cancelled` it frees the chef's dates.
- `GroceryOption`: `customer_buys` (option A) | `chef_shops` (option B).
- `BookingRequestBody` (create and estimate):

```json
{
  "chefId": "uuid",
  "locationType": "customer_home",
  "address": { "line": "100 Main St", "city": "Mississauga", "postalCode": "L5B 1A1" },
  "days": [{ "date": "2026-10-20", "dishes": [{ "dishId": "uuid", "quantity": 1 }] }],
  "groceryOption": "customer_buys",
  "intake": { "noAllergies": false, "allergens": ["peanuts"], "allergyNotes": "carries an EpiPen", "noDietaryNeeds": true, "dietaryNotes": "" },
  "allergyConflictAcknowledged": false,
  "useFreeTrial": true
}
```

  - `address`: required for `customer_home` (it is the cooking address; it may differ from the home address in `PUT /api/me/address`), a GTA postal code; **not allowed** for `chef_home` (422, nothing about the customer's address is stored then). `quantity` defaults to 1 (1 to 10). Days may be sent in any order; the server sorts them by date and numbers them (day 1 is the earliest).
  - `intake` (mandatory, D-23). **Allergies need an explicit answer**: either `noAllergies: true` (stored as "None"; then `allergens` and `allergyNotes` must be empty), or at least one value in `allergens` (only the values of the allergen picker, `ALLERGEN_CHOICES`: milk, eggs, peanuts, tree nuts, sesame, soy, wheat, gluten, fish, crustaceans, molluscs, mustard, sulphites) and/or non-blank `allergyNotes` (up to 300 characters, free text). **Dietary needs need an explicit answer too**: `noDietaryNeeds: true` (stored as "None"; then `dietaryNotes` must be empty) or non-blank `dietaryNotes` (up to 500). Blank is refused: 422 `fields["intake.allergies"]` / `fields["intake.dietaryNotes"]`. Text fields refuse control characters and lone surrogates (same rule as everywhere).
  - `allergyConflictAcknowledged`: must be `true` when any chosen dish has an allergen that matches the customer's allergies (the synonym and spelling map of D-24, D-32; see `SYNONYM_GROUPS`), else 422 issue `ALLERGY_NOT_ACKNOWLEDGED` and `allergyConflicts` lists the dishes. If there is no conflict the flag is ignored and stored as `false`.
  - `useFreeTrial` (optional, default `false`): ask for the free first booking. Labour is then waived in the estimate. If the server refuses the claim, **nothing is created** and the answer is 409 `FREE_TRIAL_USED` (generic on purpose, section 11A); the customer may send the same request with `useFreeTrial: false` to book at full price.
- `BookingIssue` `{ code, message, dayIndex?, dishId? }` with `code` from the domain list: `DAYS_COUNT, DATE_INVALID, DATE_DUPLICATE, DATE_IN_PAST, DATE_TOO_SOON (new, D-27), DATE_BEYOND_WINDOW, CHEF_NOT_BOOKABLE, LOCATION_NOT_OFFERED, CHEF_HOME_NOT_ENABLED, CHEF_UNAVAILABLE, DOUBLE_BOOKED, POSTAL_NOT_GTA, CHEF_NO_SERVICE_AREA, OUTSIDE_SERVICE_AREA, NO_DISHES, DISH_NOT_FOUND, DISH_INACTIVE, DISH_DUPLICATE, QUANTITY_INVALID, VISIT_TOO_LONG, INTAKE_MISSING, ALLERGY_NOT_ACKNOWLEDGED`.
- `BookingEstimate` (integer cents, `currency` CAD): `cookMinutes, labourCents, labourBeforeWaiverCents, freeTrialWaivedCents, ingredientsCents, travelCents, platformFeeCents, platformFeePercent, platformFeeCollected: false, totalCents, travelRateCentsPerKm, distanceKm (null for chef_home), exceedsSoftLimit, days: [{ date, cookMinutes, labourCents, ingredientsCents, travelCents, platformFeeCents }]`. Rules are `src/lib/domain/pricing.ts` (A-12 to A-14, A-23): labour = minutes x rate / 60, travel only for `customer_home` (one way, each visit day), platform fee on labour only and **not added** to the total, the free trial waives labour only.

### POST /api/bookings/estimate
- **Who:** signed-in customer. **Request:** `BookingRequestBody`; `intake`, `allergyConflictAcknowledged` and `useFreeTrial` may be omitted (the estimate screen is shown before the form is complete). **Response 200:** `{ ok, issues, estimate, allergyConflicts, freeTrial, today, firstBookableDay, wouldExpireAt }`.
  - `ok` is true when the same request would pass create's validation (a missing intake is an issue `INTAKE_MISSING`, so `ok` is false until it is filled). `issues` lists **every** problem (also a hidden chef: `CHEF_NOT_BOOKABLE`, here a normal 200 body, not a 404, because the customer already has the chef id from a page that exists). `estimate` is `null` when the days or dishes cannot be priced. A day over 6 hours is `VISIT_TOO_LONG` (the customer must remove dishes or split the day) and the estimate is still returned with `exceedsSoftLimit: true`.
  - `freeTrial` is `{ eligible: boolean, blocker: null | "PHONE_NOT_SUBMITTED" | "PHONE_NOT_VERIFIED" | "ADDRESS_NOT_SET" | "USED" }`. Advisory only; it reserves nothing (section 11A). `USED` never says which rule blocked. `wouldExpireAt` (ISO) is when a request made now would expire if the chef does not answer (D-19, D-27: the earlier of 72 hours from now and 00:00 Toronto on day 1).
  - The estimate screen should tell the customer when day 1 is less than 48 hours away: cancelling is then already late (D-20; `cancellationTiming` in `src/lib/domain/cancellation.ts`).
- **Errors:** 401, 403, 400, 422 (shape: not an object, `days` not an array, a non-uuid `chefId`, unknown keys, text rules), 429 not used. Domain problems are in the 200 body, never a 422.

### POST /api/bookings
- **Who:** signed-in customer with a **verified phone** (MOCK SMS, T-057): 409 `PHONE_NOT_SUBMITTED` / `PHONE_NOT_VERIFIED` otherwise. **Request:** `BookingRequestBody`, with `intake` mandatory. **Response 201:** `BookingDetail` (below), status `requested`.
- **Does, in this order:**
  1. Validates the shape (422, nothing else is read).
  2. Expires this customer's and this chef's stale requests (lazy expiry, below) so a dead request never blocks a date or counts against the limit.
  3. Loads the chef with the service role. A chef who is not `approved`, has no bookable location option (D-25), or is hidden by A-20 gets the **same 404 `NOT_FOUND` "Chef not found."** as `GET /api/chefs/:id`. Nothing tells the cases apart.
  4. Runs the domain validation (`validateBooking`, with `today` = Toronto today): 1 to 3 distinct dates, **day 1 is tomorrow at the earliest (D-27)**, inside the 180-day window, ticked by the chef (D-15), not already booked (A-9), location offered and (for chef's home) enabled by the admin's kitchen review, customer's cooking address inside the chef's radius, the chef's own active dishes only, at most 6 hours per day, intake answered, allergy conflicts acknowledged.
  5. Free trial (only if `useFreeTrial`): advisory check first (clean 409s as in section 11A).
  6. **One database transaction** (`create_booking`): at most 3 open requests per customer (D-28), the chef's `chefs` row and the picked availability rows are locked, then the booking, its address, days, dish snapshots (with `eat_by_date` = visit date + the dish's shelf-life days, A-7), the intake form, the free-trial claim and the chef's notification are written together. Either all of it exists or none of it does; `bookings.is_free_trial` is `true` only when the claim was written in the same transaction.
- **Errors, with the first matching rule winning:** 404 `NOT_FOUND` (hidden chef); 422 `VALIDATION_FAILED` with `fields` and `issues` when any issue other than `DOUBLE_BOOKED` exists (all issues are listed, `DOUBLE_BOOKED` included); 409 `DOUBLE_BOOKED` (only double-booking issues, or the unique index lost a race; `error.issues` names the days); 409 `TOO_MANY_OPEN_REQUESTS` (D-28: three bookings are already `requested`; wait for an answer or cancel one); 409 `FREE_TRIAL_USED`, `PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `ADDRESS_NOT_SET` (these last two only with `useFreeTrial`); 401; 403 (not a customer); 400.
- **Race rules.** Two requests for the same chef and date: the unique index `booking_days_one_per_chef_date` lets exactly one win (the loser gets 409 `DOUBLE_BOOKED`). Four parallel requests from one customer: an advisory lock per customer lets exactly three through (D-28). A chef clearing a date while it is being booked: the booking transaction locks the availability row, the clear waits and then sees the booking, or the clear wins and the booking gets `CHEF_UNAVAILABLE`.

### BookingDetail (response of create, accept, decline and GET /api/bookings/:id)

```json
{
  "id": "uuid", "status": "requested", "viewerRole": "customer",
  "locationType": "customer_home", "groceryOption": "customer_buys", "isFreeTrial": true,
  "createdAt": "ISO", "expiresAt": "ISO|null", "respondedAt": "ISO|null", "declineReason": "string|null",
  "chef": { "id": "uuid", "displayName": "Linh", "photoPath": "string|null" },
  "customer": { "id": "uuid", "displayName": "Sam" },
  "days": [{ "dayNumber": 1, "date": "2026-10-20", "cookMinutes": 120,
             "dishes": [{ "dishId": "uuid|null", "name": "Pho bo", "quantity": 1, "cookMinutes": 120, "ingredientCostCents": 2500, "servings": 4, "allergens": ["soy"], "eatByDate": "2026-10-22" }] }],
  "estimate": { "...": "BookingEstimate without the waiver detail" },
  "intake": { "allergies": "peanuts; carries an EpiPen", "dietaryNotes": "None", "allergyConflictAcknowledged": false },
  "allergyConflicts": [{ "dishId": "uuid", "dishName": "Satay", "allergens": ["peanuts"] }],
  "cookingPlace": { "line": "100 Main St", "city": "Mississauga", "postalCode": "L5B1A1" },
  "contact": { "displayName": "Linh", "phone": "+14165550100" },
  "payment": { "mock": true, "collected": false }
}
```

- **Who sees what (CLAUDE.md 6.8):** the customer and the chef of the booking only; anyone else gets 404.
  - `intake` and `allergyConflicts` are visible to **both** parties from the start (the chef reads the intake before answering).
  - `cookingPlace` and `contact` are **`null` until the booking is `accepted`** (and stay visible for `completed` and the no-show statuses; they are hidden again for `declined`, `cancelled`, `expired`). Customer view: `cookingPlace` is the customer's own cooking address for a `customer_home` booking (always visible to them) and the chef's kitchen address for a `chef_home` booking once accepted; `contact` is the chef's phone, once accepted. Chef view: `cookingPlace` is the customer's cooking address for `customer_home` once accepted, and `null` for `chef_home` (it is their own kitchen); `contact` is the customer's phone, once accepted. Both come from `get_booking_contact()` (the only path to a phone number and the other party's address) and the customer's own `booking_addresses` row, read with the **caller's** session so row-level security applies.
  - `expiresAt` is set while the status is `requested` (D-19) and kept afterwards.
  - `estimate` is the snapshot taken at creation; later pricing changes do not touch it.
- **Errors:** 401, 403 (admin), 404.

### GET /api/bookings
- **Who:** signed-in customer (own bookings as customer) or chef (bookings for them). **Query:** `status` (one status, or `open` = `requested` + `accepted`, or `all`; default `all`), `limit` (1 to 50, default 20), `cursor` (opaque, newest first, keyset on `createdAt` and `id`). Invalid value 422 `fields.<name>`.
- **Response 200:** `Page<BookingSummary>`. `BookingSummary`: `id, status, locationType, groceryOption, isFreeTrial, createdAt, expiresAt, firstDay, dates (ascending), totalCents, currency, counterparty { id, displayName }` (the chef for a customer, the customer for a chef). No intake, address or phone in a list.
- Runs the lazy expiry for the caller's bookings first. **Tables:** `bookings` (user-scoped client, RLS), `profiles`, `booking_days`.

### GET /api/bookings/:id
- **Response 200:** `BookingDetail` for either party. Runs lazy expiry for this booking first. **Errors:** 401, 403, 404.

### POST /api/bookings/:id/accept
- **Who:** the booking's chef (403 for a customer; 404 for another chef). **Request:** none (still `application/json`). **Response 200:** `BookingDetail` with `status: "accepted"`, `respondedAt`, and now `cookingPlace` and `contact`.
- **Does (one database function, row locked):** the booking must be `requested` and not past `expiresAt`; the chef must still be `approved`. The customer gets a `booking_accepted` notification. The free-trial claim stays `held` (A-16; `applyFreeTrialEvent(…, "accepted")` is a no-op).
- **Errors:** 404; 409 `INVALID_STATE` (already answered, cancelled, or the chef is not approved); 409 `REQUEST_EXPIRED` (past `expiresAt`: the booking is marked `expired` by this very call, dates freed, claim released); 401, 403, 400.

### POST /api/bookings/:id/decline
- **Who:** the booking's chef. **Request:** `{ reason?: string }` (3 to 500 safe characters when given). **Response 200:** `BookingDetail` with `status: "declined"`, `declineReason`.
- **Does:** same checks as accept; the dates are freed (the `is_active` flag of the days turns off), the customer gets a `booking_declined` notification, and the free-trial claim is **released** (`applyFreeTrialEvent(…, "declined")`, called by the route after the change is saved).
- **Errors:** as accept, plus 422.

### Expiry (D-19, D-27) and lazy sweeping
- `expiresAt` = the earlier of **creation + 72 hours** and **00:00 Toronto on day 1** (so a request for tomorrow expires at midnight if unanswered). It is stored on the booking when it is created.
- **How it runs (no scheduler in this prototype):** the database function `expire_stale_bookings(user)` marks every `requested` booking with `expiresAt <= now()` as `expired` in one conditional UPDATE (`... where status = 'requested'`, so a parallel accept and an expiry cannot both win), adds a `booking_expired` notification for both parties, and returns the booking ids; the route then calls `applyFreeTrialEvent(id, "expired")` for each (claim released). It is called by `GET /api/bookings`, `GET /api/bookings/:id`, `POST /api/bookings` (for the customer and the chef involved) and `PUT /api/chef/availability`. Accept and decline re-check the expiry under the row lock, so an expired request can never be accepted. The public chef page and search ignore expired-but-unswept requests when they list booked dates. If the server dies between the status change and the claim release, the next sweep finds `declined` / `expired` bookings whose claim is still `held` and releases it (a self-repair step). A scheduled call of `expire_stale_bookings(null)` (Supabase cron or Vercel cron) can be added later without code changes.
- **Notifications (A-5):** rows in `notifications` (`type` is `booking_requested` (to the chef), `booking_accepted`, `booking_declined` (to the customer), `booking_expired` (to both)). Titles and bodies never contain phone numbers, addresses or allergy text. There is **no notification route yet** (WO-5); a signed-in user can already read their own rows and set `read_at` with the browser client under row-level security.

### Bookable dates and search (A-19, D-27, D-22)
- `GET /api/chefs/:id` `bookableDates` now starts **tomorrow** (D-27: no same-day bookings) and removes dates the chef already has an active booking on (`requested`, `accepted`, `completed` or a no-show; not declined, cancelled or expired). A new field `firstBookableDay` (tomorrow) sits next to `today` and `lastBookableDay`.
- `GET /api/chefs?date=` accepts a date from **tomorrow** to today + 180 (today is now 422 `fields.date`) and leaves out chefs booked on that date.
- `PUT /api/chef/availability`: a date in `remove` that has a `requested` or `accepted` booking is refused with **409 `DATE_BOOKED`** (`error.dates` lists them) and **nothing in the request is saved** (D-22). The check and the delete are one database function that locks the availability rows first, so a booking cannot slip in between. Past dates of finished bookings can be cleared.

### Planned routes for T-063 (PROPOSED shapes, not implemented in T-042)
All need the same session and party checks, return `BookingDetail`, and call `applyFreeTrialEvent` after the change is saved.
- `POST /api/bookings/:id/cancel` `{ reason? }` customer or chef. D-20 timing (`cancelledBy`, `cancellationTiming` `on_time | late`). D-26: whether a day was already cooked decides release or consume.
- `POST /api/bookings/:id/days/:dayNumber/cooked` (chef): the per-day "cooked" marker D-26 needs.
- `POST /api/bookings/:id/no-show`: a chef caller means `no_show_customer`, a customer caller means `no_show_chef`.
- Missed pickup (D-29, chef's-home bookings): `POST /api/bookings/:id/days/:dayNumber/pickup/propose` `{ proposedAt }` (customer, not later than the earliest `eatByDate` of that day's meals), `POST .../pickup/respond` `{ accept: boolean }` (chef; after a decline the customer may propose again until the deadline), `POST /api/bookings/:id/pickup/missed` (chef: the whole booking becomes `no_show_customer`, uncooked days are cancelled).
- Kitchen address change during an accepted `chef_home` booking (N3): `PATCH /api/chef/application` answers 409 `INVALID_STATE` while such a booking exists, or notifies and re-confirms (T-063 decides and documents).
- Rejecting a chef cancels their `requested` bookings and flags their `accepted` ones (D-22).
- Who sets `completed` is not defined yet (open point 14).

## 8. Rule: phone uniqueness across accounts (for T-028)

CLAUDE.md section 10 lists "duplicate or malformed phone numbers". The free trial already blocks a second claim by phone hash, but nothing stops two accounts from holding the same phone.

**CONFIRMED (Planner decision D-11; implemented by the T-028 migration):** a **verified** phone hash may belong to only one account.
- Migration: `create unique index profile_private_phone_hash_verified on public.profile_private (phone_hash) where phone_verified;` (partial, so an unverified number does not block the real owner).
- `POST /api/me/phone` returns 409 `PHONE_IN_USE` if another account already has that hash with `phone_verified = true` (pre-check). `POST /api/me/phone/verify` relies on the unique index and maps the unique-violation (SQLSTATE 23505) to 409 `PHONE_IN_USE`.
- Same account resubmitting its own number is fine (idempotent).
- Risks: reveals that a number is registered (enumeration); mitigated only by rate limits in this prototype. A user cannot free their number except by contacting an admin or deleting the account (account deletion is out of scope). Cheap-SIM evasion still exists (README known limit).
- With MOCK SMS anyone can "verify" any number, so a malicious user can squat someone else's number in the demo. Accepted for a prototype; real SMS removes this.

## 9. Rate-limit expectations (MOCK verify and sign-up)

**Implemented in T-028 as an in-memory fixed-window placeholder** (`src/lib/api/rate-limit.ts`): counters are per server process, reset on restart and are not shared between serverless instances, so this is best effort only and not a real abuse defence. Validation failures count toward the limit. `clientIp()` trusts the first `X-Forwarded-For` entry; acceptable on Vercel, which sets it, but revisit in WO-7.

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
| GET /api/me | any signed in | user-scoped | none |
| PATCH /api/me | any signed in | service (profiles + chefs copy) | service |
| POST /api/me/phone, /phone/verify | any signed-in role | service for `profile_private` | service |
| PUT /api/me/address | any signed-in role | service | service |
| GET /api/chef/application | chef | user-scoped read (+ service to repair rows; every chef application route repairs) | none (repair only) |
| PATCH /api/chef/application | chef | service after checks | service (route is the only writer, B2) |
| POST, DELETE /api/chef/application/documents | chef | service (storage info/delete, table write) | service |
| POST /api/chef/application/submit | chef | service | service (check statuses) |
| GET /api/admin/chefs, /api/admin/chefs/:id | admin | user-scoped reads (admin RLS) + service (signed URLs, email) | none |
| POST /api/admin/chefs/:id/approve, /reject, /kitchen-review | admin | service after admin check; one database function each | service (`admin_*` functions, T-035) |
| PATCH /api/admin/chefs/:id/checks | admin | service after admin check | service (one conditional UPDATE) |
| GET, POST /api/chef/dishes; PATCH /api/chef/dishes/:id | chef | service after checks (storage `exists`) | service (routes are the only writers, T-032) |
| GET, PUT /api/chef/availability | chef | service after checks | service |
| GET /api/chefs, /api/chefs/:id, /api/reference/postal-prefixes | anyone | anon-capable user-scoped (+ the dates-only functions `chef_booked_dates`, `chefs_booked_on`) | none |
| POST /api/bookings/estimate | customer | service (reads) | none |
| POST /api/bookings | customer | service after checks; one database function `create_booking` | service (T-042) |
| GET /api/bookings, /api/bookings/:id | customer or chef (party) | user-scoped (RLS) + `get_booking_contact`; service only for `expire_stale_bookings` | none (lazy expiry writes) |
| POST /api/bookings/:id/accept, /decline | chef (booking's own) | service after checks; one database function `answer_booking` | service (T-042) |

## 11A. Free trial: notes for the booking routes (T-038, used by T-042)

The booking routes (section 7A) call the server functions in `src/lib/server/free-trial.ts` after `requireCaller()`; the customer id is always the session user, never a body field. Behaviour is in `docs/domain-rules.md`.

| Call | When | Errors it can throw (all clean, none are 500) |
|---|---|---|
| `checkFreeTrialEligibility(customerId)` -> `{ eligible }` | Estimate screen and just before create. Advisory only; it reserves nothing | 409 `PHONE_NOT_SUBMITTED` (no phone, or a stored phone the current rules refuse: ask the customer to enter it again), 409 `PHONE_NOT_VERIFIED`, 409 `ADDRESS_NOT_SET` (missing or no longer valid), 403 `FORBIDDEN` (**an admin or chef caller, not only "not a customer"**), 404 |
| `holdFreeTrial(customerId, bookingId)` -> `{ claimId, bookingId, state: "held" }` | Stand-alone hold for an existing `requested` booking. **(T-042)** `POST /api/bookings` does not use it: it writes the claim inside `create_booking` in the same transaction as the booking, with hashes made by `loadTrialApplicant` | The above, plus 409 `FREE_TRIAL_USED`, 404 (not the caller's booking), 409 `INVALID_STATE` (booking not `requested`, **or the booking's claim was already `released` or `consumed`: a finished claim is never re-held**) |
| `applyFreeTrialEvent(bookingId, event)` -> `{ changed, state }` | On every booking status change (A-16), and when a request expires. Called by the route only **after** it authorized and saved the change | 409 `INVALID_STATE` (the claim was already decided the other way), 404 |

- `FREE_TRIAL_USED` never says which rule blocked (own history, or a phone or address another account used). Show one message. The real reason is written to `free_trial_blocks` for the admin list. **(T-042)** Repeated blocked attempts by the same customer for the same reason are logged at most once per hour, so the log cannot be flooded.
- **(T-042)** Because the booking and the claim are written in one transaction, a `FREE_TRIAL_USED` leaves **no booking behind**, and a booking can never exist with `is_free_trial = true` and no claim, or a claim `held` on a finished booking created by this route. The customer may repeat the request with `useFreeTrial: false` to book at full price.
- **(T-042)** Anyone who calls these with an admin or chef id gets 403 `FORBIDDEN` (`profiles.role` must be `customer`).
- Retrying a hold for the same booking is safe.

## 11. Not in v1 (planned)

Receipts and grocery (T-044), the T-063 routes of section 7A, messaging, reviews, reports, the notifications read API (WO-5), admin booking/report/free-trial lists. Bookings, estimate and the free trial are section 7A and 11A (T-042). Dishes and availability CRUD is section 5A and 5B (T-032).

Recorded for later work orders:
- N3 (T-063): changing the kitchen address while a `chef_home` booking is `accepted` must be blocked or must notify the customer and re-confirm.
- N4 (WO-5): public reviews currently expose `author_id` and `booking_id`; the reviews contract should return a view without them.
- N5 (decided in D-22, built in T-063): what happens to bookings when an admin rejects an already-approved chef: `requested` ones are cancelled, `accepted` ones are flagged for the admin. An approved chef who re-uploads an ID stays public while the check is `pending` (MOCK, accepted).

## 12. Open points and README known limits

For the README (T-054): MOCK SMS lets anyone claim a real phone number; one phone number cannot hold both a chef and a customer account (follows from phone uniqueness).

Open points for the Planner

1. Confirm the phone uniqueness rule (section 8) so T-028 adds the migration.
2. Approve preconditions (phone verified, sample dish, MOCK checks verified before approve) are assumptions beyond CLAUDE.md 6.7.
3. Rejected chefs may edit and resubmit without limit: Planner decision B3 (no longer an assumption).
4. Cuisine and language lists are free text for now; a fixed list is a product choice.
5. Rate-limit numbers (section 9) are placeholders.
6. (T-031) An approved chef may clear `bio`, `photoPath` or other required fields with PATCH and stays approved and public. The contract allows edits by approved chefs; a product decision is needed on whether clearing required fields should be refused or should send the chef back to review.
7. (T-031) A replaced ID or food-handler document stays in the private `chef-documents` bucket (only an admin can read or delete it). Cleaning these up deletes data, which needs Jimmy's approval; until then they accumulate. Deleting a kitchen photo through the route does delete its object (as specified).
8. (T-031) The inert trigger `chef_private_reset_checks` (client writes no longer exist) and the route reset differ only in that the routes also reset `failed`. The trigger can be dropped in a later migration if the Planner prefers.
9. (T-031) The chef routes have no rate limit (none is specified in section 9).
10. (T-031, decided) `profile-photos` and `dish-photos` stay owner-writable (the owner can overwrite or delete a file in place); only `kitchen-photos` became insert-only for the chef, because a verified MOCK check refers to its files. See `docs/data-model.md`, Storage.
11. (T-035) The approve rules and the `computeMissing` rules exist twice (SQL function and TypeScript). A test compares the two lists, but a new rule must be added in both places (`supabase/migrations/20261010120000_admin_chef_decisions.sql` cannot be edited once applied: add a new migration with `create or replace function`). T-061 did this for `admin_reject_chef` and `admin_review_kitchen` in `20261010150000_admin_rules_d21.sql`; `src/lib/domain/admin-rules-d21-guards.test.ts` compares the new bodies with the old ones.
12. (T-035) ~~An admin may set a MOCK check back to `not_started` or `pending`, and a kitchen review is allowed for chefs of any status.~~ Decided in D-21 and built in T-061: resetting stays allowed, an approved chef with a failed check is flagged, kitchen review only for `pending` or `approved` chefs, rejecting turns chef's home off.
13. (T-035) The queue filter `checks=pending` ignores the police check on purpose (it is set by the admin, not triggered by a chef upload). No `submittedAt` field exists yet; "submitted" is still inferred from the check statuses.
14. (T-042) Nothing sets `completed`, `no_show_*` or `cancelled` yet (T-063). Who marks a booking `completed` (the chef, after the last day; automatically after the last eat-by date; or both confirming) is not defined in the requirements. Reviews (WO-5) need it. Open question for Jimmy.
15. (T-042) A `requested` booking holds the chef's date for up to 72 hours (D-19). A chef with a full calendar of unanswered requests is blocked until they answer or they expire.
16. (T-042) Expiry is lazy (no scheduler). If nobody reads bookings, an expired request stays `requested` in the table, but every route that matters (create, list, detail, answer, availability, public dates) treats it as expired. A scheduled call of `expire_stale_bookings(null)` is recommended before a real launch (WO-7).
17. (T-042) The notification rows exist, the read route does not (WO-5).
