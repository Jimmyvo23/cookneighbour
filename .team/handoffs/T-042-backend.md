# Handoff: T-042 Booking API: create, answer, expire

From: backend  To: tester

## What changed
- Branch: `feature/T-042-booking-api`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/95 (Closes #30)
- Contract: `docs/api-contract.md` v1.4 (new section 7A; also the proposed T-063 route shapes; 5B, 7, 11A updated). Types: `src/lib/api/types.ts`.
- Migrations (new, not applied to hosted; the Planner runs `supabase db push` after merge):
  - `supabase/migrations/20261011100000_booking_expired_status.sql` (enum value `expired`, its own file because a new enum value cannot be used in the same transaction)
  - `supabase/migrations/20261011100100_booking_api.sql` (`bookings.expires_at`, `expired` frees dates, `create_booking`, `answer_booking`, `expire_stale_bookings`, `chef_remove_availability`, `chef_booked_dates`, `chefs_booked_on`, `record_free_trial_block`, `free_trial_blocks.attempts/last_attempt_at`)
- Routes (all new, `src/app/api/bookings/`): `POST estimate`, `POST /` (create), `GET /` (list), `GET /:id`, `POST /:id/accept`, `POST /:id/decline`.
- Server code: `src/lib/server/bookings.ts` (create, estimate, sweep, answer), `src/lib/server/booking-views.ts` (detail and list, caller's own session so RLS applies), `src/lib/server/free-trial.ts` (exports `loadTrialApplicant`, `prepareFreeTrial`, `recordTrialBlock`, `trialBlockFromMessage`, `trialUsed`), `src/lib/server/search.ts` (booked dates, `firstBookableDay`), `src/lib/server/dishes.ts` (`PUT /api/chef/availability` 409).
- Domain: `src/lib/domain/bookingRequest.ts` (new: body parsing, intake text, `requestExpiry`, `classifyIssues`, `issuesToFields`), `bookingValidation.ts` (`DATE_TOO_SOON`), `bookingIntake.ts` (blank refused), `allergy.ts` (D-32 words), `dietary.ts` (D-31 uses `findAllergyConflicts`), `search.ts` (date window from tomorrow), `config.ts` (`REQUEST_EXPIRY_HOURS` 72, `MAX_OPEN_REQUESTS` 3, block log window, intake limits), `dishes.ts` (`ALLERGEN_CHOICES` moved here, re-exported by `src/lib/chef/dishes.ts`).
- Touched frontend-owned files only to keep shared rules consistent: `src/lib/search/search.ts` (`dateWindow` min is tomorrow), `src/lib/mocks/mock-search*.test.ts`, `src/lib/search/*.test.ts`, `e2e-mock/search-t040-tester-mock.spec.ts`, `e2e/search-real.spec.ts`.
- Tests: `src/lib/domain/bookingRequest.test.ts`, `allergy.test.ts`, `dietary.test.ts`, `bookingValidation.test.ts`, `search*.test.ts`, `src/lib/api/booking-types.test.ts`; API `tests/api/bookings.test.ts` + `tests/api/booking-helpers.ts`; RLS `tests/rls/booking-api.test.ts`; `tests/rls/visibility.test.ts` (function snapshot gains the two date helpers); `tests/api/free-trial*.test.ts` (grouped block log).
- Docs: `docs/data-model.md`, `docs/domain-rules.md`, `docs/lessons-learned.md`.

## How to verify
- `npm run lint && npm run typecheck && npx prettier --check . && npm test` (unit: 1457 pass). `npm run build` passes.
- `npm run test:rls` and `npm run test:api` need the local Supabase stack (no Docker on the builder's Mac), so they ran in CI only. CI run 38097797029 (PR #95): lint, typecheck, prettier, unit 1457 (+3 expected fail), build, RLS 126, API 471, Playwright real 41, Playwright mock 120, seed: all green.
- The SQL was also run in PGlite (scratch folder, not committed) for syntax and logic: create (trial, double booking, limit, unavailable, today), answer, expiry, clear, date helpers, block log.
- Manual contract walk-through: sections 7A, 5B, 7, 11A of `docs/api-contract.md`.
- Suggested Tester focus (section 10): double booking (parallel), D-28 race (5 parallel creates give 3), D-19 expiry (set `bookings.expires_at` in the past with the service role, then GET/accept), D-22 (clear vs book race), allergy conflict with synonyms, second free trial (same customer, address, phone, parallel), unauthorized reads (another customer, another chef, admin 403, anonymous 401), address/phone hidden before acceptance (response text, not only fields), chef's home kitchen address after accept, past/today/4 days/out-of-window dates, outside radius, hidden chef identical 404, stale-date search/page.

## Known gaps or risks
- API and RLS tests could not be run locally (no Docker); they pass in CI (numbers above). The race tests (parallel creates, accept vs decline, clear vs book) passed once; the Tester should run them a few times.
- Expiry is lazy (no scheduler): documented in the contract; a cron call of `expire_stale_bookings(null)` is recommended before launch (WO-7).
- `completed`, `cancelled`, `no_show_*` are not set by any route yet (T-063); nothing sets `completed` at all, which reviews (WO-5) need: open question.
- Notification rows are created; there is no notification read route (WO-5). The browser can read its own rows under RLS.
- `estimate` and `create` use the service role to read the chef's availability and booked dates (after the customer role check); the detail and list routes use the caller's own session.
- The free-trial claim is written inside `create_booking`; `holdFreeTrial` stays for stand-alone use and is no longer called by a route.
- No rate limit on `POST /api/bookings` beyond D-28 (no value was specified).
- The mock adapter (`src/lib/mocks/mock-search.ts`) still lists today in `bookableDates` and has no `firstBookableDay` (T-062). `e2e-mock/search-t040-tester-mock.spec.ts` "honest wording ... booked days are not removed" still passes but the UI text is now untrue (T-062/T-043).
- A request for tomorrow expires at 00:00 Toronto tonight if unanswered (D-27 with D-19); the T-043 UI must say so (`wouldExpireAt` in the estimate).
- Unclear in the spec (not invented): who may mark `completed`; whether the chef must tick "I read the intake" before accepting (built as: the intake is in the chef's detail, no extra step); whether `decline` needs a reason (built as optional, 3 to 500 characters).

## What the next agent needs
- Frontend (T-043, T-045, T-062): build against `docs/api-contract.md` section 7A; error codes `DOUBLE_BOOKED`, `TOO_MANY_OPEN_REQUESTS`, `REQUEST_EXPIRED`, `DATE_BOOKED` (carries `error.dates`), `FREE_TRIAL_USED` (retry with `useFreeTrial: false`); `error.issues` and dotted `fields` keys such as `days.0.date`, `intake.allergies`, `address.postalCode`. `GET /api/chefs/:id` now has `firstBookableDay`; search `date` must be tomorrow or later.
- T-063: route shapes are PROPOSED in section 7A. Use `applyFreeTrialEvent` after saving; `freeTrialEffect("cancelled")` needs the D-26 "cooked" marker. The `bookings_sync_days` trigger already frees dates for `expired`; for cancelled/no-show decide what the dates do. The expiry sweep only repairs `declined` and `expired` claims on purpose. Rejecting a chef (D-22) must cancel `requested` and flag `accepted`; `create_booking` locks the chef row `FOR SHARE` so a reject waits for an in-flight booking.
- T-043: tell the customer when day 1 is less than 48 hours away (late-cancellation window, D-20) and that kitchen addresses appear only after acceptance.
- T-062: mock adapter follow-ups above; admin mock 409s.
- Tester: test helpers `tests/api/booking-helpers.ts` (`bookableChef`, `bookingCustomer`, `book`, `accept`, `decline`, `makeStale`). API tests share one database: use unique cuisine tags.

## Round 2 (after the Tester PASS)
- **D-34:** the decline reason is required. Missing, null, blank or whitespace only gives 422 `VALIDATION_FAILED` with `fields.reason`; 3 to 500 characters. `DeclineBookingRequest.reason` is now required in `types.ts`. Contract section 7A updated. Tests: `tests/api/bookings.test.ts` (new D-34 test replaces "decline without a reason works"); the test helper `decline()` now sends a default reason, so the Tester file is unchanged.
- **Privacy guard:** `src/lib/domain/contactDetails.ts` `findContactDetails(text)` returns `phone`, `email`, `url` or null (unit tests in `contactDetails.test.ts`). The decline route answers 422 `CONTACT_DETAILS_NOT_ALLOWED` with `fields.reason`, nothing saved. New error code in `errors.ts` and `types.ts`. Documented in the contract as best effort (README known limit: spelled-out digits, obfuscated emails and street addresses get through).
- **Open question for Jimmy:** street addresses in free text are not detected (not tried, as instructed).
- **T-063 carry-ins:** D-33 (chef marks "visit done"; the booking completes 24 hours after the last day unless a no-show or problem was reported; answers open point 14) and D-35 (no extra create rate limit; D-28 is enough; closes the "no rate limit" gap above). T-063 and WO-5 should call `findContactDetails` on cancel reasons and chat messages sent before acceptance. Nothing of D-33 or D-35 is built here.
