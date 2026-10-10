# Work Order WO-4b: Phase 4 (part 2) — Booking, grocery options, chef dashboard

Tasks: T-061, T-042, T-044, T-062, T-043, T-045
Approval: pre-approved by Jimmy on 2026-10-07 (WO-3 to WO-6, D-13). Booking rules decided by Jimmy on 2026-10-10 (D-18 to D-29). Quality over speed: every task goes Builder → Tester → Reviewer.

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-061 Rule changes from D-21, D-24, D-25 (new) | D-21: flag an approved chef with a `failed` MOCK check in the admin list; kitchen review only for `pending` or `approved` chefs; rejecting a chef turns `chef_home_enabled` off (new `create or replace` migration of the T-035 functions, with the drift guard test). D-24: fixed allergy synonym and spelling map in `src/lib/domain/allergy.ts`. D-25: `GET /api/chefs/:id` returns the same 404 for a chef with no bookable location option. Contract and tests updated. | M | Migration drift between SQL and TypeScript; guard test |
| backend | T-042 Booking API | Contract v1.4 first. Create (1–3 days, dishes per day, location type, mandatory intake with explicit answers D-23, allergy conflict acknowledgement, grocery option, estimate snapshot from T-037), accept / decline, cancel (D-20 timing; D-26 free-trial effect), no-show (chef and customer), expiry after 72 h or at the start of day 1 if sooner (D-19), at least 24 h notice (D-27), at most 3 open requests per customer (D-28), missed pickup: propose a new pickup time up to the eat-by date, then "pickup missed" = customer no-show (D-29), D-26 needs a stored per-day "cooked" marker defined in contract v1.4 and passed to `freeTrialEffect`, kitchen-address change during an accepted chef's-home booking (contract §11 N3), eat-by dates (A-7), in-app notifications (A-5). Booking row and free-trial hold in ONE transaction or SQL function (T-038 reviewer MEDIUM). Re-check approved, `chef_home_enabled`, radius, availability and double booking at create time; remove booked dates from search and the chef page (A-19). A chef cannot clear a booked date (D-22); rejecting a chef cancels their `requested` bookings and flags `accepted` ones (D-22; the flag is stored here and shown in the WO-5 admin bookings list). Verified phone required (T-057). Server-side guards on every booking route. | L | Races (double booking, free trial); conditional writes and parallel tests |
| backend | T-044 Grocery options API | Option A: chef's shopping list from the chosen dishes. Option B: chef uploads a receipt (own-folder storage path rules, insert-only), amount, mismatch flag against estimated ingredients (A-15), customer confirms. No grocery API, no markup. Booking parties only (RLS and route checks). | M | Receipt privacy; RLS tests |
| frontend | T-062 UI updates from D-21, D-22, D-25 (new) | Starts after T-042 merges (the 409 comes from T-042). Admin queue flags an approved chef with a failed MOCK check; kitchen review controls hidden for rejected chefs; availability calendar shows the 409 when a booked date is cleared; chef page drops the "cannot be booked yet" state (D-25 makes it a 404) and the mock adapter follows. Saved search: `parseSavedForm` uses `TEXT_MAX` (40) from `src/lib/domain/search.ts`, not 200 (T-041 tester INFO 4). Add a shared storage-block fixture to `e2e-mock/helpers.ts` and use it in every photo-rendering mock spec (PR #92 review). | S | None notable |
| frontend | T-043 Booking flow UI | From the chef page: days and dishes, location (customer's home address or chef's home), intake form with explicit answers (D-23) and allergy acknowledgement, grocery option, estimate (time, labour, ingredients, travel, platform fee shown not collected), 6-hour warning, free-trial label, MOCK payment step (D-18), 24-hour notice (D-27) and the 3-open-requests error (D-28). Tell a chef's-home customer the kitchen address is shared only once the booking is accepted (T-033). Server-side guards on private pages. | L | Accessibility of a long form; axe and keyboard tests |
| frontend | T-045 Grocery screens and chef booking dashboard | Chef dashboard: requests with intake and allergy conflicts, accept / decline, eat-by dates; missed-pickup flow (D-29): customer proposes a new pickup time, chef accepts or marks "pickup missed"; grocery option A list and option B receipt upload with mismatch flag; customer confirms a receipt. | M | Private data on pages; server guards |
| tester | Verify every WO-4b PR | Unit, API, RLS and e2e. §10 cases: double booking; cancel and timing; chef and customer no-show; allergy conflict; second free trial; receipt mismatch; over 6 hours; past date and more than 3 days; outside service area; chef's home not offered; cannot pick up meals at the agreed time (chef's home); unauthorized access to another user's bookings and address. | M | None notable |
| reviewer | Review every WO-4b PR | Security, privacy, MOCK honesty, contract match, accessibility, plan compliance. | M | None notable |

Order: T-061 → T-042 → T-044 (backend, one at a time). Frontend: T-062 after T-061 and T-042; T-043 after the T-042 contract (v1.4) is merged; T-045 after T-044. Backend and frontend may run in parallel in separate worktrees when dependencies are met.

## Status rule (D-17)
Before starting any agent, the Planner records its status with `--task` and `--progress 0`. Every prompt tells the agent to run `team-status` with `CLAUDE_PROJECT_DIR` set to the main folder and to report `--task` and `--progress` at 25, 50, 75 and 100.

## Carried in from earlier tasks
- T-037: pass `torontoToday()` as `ctx.today`; `chefBookedDates` must match the `is_active` index; map `CHEF_NOT_BOOKABLE` to 404 and `DOUBLE_BOOKED` to 409; build the intake allergy field from `ALLERGEN_CHOICES` plus free text; no-show and meal-pickup handling (now D-29).
- T-038: set `bookings.is_free_trial` only when the hold succeeds; call `applyFreeTrialEvent` on every status change and on expiry, only from a route that has authorized and saved the change; contract §11A additions (409 `INVALID_STATE` for re-holding, 403 for admins); rate-limit or group the free-trial block log.
- T-033 (owner T-043 for customers, T-045 for chefs): tell chefs the kitchen address is shared once a chef's-home booking is accepted; keep removed kitchen photos hidden from customers.
- Contract §11 N3 (owner T-042): kitchen-address change during an accepted chef's-home booking.
- T-041: enable Book when the chef has at least one place to cook; reuse the dish cost and allergen display; keep the "estimate" wording.

## Left out
Messaging, reviews, reports, admin lists (WO-5). Bidi characters (T-060). Hosted seed data (needs Jimmy). Deploy (WO-7).

## Recommendation
Approve (pre-approved). The rule changes go first so booking is built on the decided rules.

## Decision
Pre-approved by Jimmy 2026-10-07 (D-13); rules D-18 to D-29 decided 2026-10-10 (D-27 to D-29 after the PR #92 review). Recorded as `WO-4b-backend`, `WO-4b-frontend`, `WO-4b-tester`, `WO-4b-reviewer`.
