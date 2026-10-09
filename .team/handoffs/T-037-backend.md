# Handoff: T-037 Domain rules (TDD)

From: backend  To: tester

## What changed
- Branch: `feature/T-037-domain-rules`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/84 (Closes #25)
- Files (all in `src/lib/domain/`, each with a `.test.ts` unless noted): `config.ts` (constants, no test), `money.ts`, `pricing.ts` + `pricing.test.ts`, `visitLimit.ts`, `distance.ts`, `allergy.ts`, `receipt.ts`, `eatBy.ts`, `cancellation.ts` (the last three tested in `rules-small.test.ts`), `bookingValidation.ts` + `bookingIntake.ts` + `bookingValidation.test.ts`. Changed: `dishes.ts` (allergen limit counts after merging; new `ALLERGENS_RAW_MAX = 50`), `dishes.test.ts`, `src/lib/chef/dishes-edge.test.ts` (the F4 "documents current behaviour" test now asserts the fixed behaviour), `docs/api-contract.md` line 193 wording, new short `docs/domain-rules.md`. No routes, no migrations, no UI.

## Rules built
- **Estimate** `estimateBooking`: per day and total cook minutes (sum of minutes x quantity), labour = minutes x hourly rate / 60, ingredients (cost x quantity), travel (customer's home only), platform fee (shown, `platformFeeCollected: false`), free-trial waiver, total, warnings. Integer cents only. **Rounding rule: every division rounds half up using integer maths (`money.ts`), once per visit day; booking figures are the exact sum of the day figures; total = labour + ingredients + travel.** Throws `RangeError` on non-integer or negative money, zero quantity, no days, or a missing distance for customer's home.
- **6-hour soft limit** `checkVisitLimits`: a warning per day strictly over the limit (exactly 360 is fine). In `validateBooking` each warning is also a blocking `VISIT_TOO_LONG` error.
- **Booking validation** `validateBooking(req, chef, ctx)` returns `{ok, errors[], warnings, allergyConflicts, distanceMetres, days}`; every problem is reported with a stable code: `DAYS_COUNT, DATE_INVALID, DATE_DUPLICATE, DATE_IN_PAST, DATE_BEYOND_WINDOW, CHEF_NOT_BOOKABLE, LOCATION_NOT_OFFERED, CHEF_HOME_NOT_ENABLED, CHEF_UNAVAILABLE, DOUBLE_BOOKED, POSTAL_NOT_GTA, CHEF_NO_SERVICE_AREA, OUTSIDE_SERVICE_AREA, NO_DISHES, DISH_NOT_FOUND, DISH_INACTIVE, DISH_DUPLICATE, QUANTITY_INVALID, VISIT_TOO_LONG, INTAKE_MISSING, ALLERGY_NOT_ACKNOWLEDGED`. Today is allowed; last bookable day = today + 180 (D-15); a chef who is not `approved` returns only `CHEF_NOT_BOOKABLE`; chef's home needs the option AND `chefHomeEnabled`; customer's home needs a full GTA postal code and distance <= radius (exact boundary tested); another chef's dish answers `DISH_NOT_FOUND`.
- **Allergy** `findAllergyConflicts`: lower-case and trimmed, free text split on comma/semicolon/slash/newline, singular/plural tolerant, phrase match inside a sentence ("severe peanut allergy" matches "peanuts"). `soybean` does not match `soy`. No synonyms.
- **Receipt** `checkReceipt`: mismatch when |receipt - estimate| > max(15% of estimate, 500 cents); returns the signed difference and tolerance.
- **Cancellation** `cancellationTiming`: on_time up to 48 h before 00:00 Toronto on day 1 (inclusive), else late; DST-safe `torontoStartOfDay`; `consumesFreeTrial` is always false. `freeTrialEffect(status)` (A-16): completed and no_show_customer consume; declined, cancelled, no_show_chef and `expired` (a request that expires) release; requested and accepted hold.
- **Eat-by** `eatByDate(cookDate, shelfLifeDays)`. **Distance** `haversineKm`, `distanceMetres`, `centreForPostal` (null for malformed or non-GTA).
- **Backlog fixed**: `allergenList` counts distinct allergens (14 ticked + a retyped one accepted; 15 distinct refused; more than 50 raw entries refused).

## Added after the coordinator's message (A-13 to A-17 and T-028 follow-up)
- A-13/A-14 already matched; IDs now cited in `config.ts`, `pricing.ts`. A-15 changed to 15%. A-16 `expired` event added. A-17 `dietary.ts`: `chefMatchesDietary(dishes, avoid)` (chef matches if one active dish avoids every selected allergen; lower-case compare) and `dishAvoidsAllergens`.
- `phone.ts`: rejects N11 area codes and exchanges (911, 411, 211...). `address.ts`: `normalizePostalCode` now follows Canada Post letters (no D F I O Q U anywhere; no W or Z first). Tests added.
- Seed data fixed because of this: `scripts/seed-data.ts` had `L6P4D4` and `L4K6F6` (now `L6P4C4`, `L4K6E6`; prefixes unchanged). Hosted DB has no seed yet, so no data migration. The DB check regex still only checks shape.
- `npm run build` shows a prerender log "api: unhandled error ... cookies() ... /api/admin/chefs" but exits 0; it is the known T-036 backlog (`await connection()`), fixed in T-039.

## ASSUMPTION constants (all in `config.ts`, none decided by Jimmy)
- `PLATFORM_FEE_PERCENT = 10` (A-8 / Q-5); `TRAVEL_RATE_CENTS_PER_KM = 60`, one way, charged per visit day (A-8 / Q-5); `DEFAULT_SERVICE_RADIUS_KM = 15` (A-8 / Q-5)
- `FREE_CANCELLATION_HOURS = 48` (A-6 / Q-8); "first day starts" = 00:00 Toronto
- `RECEIPT_TOLERANCE_PERCENT = 15`, `RECEIPT_TOLERANCE_MIN_CENTS = 500` (A-15, pending Jimmy; updated after the coordinator's message from 10%)
- `MAX_DISH_QUANTITY = 10` (invented placeholder)
- Modelling choices to confirm: A-13/A-14 as given by the coordinator: platform fee is on the labour actually charged (0 on a free trial) and is NOT added to the total; free trial waives labour for all its days; travel fee repeats for each visit day.
- Requirements, not assumptions: 1-3 days, 6-hour limit (`VISIT_SOFT_LIMIT_MINUTES`), D-15 window (uses `AVAILABILITY_HORIZON_DAYS`).

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (all pass locally).
- Unit tests: 595 total (512 on main). `npx vitest run src/lib/domain` for just the rules. Money property test: 500 seeded random bookings (integers, non-negative, parts sum to total, chef's home has no travel, free trial has no labour).
- CI: see PR #84 `ci` run (final run id in the Planner report).
- Local order: the allergen test was written first and shown failing against the old code. For the rest, tests and code were written together; the Tester should treat boundary mutations as welcome (try changing `>` to `>=` in `bookingValidation.ts` and `cancellation.ts`).

## Known gaps or risks
- Not pure rules, so not here: chef no-show / customer no-show handling and customer unable to pick up meals at the agreed time (chef's-home) need status transitions and a time model (T-042/WO-4b); duplicate / malformed phone numbers and second free trial are T-038 (phone.ts already exists).
- Chef cancel timing: same 48 h rule as the customer, any penalty undecided (Q-8). Q-17 (chef clears a date with a booking, chef rejected with bookings) is not a domain rule yet.
- The window upper bound uses the server's `today`; the caller must pass Toronto today (`torontoToday`).
- Allergy matching has no synonyms or cross-reactivity (documented in `allergy.ts`).
- Receipt tolerance and max quantity are invented placeholders (listed above).

## What the next agent needs
- T-039 (search): reuse `centreForPostal`, `distanceMetres`, `haversineKm` and `DEFAULT_SERVICE_RADIUS_KM`; filter the radius for customer's home. T-042 (booking API): load the chef with `availableDates`, `dishes` (with `chefId`), `chefBookedDates` (active booking days for the chef, A-9), `centres` from `postal_prefixes`, call `validateBooking`, then `estimateBooking` with `days.map(d => ({dishes: d.dishes}))` and `distanceMetres`; store `eatByDate(date, shelfLifeDays)` per dish line and `cancellationTiming` + `freeTrialEffect` on status changes. Map codes to HTTP: `CHEF_NOT_BOOKABLE` 404, `DOUBLE_BOOKED` 409, the rest 422. The database triggers stay the last line.
- Tester: edge cases from CLAUDE.md 10 covered by pure rules: double booking, cancel timing, allergy conflict, receipt mismatch, 6-hour limit, past date, more than 3 days, outside service area, chef's home not offered / not enabled, non-GTA postal code, pending or rejected chef. Try DST days, quantity limits, `NaN`, and unusual unicode in allergies.
