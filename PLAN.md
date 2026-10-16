# CookNeighbour — Plan and Task Board

Owner: Planner. Approver: Jimmy. Source of truth for requirements: `CLAUDE.md`.
Status: **Approved by Jimmy 2026-10-07.** WO-1 (Phase 2a) approved and finished 2026-10-07. WO-2 (Phase 2b) approved and finished 2026-10-07. WO-3 to WO-6 pre-approved by Jimmy 2026-10-07 (D-13). Every later phase still needs its own Work Order.

---

## 1. Environment check (CLAUDE.md §5) — 2026-10-07

| Item | Result |
|---|---|
| Git | OK, 2.39.2 |
| Node.js / npm | OK, v24.21.0 / 11.19.0 |
| GitHub CLI | OK, 2.102.0, logged in as Jimmyvo23 |
| Repo + remote | OK, `Jimmyvo23/cookneighbour`, public (decision D-1) |
| VS Code | Installed. `code` command not on PATH (optional fix: Command Palette → "Shell Command: Install 'code' command in PATH") |
| Dev server | OK, verified in T-020 (Tester, fresh clone, 2026-10-07). |
| `main` branch protection | OK, set in T-024 (2026-10-07). |
| Supabase CLI, Vercel CLI | Not installed. Use through `npx` (Homebrew is broken on this Mac). |
| Docker | Not installed. Not needed (decision D-2). |

## 2. Requirements, preferences, assumptions, recommendations

### Requirements (from CLAUDE.md — only Jimmy changes these)
Everything in CLAUDE.md §3, §6, §10, §11 and §12. Highlights the plan is built around:
- R-1 Customer finds an approved chef by location and cuisine, sorted by distance (§6.3).
- R-2 Booking 1–3 days, dishes per day, location type `customer_home | chef_home`, mandatory intake form, grocery option A/B, estimate (§6.4, §6.5).
- R-3 Soft 6-hour limit per visit, configurable (§6.5).
- R-4 One free-labour booking per customer, enforced by hashed verified phone plus hashed normalized address (§6.6).
- R-5 Chef onboarding with mocked ID, food-handler, police check, kitchen check; admin approval (§6.7, §6.9).
- R-6 Realtime chat per booking; contact details hidden until accepted (§6.8).
- R-7 Reviews only after completed booking; report-a-problem on every booking (§6.7).
- R-8 All money, identity, police and SMS flows mocked and labelled **MOCK** in UI and code (§11).
- R-9 `country`, `currency`, `language` stored on relevant records (§3).
- R-10 Every §10 edge case handled and tested.

### Preferences (Jimmy's choices)
- P-1 Repo is public so GitHub Free enforces branch protection (D-1).
- P-2 Hosted free Supabase for dev and demo; throwaway local Supabase in CI (D-2).
- P-3 Deploy to Vercel once, in Phase 6, under its own Work Order (D-3).
- P-4 Branch protection on `main` requires CI only, no required reviews (D-6).
- P-5 Jimmy wants to learn GitHub: each GitHub step is explained briefly the first time it is used.

### Assumptions (need Jimmy's confirmation; never treated as requirements)
- A-1 **Location:** a seeded table maps GTA postal-code prefixes (first 3 characters, e.g. `L5B`) to a centre point. Distance = straight-line (haversine) in code. Postal codes whose prefix is not in the table are rejected as non-GTA. No geocoding service.
- A-2 **Address normalization for the free-trial hash:** lowercase, trim, collapse spaces, strip punctuation, standard street abbreviations (Street→st, Avenue→ave…), unit number kept, postal code uppercase without space. Hash = HMAC-SHA256 keyed with a server-only secret (`HASH_PEPPER`), domain-separated (`phone:` / `address:`).
- A-3 **Phone:** normalized to Canadian E.164 (`+1XXXXXXXXXX`); anything else is malformed. Hashed like A-2.
- A-4 **Login** uses Supabase Auth email + password. Phone verification is a separate step with a **MOCK** SMS code (real SMS OTP needs a paid provider).
- A-5 **Notifications** are in-app only (a notifications list and badge). No email or push.
- A-6 **Cancellation timing:** free cancellation until 48 hours before the first day; later cancellations are recorded as "late". A cancellation before the visit never consumes the free trial (§6.6). *Confirmed by D-20 (2026-10-10).*
- A-7 **Eat-by date** = cook date + the dish's shelf-life days (default 2).
- A-8 **Fee defaults:** platform fee 10%, travel fee $0.60/km one way, chef travel radius default 15 km. Configurable constants. *Placeholders — see Q-5.*
- A-9 **One visit per chef per date.** A second booking for the same chef and date is a double booking.
- A-10 **Payments:** pure mock "payment step" with a MOCK badge; no Stripe integration in V1. *Confirmed by D-18 (2026-10-10).*
- A-11 **Seed accounts** (admin, demo customer, demo chefs) use known demo passwords, documented in the README. Seed data only; no real personal data.
- A-12 Money stored in cents (integer) with `currency = 'CAD'`.
- A-13 **Travel fee** (customer's home only): charged per visit day; distance = straight-line (haversine) from the chef's service-prefix centre to the customer's address-prefix centre (A-1); fee = distance × A-8 rate, one way, whole cents per day. *(WO-4a, from the PR #83 review.)*
- A-14 **Platform fee** = A-8 percentage of **labour only**; never on ingredients (no grocery markup, §6.4) or travel. A free-trial booking has $0 labour, so $0 platform fee.
- A-15 **Receipt mismatch** is flagged when the receipt differs from estimated ingredients by more than the larger of 15% or $5.00 (configurable).
- A-16 **Free-trial claim** (extends §6.6): released when the chef declines, the request expires, the chef does not show up, or the booking is cancelled before the visit; consumed when the booking is completed or the customer does not show up. *Changed by D-26: a cancellation after at least one day was cooked consumes it. D-29: a missed chef's-home pickup counts as a customer no-show.*
- A-17 **Dietary filter:** chefs and dishes carry allergens only, so "dietary needs" in search means allergen exclusion: a chef matches when at least one active dish is free of every selected allergen. Diets such as vegetarian or halal are not supported in V1 (see Q-18).
- A-18 **Search area:** a city search uses the average of that city's prefix centres. For customer's-home results, chefs whose service radius does not reach the search point are left out, unless they offer chef's home (`approved` AND `chef_home_enabled`), in which case they are shown marked "chef's home only".
- A-19 **Bookable dates on the public chef page** are the chef's ticked dates inside the D-15 window. Already-booked dates are removed once bookings exist (WO-4b, T-042).
- A-20 **Incomplete approved chefs** (interim for Q-13): search leaves out an approved chef with no bio, no photo or no active dish.
- A-21 **Dish quantity:** at most 10 of one dish per visit day (`MAX_DISH_QUANTITY`); cook time and ingredient cost scale linearly with quantity. *(T-037 builder placeholder.)*
- A-22 **Cancellation timing detail:** day 1 starts at 00:00 Toronto time; the 48-hour cutoff (A-6) is inclusive; a chef cancellation uses the same timing.
- A-23 **Rounding:** labour, travel and platform fee are each rounded half up to whole cents once per visit day; the total is the sum of the rounded lines.
- A-24 **Allergy matching:** a dish allergen conflicts with the intake when the intake contains its words in order, or when any intake word (ignoring filler such as "allergy", "severe") equals any allergen word; lower case, punctuation stripped, a trailing "s" ignored on words longer than 3 letters. Over-warning is accepted; a conflict is a warning the customer acknowledges. *Changed by D-24:* a small fixed synonym and spelling map is applied (T-061). (Separately, a dish's raw allergen input is capped at 50 entries before de-duplication.)
- A-25 **Search without a location** returns approved chefs ordered by rating, then name; no distance. An absent `locationType` behaves like customer's home (A-18).
- A-26 **Pickup confirmation per day** (T-071, D-55): the customer confirms "I picked up my meals" for each cooked day of a chef's-home booking (`POST /api/bookings/:id/days/:n/pickup/confirm`). *Planner default, Jimmy to confirm.*
- A-27 **When it is allowed:** once that day is cooked, while the booking is `accepted` and the pickup has not been marked missed; the deadline passing does not block it; confirm and missed lock the same booking row, so the first one wins. *Planner default, Jimmy to confirm.*
- A-28 **No undo; refused while frozen** (D-65). Confirming also voids that day's open or agreed pickup proposals, and proposing on a confirmed day is 409 `picked_up` (builder's choice). *Planner default, Jimmy to confirm.*
- A-29 **Missed pickup** needs a cooked day that is past its deadline and not confirmed: 409 `pickup_confirmed` when every cooked day past its deadline is confirmed; `pickup_window_open` when none is past yet. Auto-completion is unchanged: a chef's-home booking still waits for every pickup deadline even when every day is confirmed (follow-up T-081). *Planner default, Jimmy to confirm.*

### Recommendations (Planner's, accepted with this plan unless Jimmy objects)
- Rec-1 Business rules as pure functions in `src/lib/domain/`, written test-first with Vitest. They hold the risk (pricing, free trial, limits) and are cheap to test.
- Rec-2 Row-level security on every table, with automated RLS tests run against local Supabase in CI.
- Rec-3 API routes in `src/app/api/` documented in `docs/api-contract.md`; Frontend builds against the contract (mocked until the route exists).
- Rec-4 All mocks live in `src/lib/mocks/`, each exporting a clearly named `mock*` function, and the UI shows a `<MockBadge/>` wherever one is used.
- Rec-5 Vitest (not Jest): faster and simpler with TypeScript.
- Rec-6 Split Phase 2 into **2a Tooling** and **2b Data** so the first approval is small.

## 3. Architecture (approved in brainstorming, 2026-10-07)

- **One Next.js app** (App Router, TypeScript, Tailwind, mobile-first). No separate server.
- `src/lib/domain/` — pure business rules: `pricing`, `visitLimit`, `freeTrial`, `allergyConflict`, `receiptCheck`, `cancellation`, `distance`, `bookingValidation`. No database access.
- `src/lib/supabase/` — browser and server clients. `src/lib/mocks/` — SMS, ID, food-handler, police check, kitchen check, payment.
- `src/app/api/` — route handlers that load data, call domain functions, and write through Supabase (RLS applies).
- `supabase/migrations/` — schema and RLS policies. `supabase/seed.sql` (plus a TS seed script for generated data).
- **Realtime chat** via Supabase Realtime on `messages`. **Maps** via Leaflet + OpenStreetMap tiles.
- **Storage buckets:** chef documents (private, admin-only read), dish and profile photos (public URLs, no listing), kitchen photos (private, D-10), receipts (booking parties only).

### Core data model
| Table | Key fields |
|---|---|
| `profiles` | user id, role (`customer`/`chef`/`admin`), display name, `phone_hash`, `phone_verified`, `address_hash`, home address (private), postal prefix, country, currency, language |
| `chefs` | profile id, status (`pending`/`approved`/`rejected`), reject reason, bio, photo, cuisines, languages, hourly rate, service prefix + radius, `location_options` (`customer_home`, `chef_home`), kitchen status, `police_check_status`, id / food-handler mock status, allergen ack |
| `dishes` | chef, name, photo, description, cuisine, cook minutes, ingredient cost, servings, allergens, shelf-life days |
| `availability` | chef, date, available |
| `bookings` | customer, chef, status, `location_type`, `grocery_option` (`customer_buys`/`chef_shops`), is free trial, estimate snapshot, cancellation info, no-show flags, country, currency |
| `booking_days` / `booking_day_dishes` | date, dishes, eat-by date |
| `intake_forms` | booking, allergies, dietary notes, allergy-conflict acknowledged |
| `receipts` | booking, file, amount, mismatch flag, customer confirmed |
| `messages`, `notifications`, `reviews`, `reports` | per booking |
| `free_trial_claims` | customer, booking, `phone_hash` unique, `address_hash` unique, state (`held`/`consumed`/`released`) |
| `postal_prefixes` | prefix, city, lat, lng (GTA only) |

### Testing and CI
- Unit: Vitest for `src/lib/domain` and helpers.
- RLS / API: Vitest against local Supabase (started with `npx supabase start` in CI).
- End to end: Playwright. A smoke test from T-020; the full demo path and §10 edge cases in Phase 6.
- GitHub Actions workflow `ci` on every PR: install → lint → type check → unit → local Supabase → RLS/API tests → Playwright. Branch protection requires it.

## 4. Task board

IDs start at **T-020** because T-001–T-019 were used for the Agent Team Kit (D-4). Each task gets a GitHub Issue with the same ID and a branch `feature/T-0NN-short-name`. The Tester verifies and the Reviewer approves every task (not listed as separate tasks unless they own the work).

### Phase 1 — Plan
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| — | This plan (PLAN.md) | planner | — | done |

### Phase 2a — Foundation: tooling (Work Order WO-1)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-020 | App scaffold: Next.js + TS + Tailwind, ESLint + Prettier, Vitest (one sample test), Playwright (home-page smoke test), npm scripts, `.env.example`, README setup stub | frontend | — | done |
| T-021 | Supabase setup: Jimmy creates hosted free project; `npx supabase init`, `src/lib/supabase/` clients, env vars in `.env.example`, connection check script | backend | T-020 | done |
| T-022 | CI workflow `.github/workflows/ci.yml` (lint, type check, unit, local Supabase, Playwright smoke) | backend | T-020, T-021 | done |
| T-023 | Issue and PR templates, labels (`owner:*`, `phase:*`), mirror board as Issues | planner | — | done |
| T-024 | Branch protection on `main`: require `ci` check, no required reviews, block force-push and deletion | planner | T-022 merged | done |

### Phase 2b — Foundation: data (Work Order WO-2)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-025 | Core schema migrations + RLS policies (all tables above) | backend | T-021 | done |
| T-026 | API contract v1 `docs/api-contract.md` | backend | T-025 | done |
| T-027 | RLS test harness + "no access to others' bookings, messages, addresses" tests | tester | T-025, T-022 | done |
| T-028 | Auth backend: sign-up as customer/chef, phone normalize + hash, MOCK SMS verify, address normalize + hash, chef starts `pending`, seeded admin | backend | T-025 | done |
| T-029 | Auth UI: sign-up, log-in, role choice, phone verify (MOCK badge), home address | frontend | T-026, T-028 | done |
| T-056 | Env variable rename (`…PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`), T-021 review fixes, CI hardening (#50) | backend | — | done |
| T-057 | Connect auth UI to real routes (mock off by default, route guards, e2e against real routes) | frontend | T-028, T-029 | done |
| T-030 | Seed data: GTA postal prefixes, cuisines, ~10 chefs (incl. Vietnamese in Mississauga; some pending/rejected), dishes, demo customers, admin | backend | T-025 | done |

### Phase 3 — Chef side (WO-3)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-031 | Chef onboarding API: profile, document uploads, MOCK ID / food-handler / police / kitchen checks, allergen and hygiene acks, location options | backend | T-028 | done |
| T-032 | Dishes and availability API | backend | T-025 | done |
| T-033 | Chef onboarding and profile UI | frontend | T-031 | done |
| T-034 | Dish menu and availability calendar UI | frontend | T-032 | done |
| T-035 | Admin chef-queue API: approve / reject with reason, kitchen review, police status | backend | T-031 | done |
| T-036 | Admin chef-queue UI | frontend | T-035 | done |
| T-058 | Lessons-learned file for all agents (`docs/lessons-learned.md`) | planner | — | done |
| T-059 | Reject unsafe text in display name and address (server; T-033 tester F1) | backend | T-028 | done |

### Phase 4 — Customer side (WO-4a: T-037 to T-041; WO-4b: T-061, T-042 to T-045, T-062 to T-066)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-037 | Domain rules (TDD): estimate, 6-hour limit, booking validation (1–3 days, past date, double booking, service area, chef-home offered), allergy conflict, receipt check, cancellation timing | backend | T-020 | done |
| T-038 | Free-trial rules: eligibility by phone and address hash, hold / consume / release | backend | T-028, T-037 | done |
| T-039 | Search API: approved chefs only, filters, distance sort | backend | T-030, T-037 | done |
| T-040 | Search and results UI with map | frontend | T-039 | done |
| T-041 | Chef detail page | frontend | T-039 | done |
| T-042 | Booking API: create, estimate, accept / decline, expiry, eat-by, notifications | backend | T-037, T-038, T-061 | done |
| T-043 | Booking flow UI: days and dishes, location, intake form, allergy acknowledgement, grocery option, estimate, 6-hour warning, free-trial label, MOCK payment step | frontend | T-042 | done |
| T-044 | Grocery option A shopping list and option B receipt upload with mismatch flag (API); also say in `docs/api-contract.md` that `days[].labourCents` is after the free-trial waiver (T-043 round 2) | backend | T-042 | done |
| T-045 | Grocery screens and chef booking dashboard (requests with intake, accept / decline, eat-by, missed pickup) | frontend | T-044, T-063 | done |
| T-061 | Rule changes from D-21, D-24, D-25 (admin MOCK checks, allergy synonyms, unbookable chef 404) | backend | T-035, T-037, T-039 | done |
| T-063 | Booking changes API: cancel, no-show, missed pickup, kitchen-address change, chef-reject cascade (split from T-042) | backend | T-042 | done |
| T-064 | D-22 flagged bookings: an open flag blocks auto and manual completion and the rejected chef's actions until an admin decides (T-063 review M3; scope set by D-53); D-53: frozen until an admin decides (no completion, no chef actions), customer sees a neutral notice; no refund or rebooking flow (payments are MOCK). From T-066 review: LOW-2 (optional; here or WO-7) order the `booking_flags` inserts in the sweep and `admin_reject_chef` by booking id (deadlock); NIT-1 update the `sweepExpired` comment in `src/lib/server/bookings.ts` for D-36. From T-074 review: L1 `answer_booking` D-59 check uses `coalesce(btrim(x),'') = ''` instead of `is null` (plus one RLS test); N1 fix the `set_chef_kitchen_address` header (JSON null on an array column gives an empty array). D-57: the `no_day_cooked` flag (D-36) does NOT freeze the booking; completing it resolves that flag automatically. | backend | T-063 | done |
| T-065 | Kitchen address privacy: snapshot the chef's kitchen address on the booking at acceptance and return it from `get_booking_contact`; N3 check and write in one locked database function (T-063 review M4, L4); D-52: phone and address hidden again 7 days after the last visit day, whatever the status (chat stays); D-56: a cancelled booking locks contact at once (not part of the 7-day window). | backend | T-063 | done |
| T-066 | T-063 small fixes and tests: D-36 auto-complete needs a cooked day, else flag for admin (update `tests/api/booking-changes.test.ts:336`); reject cascade skips stale requests (L1); completion voids accepted pickup proposals (L2); chef's-home auto-completion API test and SQL-vs-TS `completionDue`/`pickupDeadline` test (L5); D-37 a chef no-show after a cooked day uses the trial | backend | T-063 | done |
| T-062 | UI updates from D-21, D-22, D-25, D-27 (admin flag, booked-date 409, chef page 404) | frontend | T-061, T-042 | done |
| T-067 | Saved allergy profile: the customer's allergies and dietary notes are stored on their profile and prefill the intake form (D-38); needs a migration. Backend part done (PR #120); frontend part next, include the DELETE check-order swap (T-067 review LOW); T-073 review NIT: move the "Extra texts for the reasons..." doc comment in `src/lib/booking/changes.ts:23-24` back above `EXTRA_REASONS` | backend, frontend | T-043 | done |
| T-068 | Impeccable (impeccable.style) as Frontend's design skill: check licence and cost, project-level install, name it in `.claude/agents/frontend.md`, trial on the next UI task; proposed WO-6 step to run Impeccable's audit and polish once across all pages. **Own Work Order; Jimmy approves before anything is installed** | frontend | T-043 | done |
| T-070 | Chef dashboard follow-ups: chef cancels an accepted booking and reports a customer no-show (routes exist; Jimmy 2026-10-14); kitchen note wording "This booking no longer locks your kitchen address" (T-045 Reviewer N1); customer booking page says details "shared once the chef accepts" also on declined, expired and cancelled bookings (T-045 Tester round 3, from T-043) | frontend | T-045 | done |
| T-071 | D-55 customer confirms "I picked up my meals" on a chef's-home booking; after that the chef cannot mark the pickup missed (API + UI) | backend, frontend | T-066 | done |
| T-072 | UI follow-ups from T-066: show "waiting for a check" on an accepted booking whose days are all past and uncooked; chef no-show trial wording follows D-37 (`BookingDetailView.tsx`, `changes.ts`); prompt the chef to mark past days cooked | frontend | T-066, T-070 | done |
| T-073 | UI follow-ups from T-065 and T-072: booking pages explain D-52 (phone and address hidden 7 days after the last visit day; chat stays) and show `contactVisibleUntil` in Toronto time; "Contact details are hidden now" after the cut-off (T-065 review L3); hide the customer's Cancel button when every visit is past (T-072 L-B); plural "Mark them as cooked" (T-072 NIT); hide the mark-cooked prompt on D-53 frozen bookings once T-064 adds a flag field (moved to T-077); Tester L-A ("waiting for a check" shows up to 2 days before the server flag) waits on Q-35 | frontend | T-065, T-072 (T-064 for the freeze item) | done |
| T-074 | Backend follow-ups from T-065: D-58 kitchen photos follow the D-52 window; D-59 refuse accept when chef's home is enabled but no kitchen address is saved; review L1 (kitchen RPC and `chefs` columns in one transaction) and N1-N5 (lock mode, explicit table revoke, `privColumns` assert, indentation, snapshot retention note) | backend | T-065 | done |
| T-075 | One timeout for every API call in `src/lib/api/client.ts` (for example `AbortSignal.timeout`) with a clear error message (T-067 Tester INFO, review recommendation; Jimmy asked for it 2026-10-15) | frontend | T-067 | done |
| T-076 | T-067 review follow-ups: focus moves to the confirm question when "Delete saved profile" opens it and to the saved-state line after a delete (LOW); untick the hidden save box when answers match the profile again (NIT); contract wording "(400, PUT and DELETE)" (NIT). Done inside T-077 | frontend | T-067 | done |
| T-077 | Frozen booking UI: neutral "on hold" notice for both parties from `BookingDetail.frozen`; hide the actions the server refuses (D-53, D-65), keep receipt confirm and dispute (D-66); `no_day_cooked` stays unfrozen (D-57); 409 `frozen` mapped to the same text; mock e2e with `hooks.frozenSeeded` (T-064 Tester INFO, review INFO-4); includes T-076 | frontend | T-064, T-067 | done |
| T-078 | T-077 follow-ups: an "On hold" marker on the booking list pages (Tester INFO-2); pin the chef's uncooked-day hint on its own in `FrozenBooking.test.tsx` (review round 2 NIT-1); optional mock clock hook so the e2e can prove missed-pickup is hidden on a frozen booking with a passed pickup window (Tester round 2 INFO) | frontend | T-077 | todo |
| T-079 | RLS test date clash: `booking-api.test.ts` exact `chefs_booked_on` lists broke when the fixed date 2026-10-31 in `booking-changes.test.ts` became Toronto today + 15 (red `ci` on PR #140); also the `groceries-tester` "fee" regex flake on random ids and URLs (D-70) | tester | none | done |
| T-080 | After a 409 from any booking change (for example a stale "pickup missed" press answered `pickup_confirmed`), reload the booking and keep focus on the alert, so dead buttons disappear; one shared fix for every change section (T-071 Tester and Reviewer LOW) | frontend | T-071 | todo |
| T-081 | Auto-completion for chef's-home bookings: decide whether a booking whose every cooked day is confirmed may complete without waiting for the pickup deadlines (A-29 follow-up); ask Jimmy first | backend | T-071 | todo |

### Phase 5 — Engagement (WO-5)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-046 | Messaging backend: Realtime, RLS, contact details hidden until accepted | backend | T-042 | todo |
| T-047 | Chat UI; D-63: put "Chat stays open." back into the contact-window text (`CONTACT_RULE`, `CONTACT_LOCKED_TEXT` in `src/lib/booking/changes.ts`) and flip the 4 `not.toContain` assertions | frontend | T-046 | todo |
| T-048 | Reviews (completed bookings only) and report-a-problem API; admin lists of bookings, reports, free-trial blocks; D-54: resolving a report, the admin picks the booking's final status (completed, cancelled, chef no-show, customer no-show) with a note; the free trial follows the existing rule for that status; D-57: an unresolved `no_day_cooked` flag is resolved the same way (admin picks the final status); resolving sets `booking_flags.resolved_at` and so unfreezes (D-67). From T-064 review: INFO-1 an upgraded flag keeps its original `created_at` (decide which time admin lists show), INFO-2 a resolved `chef_rejected` flag is not reopened by a second reject, LOW-2 the sweep re-locks due frozen and `no_day_cooked` bookings on every call (fine at prototype scale, or WO-7). From T-077: real-adapter freeze UI is untested (Tester INFO-3), cover it in T-050. From T-075 review INFO: after a timed-out write the user may retry; bookings are protected by the double-booking rules, but messages and reviews have no duplicate guard (consider an idempotency key) | backend | T-042 | todo |
| T-049 | Reviews, report button, admin lists UI | frontend | T-048 | todo |

### Phase 6 — Hardening (WO-6, deploy has its own WO-7)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-060 | Refuse bidi and zero-width characters in public text (issue #73); client/server agreement test | backend | T-059 | todo |
| T-050 | Playwright end-to-end demo path (§12 steps 1–5) | tester | Phase 5 | todo |
| T-051 | §10 edge-case test sweep and bug list | tester | Phase 5 | todo |
| T-052 | Accessibility pass (axe checks in Playwright) and fixes | frontend | Phase 5 | todo |
| T-053 | Security and privacy review of the whole app | reviewer | T-050, T-051 | todo |
| T-054 | README: setup, mocks list, known limits (include: contact snapshot rows are never deleted after the D-52 window, T-074 N5; a retention job is a later decision), demo script; open legal risks | planner | T-053 | todo |
| T-069 | Impeccable `audit` then `polish` once across all pages before the mentor demo (D-43; WO-6 step from T-068); fixes go through the normal Tester and Reviewer gate | frontend | T-052 | todo |
| T-055 | Vercel deploy (free tier, seed data only) — **separate Work Order WO-7** | backend | T-054 | todo |

## 5. Decisions log
| ID | Date | Decision | By |
|---|---|---|---|
| D-1 | 2026-10-06 | Repo public (branch protection on GitHub Free); overrides "private by default" | Jimmy |
| D-2 | 2026-10-07 | Hosted free Supabase for dev/demo; local Supabase only inside CI; no Docker on the Mac | Jimmy |
| D-3 | 2026-10-07 | Deploy to Vercel once in Phase 6 under its own Work Order | Jimmy |
| D-4 | 2026-10-07 | CookNeighbour task IDs start at T-020 (T-001–T-019 used by the kit) | Planner |
| D-5 | 2026-10-07 | Phase 2 split into 2a tooling and 2b data | Jimmy (design approval) |
| D-6 | 2026-10-07 | `main` protection requires CI only, no required reviews | Jimmy |
| D-7 | 2026-10-07 | Commit every handoff file for a task (builder, tester, reviewer) in `.team/handoffs/`, in the task PR or the next Planner PR | Planner |
| D-8 | 2026-10-07 | Rename Supabase key variables to match Supabase's new key names; fold Issue #50 into T-056 | Planner (Jimmy delegated) |
| D-9 | 2026-10-07 | Seed admin password comes from `SEED_ADMIN_PASSWORD` in `.env.local`, not the README, because the repo is public | Planner (Jimmy delegated) |
| D-10 | 2026-10-07 | Kitchen photos are private (chef, admin, customer of an accepted chef's-home booking); reverses the public-read line in §3 | Planner (Jimmy delegated), on Reviewer advice |
| D-11 | 2026-10-07 | A verified phone number belongs to one account only (unique index on verified `phone_hash`, 409 `PHONE_IN_USE`) | Planner (Jimmy delegated) |
| D-12 | 2026-10-07 | Routes are the only writers of `profiles`, `chefs`, `chef_private` (client UPDATE revoked); rejected chefs may edit and resubmit; admin approves only from `pending`; admin verify must name the reviewed files | Planner (Jimmy delegated), from T-026 review |
| D-13 | 2026-10-07 | WO-3 to WO-6 pre-approved; Planner writes each Work Order and starts without pausing. Quality over speed: full Builder → Tester → Reviewer on every task, no loosening of branch protection. WO-7 deploy and hosted seeding still need Jimmy | Jimmy |
| D-14 | 2026-10-08 | The allergen-awareness and kitchen-hygiene acknowledgement texts drafted in T-033 are confirmed as the prototype wording; remove the "draft" labels in T-034 (was Q-15) | Jimmy |
| D-15 | 2026-10-08 | Availability is opt-in: a chef marks bookable dates; the window is today to today + 180 days, Toronto time (server sends `today` and `lastBookableDay`) | Jimmy |
| D-16 | 2026-10-08 | Dish bounds kept: cook time 5–360 min, ingredient cost 0–50000 cents, servings 1–50, shelf life 0–7 days (default 2), at most 50 active dishes per chef | Jimmy |
| D-17 | 2026-10-08 | Before starting any agent, the Planner records its status with `--task` and `--progress 0`; every agent prompt asks for `--task` and `--progress` at 25, 50, 75 and 100 (`docs/lessons-learned.md` §1) | Jimmy |
| D-18 | 2026-10-10 | Payment step is a pure MOCK screen with a MOCK badge; nothing is charged and there is no Stripe (A-10 confirmed; was Q-9) | Jimmy |
| D-19 | 2026-10-10 | A `requested` booking expires 72 hours after it is made if the chef has not answered, or at the start of day 1 if that is sooner (Jimmy confirmed the day-1 cap on 2026-10-10, with D-27); expiry frees the date and releases the free trial (A-16) (was Q-11) | Jimmy |
| D-20 | 2026-10-10 | Cancellation is free until 48 hours before day 1; later is recorded as "late"; nothing is charged either way (A-6 and A-22 confirmed; was Q-8) | Jimmy |
| D-21 | 2026-10-10 | Admin MOCK checks (was Q-16): (a) an admin may reset a check, but an approved chef with a `failed` check is flagged in the admin queue; (b) kitchen review only for `pending` or `approved` chefs; (c) "checks pending" keeps ignoring the police check; (d) rejecting a chef turns `chef_home_enabled` off | Jimmy |
| D-22 | 2026-10-10 | A chef cannot clear a date that has an active booking (409); rejecting a chef cancels their future `requested` bookings and flags their `accepted` bookings for the admin (was Q-17) | Jimmy |
| D-23 | 2026-10-10 | The intake form needs an explicit answer for allergies and dietary needs (for example "none"); blank is refused (was Q-19) | Jimmy |
| D-24 | 2026-10-10 | Allergy matching uses a small fixed synonym and spelling map for the picker allergens (for example gluten and wheat, dairy and lactose and milk, shellfish and shrimp and crustaceans, nuts and peanuts, soya and soy, mollusks and molluscs, sulfites and sulphites), extending A-24 (was Q-20) | Jimmy |
| D-25 | 2026-10-10 | The public page of a chef with no bookable location option returns the same "not found" as other hidden chefs (was Q-21) | Jimmy |
| D-26 | 2026-10-10 | Cancelling a booking after at least one day was cooked consumes the free trial; cancelling before any day was cooked releases it (extends A-16; was Q-22) | Jimmy |
| D-27 | 2026-10-10 | No same-day bookings: the earliest day 1 is tomorrow (Toronto time). With D-19, a request for tomorrow expires at midnight if the chef has not answered. Replaces the first wording ("24 hours' notice"), which would also have blocked next-day bookings (PR #92 review round 2) | Jimmy |
| D-28 | 2026-10-10 | A customer may have at most 3 bookings in `requested` state at once (configurable constant); a fourth request gets a clear error (second half of Q-11) | Jimmy |
| D-29 | 2026-10-10 | Missed pickup (chef's-home bookings, CLAUDE.md §10): the customer can propose a new pickup time no later than the earliest eat-by date of that day's meals (a 0-day dish means same-day pickup only), and the chef accepts or declines it; after a decline the customer may propose again until that deadline. If the meals are not picked up by then, the chef marks "pickup missed": the whole booking becomes a customer no-show (consumes the free trial) and days not yet cooked are cancelled | Jimmy |
| D-30 | 2026-10-10 | Keep the extra allergy synonym words added in T-061 (prawn, crab, lobster, clam, squid, oyster, mussel, scallop; groundnut, almond, cashew, walnut, pecan, pistachio, hazelnut); peanut and tree nuts warn on each other | Jimmy |
| D-31 | 2026-10-10 | The search `avoidAllergens` filter uses the same synonym map as booking warnings (built in T-042) | Jimmy |
| D-32 | 2026-10-10 | Add Health Canada's gluten sources (barley, rye, oat, triticale, spelt, kamut) and the condition words celiac and coeliac to the gluten group, plus bare macadamia, brazil, soybean (built in T-042; T-061 review findings 1 and 2) | Jimmy |
| D-33 | 2026-10-10 | Completion: the chef marks "visit done" after the last day; if not, the booking completes automatically 24 hours after the last day unless a no-show or problem was reported (built in T-063; reviews in WO-5 need it) | Jimmy |
| D-34 | 2026-10-10 | A chef must give a reason when declining a request (built in T-042) | Jimmy |
| D-35 | 2026-10-10 | No extra rate limit on booking requests; the 3-open-requests cap (D-28) is enough for the prototype (README known limit) | Jimmy |
| D-36 | 2026-10-11 | Auto-completion (D-33) happens only when at least one day was cooked; otherwise the booking is flagged for the admin instead of completing, so the free trial is not used and reviews do not open (Q-29, Reviewer's suggestion; fix in T-066) | Jimmy |
| D-37 | 2026-10-11 | A chef no-show after at least one cooked day uses up the free trial (in line with D-26); with no cooked day the trial is released. The uncooked days cost the customer nothing (Q-30: Jimmy accepted the Planner's recommendation as written; fix in T-066) | Jimmy |
| D-38 | 2026-10-11 | One allergy acknowledgement tick on the review step is enough, as long as allergies are stored on the customer's profile (new task T-067) (T-043 builder Q-1) | Jimmy |
| D-39 | 2026-10-11 | The booking review shows a per-day estimate breakdown (cooking time, labour, ingredients) under the totals (T-043 builder Q-2) | Jimmy |
| D-40 | 2026-10-11 | A customer who already has 3 open requests (D-28) is warned before the booking form, not only at send. Built as a warning; the server still refuses the fourth (T-043 builder Q-3) | Jimmy |
| D-41 | 2026-10-11 | The customer's own cooking address stays visible on their booking page at all times (T-043 builder Q-4) | Jimmy |
| D-42 | 2026-10-13 | Standing merge rule: inside a Work Order Jimmy approved, the Planner merges a PR once the Reviewer posts an APPROVE comment and `ci` is green, without asking each time. Migrations to hosted, deploys and anything outside an approved Work Order still go to Jimmy | Jimmy |
| D-43 | 2026-10-14 | Impeccable 4.5.2 is Frontend's design skill (T-068): project-level install, telemetry off (`.impeccable/config.json`, plus `IMPECCABLE_NO_TELEMETRY=1` in the hook command), design hook on in the main folder's `.claude/settings.local.json` (not committed). A WO-6 step (T-069) runs `audit` and `polish` across all pages before the mentor demo. Trial on T-045 | Jimmy |
| D-44 | 2026-10-14 | Remove the 4 installer-shipped `.claude/agents/impeccable-*.md` agents (outside the team roster, no status reporting or approval gate, unrestricted writes). Reinstall only inside an approved Work Order if live mode or asset work is planned | Jimmy |
| D-45 | 2026-10-14 | `PRODUCT.md` positioning, brand voice, product principles and accessibility (WCAG 2.2 AA; English learners and older users as core users) approved as the Planner drafted them (Q-31) | Jimmy |
| D-46 | 2026-10-14 | The option A shopping list is per dish (name, quantity, servings, allergens, estimated cost), not per ingredient; chat covers exact items (T-044 Q-1) | Jimmy |
| D-47 | 2026-10-14 | One current receipt per booking; the chef replaces it only after the customer disputes it; several shops go into one total (T-044 Q-2) | Jimmy |
| D-48 | 2026-10-14 | A disputed receipt is resolved through an admin view of disputed receipts in WO-5; until then it stays open (T-044 Q-4) | Jimmy |
| D-49 | 2026-10-14 | Receipts can be uploaded and answered only while the booking is `accepted` or `completed` (T-044 Q-5). Option B (`chef_shops`) only was already the API rule (§6.4); the storage policy now matches it (Reviewer LOW-1, not a new decision) | Jimmy |
| D-50 | 2026-10-14 | On a chef's-home booking, "Visit done" before the pickup deadlines pass only warns the chef (it removes "pickup missed"); no block (T-045 Q-2) | Jimmy |
| D-51 | 2026-10-14 | On a free first booking the chef sees "Free first booking" plus "Labour is free for the customer on this booking (prototype, MOCK)." with a MOCK badge (T-045 Q-4). Chef cancel and customer-no-show buttons go to a separate task, T-070 (T-045 Q-1) | Jimmy |
| D-52 | 2026-10-14 | Contact details (phone and address) are visible from acceptance until 7 days after the last visit day, then hidden again, whatever the status (narrowed by D-56: not cancelled bookings); chat stays (was Q-12; built in T-065) | Jimmy |
| D-53 | 2026-10-14 | A flagged booking (D-22) is frozen until an admin decides: no completion and no chef actions; the customer sees a neutral notice; no refund or rebooking flow (was Q-28; T-064) | Jimmy |
| D-54 | 2026-10-14 | When an admin resolves a problem report, the admin picks the booking's final status (completed, cancelled, chef no-show, customer no-show) with a note; the free trial follows the rule for that status (was Q-27; T-048) | Jimmy |
| D-55 | 2026-10-14 | On a chef's-home booking the customer can confirm "I picked up my meals"; after that the chef cannot mark the pickup missed (was Q-26; T-071) | Jimmy |
| D-56 | 2026-10-14 | D-52's 7-day contact window does not cover cancelled bookings: contact details (phone and address) lock both ways as soon as a booking is cancelled, as built today (was Q-37; T-070 copy stays; T-065 keeps it) | Jimmy |
| D-57 | 2026-10-15 | A booking flagged `no_day_cooked` (D-36) is not frozen: the chef may still mark past days cooked; completing the booking resolves the flag automatically; if it stays unresolved the admin picks the final status as in D-54 (was Q-36; T-064, T-048) | Jimmy |
| D-58 | 2026-10-15 | Kitchen photos follow the same window as D-52: hidden 7 days after the last visit day (T-065 backend Q-1, review L4; T-074) | Jimmy |
| D-59 | 2026-10-15 | A chef with chef's home enabled but no saved kitchen address cannot accept a chef's-home booking; the refusal is worded (T-065 backend Q-2; T-074) | Jimmy |
| D-60 | 2026-10-15 | No notification when contact details hide; the booking page states when they hide (T-065 backend Q-3) | Jimmy |
| D-61 | 2026-10-15 | Keep `contactVisibleUntil` on `BookingDetail` (contract v1.9; T-065 backend assumption 2, review L2) | Jimmy |
| D-62 | 2026-10-15 | Kitchen-address snapshots backfilled for bookings accepted before T-065 use the chef's address at migration time (prototype data only; T-065 backend known gap) | Jimmy |
| D-63 | 2026-10-15 | Drop "Chat stays open." from the contact-window text until chat ships; T-047 puts it back (T-073 Tester F-1: no false promise) | Jimmy |
| D-64 | 2026-10-15 | The contact cut-off reads "Visible until the end of <Wed, Oct 21> (Toronto time)" (the day before the server's 00:00 cut-off) instead of "12:00 a.m." (T-073 Tester F-4) | Jimmy |
| D-65 | 2026-10-15 | A frozen booking (D-53) also refuses the customer's cancel, no-show report and pickup proposal, so a cancel cannot decide the free trial before the admin does (T-064 Q-1) | Jimmy |
| D-66 | 2026-10-15 | The customer's receipt confirm and dispute stay allowed on a frozen booking; they change no booking status (T-064 Q-2) | Jimmy |
| D-67 | 2026-10-15 | Nothing unfreezes a booking until the admin decision route in T-048; no earlier unflag route (T-064 Q-3) | Jimmy |
| D-68 | 2026-10-15 | Rejecting a chef turns an open `no_day_cooked` flag on their booking into `chef_rejected`, so the booking freezes (D-22 wins over D-57) (T-064 Q-4) | Jimmy |
| D-69 | 2026-10-16 | Start T-075, T-071 and T-078 one after another, checking in after each merge | Jimmy |
| D-70 | 2026-10-16 | The red RLS test on PR #140 is fixed as its own task T-079 in its own PR, not inside T-075 | Jimmy |
| D-71 | 2026-10-16 | "Finish the current task only": finish T-075 (with its blocker T-079), then stop; T-071 and T-078 wait | Jimmy |
| D-72 | 2026-10-16 | T-079 gets a third round after two Reviewer rejections (one-line regex fix left) | Jimmy |
| D-73 | 2026-10-16 | "Full team working now for the next hour" ("continue and finish the next task"): start and finish T-071 now. The D-55 detail questions were not asked; the Planner used defaults A-26 to A-29 (Planner's choice, Jimmy to confirm) | Jimmy |
| D-74 | 2026-10-16 | "Finish the current one and stop for now": finish T-071, then stop | Jimmy |

## 6. Open questions and risks (do not decide alone)
From CLAUDE.md §13:
- Q-1 Who pays the chef during the free trial in a real launch?
- Q-2 Does in-home cooking, or selling meals from a chef's home kitchen, need licensing, a food-premises exemption, inspection or insurance in Ontario? **Open legal risk.**
- Q-3 Liability for allergens and food poisoning. **Open legal risk.**
- Q-4 Real background-check and ID-verification provider and cost.
- Q-5 Commission percentage and travel-fee rate (placeholders in A-8).
- Q-6 Restrict chefs to grandmas and stay-at-home parents, or any verified home cook?
- Q-7 Alternative names (GrandmaPlate, TableMates, Nana's Table).

New from planning:
- Q-8 ~~Cancellation timing rules (placeholder in A-6), and what happens on a late cancellation.~~ Resolved by D-20 (2026-10-10).
- Q-9 ~~Stripe test-mode checkout, or a pure mock payment step (A-10)? A pure mock is cheaper to build.~~ Resolved by D-18 (2026-10-10).
- Q-10 Real eat-by window must be confirmed against Ontario public-health guidance before any real launch.
- Q-11 ~~How long may a `requested` booking hold a chef's date before it expires, and should customers be rate-limited on requests?~~ Resolved by D-19 and D-28 (2026-10-10).
- Q-12 ~~Should contact details re-lock some days after a visit is completed? Now urgent: T-063 makes `completed` and no-show statuses reachable, and `get_booking_contact` returns the chef's *current* address and phone, so past chef's-home customers see a new address with no time limit (T-063 review M4; T-065 fixes the address part).~~ Resolved by D-52 (2026-10-14).
- Q-13 May an approved chef clear their bio or photo and stay listed in search? (Planner suggests blocking it: an approved profile must stay complete.) Interim: A-20 hides them from search and the public page.
- Q-14 Should replaced ID and food-handler files be deleted from Storage? (Deleting data needs Jimmy's OK; today they stay as orphans.)
- Q-15 ~~Confirm or replace the draft allergen-awareness and kitchen-hygiene acknowledgement wording from T-033.~~ Resolved by D-14 (2026-10-08).
- Q-16 ~~Admin MOCK-check rules (T-035 builder defaults, contract §12 open points 12–13, and T-035 Reviewer findings 1–2; in place until decided): (a) an admin may set a MOCK check back to `not_started` or `pending`, and setting an approved chef's check to `failed` does not change the chef's status; (b) kitchen review is allowed for a chef of any status, so chef's home can be enabled while pending or rejected; (c) the "checks pending" filter ignores the police check; (d) rejecting a chef leaves `chef_home_enabled` on, so a re-approved chef gets chef's home back if the kitchen did not change. Planner suggests: (a) keep, but an approved chef with a `failed` check should be flagged; (b) allow only for pending or approved chefs; (c) keep; (d) turn chef's home off on reject. Search and booking must require `approved` AND `chef_home_enabled` either way (WO-4).~~ Resolved by D-21 (2026-10-10).
- Q-17 ~~What happens to a booking when the chef clears that date, or when an approved chef is rejected? Planner suggests: a chef cannot clear a date with an active booking (409); rejecting a chef cancels their future `requested` bookings and flags `accepted` ones for the admin. Needed before WO-4b.~~ Resolved by D-22 (2026-10-10).
- Q-18 Should search support diets beyond allergens (vegetarian, halal, kosher)? That needs new dish data. Until decided, A-17 applies.
- Q-19 ~~The intake form is mandatory (§6.4), but today the allergy and dietary fields may be submitted blank. Must the customer type something explicit such as "none"? Needed before T-042.~~ Resolved by D-23 (2026-10-10).
- Q-20 ~~Should allergy matching know synonyms and spellings for the 13 picker allergens (gluten vs wheat is the riskiest; also dairy/lactose vs milk, shellfish/shrimp vs crustaceans, nuts vs peanuts, soya, mollusks, sulfites)? Planner suggests a small fixed synonym map. Needed before T-042.~~ Resolved by D-24 (2026-10-10).
- Q-21 ~~A chef who offers only cooking at their own home, before an admin enables it, is hidden from search, but their public page opens with no booking option. Keep, or return the same 404 as other hidden chefs?~~ Resolved by D-25 (2026-10-10).
- Q-22 ~~A-16 and §6.6 cover only a cancellation before the visit (released). They do not say what happens when a multi-day booking is cancelled after at least one day was cooked. The code (`freeTrialEffect`, `src/lib/domain/cancellation.ts:97`) currently releases the trial on any cancellation. Should that case release or consume the trial? Needed before T-042.~~ Resolved by D-26 (2026-10-10).
- Q-23 The contact-details guard (D-34, `findContactDetails`) catches phone numbers, emails and links in free text sent before acceptance, but not street addresses. Should a street-address check be added (decline reasons now; cancel reasons in T-063; chat before acceptance in WO-5)? Not blocking.
- Q-24 (T-063 Q-A) Should a chef cancelling after a cooked day use up the customer's free trial (D-26 read literally, as built) or release it?
- Q-25 (T-063 Q-B) How early may a no-show be reported? Built: from 00:00 on the visit date. Should bookings get a visit start time?
- Q-26 ~~(T-063 Q-C; review L3) Should the customer confirm "I picked up my meals"? Today the chef alone can mark "pickup missed" after the deadline, even when the pickup went fine, which also blocks the customer's review.~~ Resolved by D-55 (2026-10-14).
- Q-27 ~~(T-063 Q-D) Which final status does a booking get when the admin resolves a problem report? Needed before WO-5. Until then an `open` or `reviewing` report keeps it `accepted`.~~ Resolved by D-54 (2026-10-14).
- Q-28 ~~(T-063 Q-E; review M3) Do customers of flagged (D-22) bookings need more than the neutral notice (refund, rebooking)? Should flagged bookings be frozen until an admin acts (Reviewer suggests yes, T-064)?~~ Resolved by D-53 (2026-10-14).
- Q-29 ~~(T-063 review M1) Auto-completion (D-33) today completes a booking even when no day was cooked, which uses up the free trial and opens reviews; manual "visit done" needs every day cooked. Should auto-completion need at least one cooked day, and otherwise flag the booking for the admin (Reviewer's suggestion)? Not a contradiction of D-33 as written. Before WO-5.~~ Resolved by D-36 (2026-10-11).
- Q-30 ~~(T-063 review M2) A chef no-show releases the trial (A-16) even after a cooked day, so a customer can report a chef no-show on day 2 and keep the trial, while cancelling would use it (D-26). Should a chef no-show after a cooked day use up the trial? Linked to Q-25. **Planner recommends:** yes, consume it, in line with D-26 (any cooked day uses the trial, whoever ends the booking); the uncooked days are freed and the customer pays nothing for them. Otherwise a false chef no-show report becomes a way to get a second free booking.~~ Resolved by D-37 (2026-10-11).
- Q-31 ~~(T-068) `PRODUCT.md` positioning, brand voice, product principles and accessibility standard: Jimmy asked the Planner to draft them (2026-10-14). Draft is in `PRODUCT.md`, marked "Proposed, awaiting Jimmy's OK". Needed before T-045 uses Impeccable.~~ Resolved by D-45 (2026-10-14).
- Q-32 (T-044) Receipt files that are uploaded but never registered (or refused) stay in the private receipts bucket; clients cannot delete them. Cleanup (for example a scheduled job removing unregistered files older than a day) deletes data, so it needs Jimmy's approval. Not blocking; candidate for WO-6.
- Q-33 (T-044) A-15 receipt-mismatch tolerance (the larger of 15% or $5.00, configurable) is still an assumption. Confirm or change before the demo.
- Q-34 (T-045 backend gaps, not blocking) (1) `plan.note` is customer wording only; the chef UI builds its own from `plan` fields (a chef-side note would be cleaner). (2) `ReceiptView` has no file name, type or viewer-specific text. (3) No notification read route (WO-5). (4) The booking list has no allergy-conflict flag, so the chef sees conflicts only on the request page. (5) No server-side status grouping; the UI loads up to 50 and groups in the browser. Planner suggests: (3) in WO-5, the rest as one small backend task when needed.
- Q-35 (T-066 Q-1) Should the booking page tell both parties why an accepted booking whose days are all past and uncooked is waiting for an admin (D-36 `no_day_cooked` flag)? Interim: T-072 shows a neutral "waiting for a check" state.
- Q-36 ~~(T-066 Q-2) When an admin resolves a D-36 `no_day_cooked` flag, which final status does the booking get (cancelled, chef no-show, or the admin picks as in D-54)? Needed before T-048. Is a D-36 flagged booking frozen like D-53, or may the chef still mark past days cooked (as built, and as T-072 prompts)? Also (T-066 review LOW-1): a chef who first opens the app after the completion time gets the booking flagged before they can mark a day cooked; marking later completes it but the flag and notices stay. Does completing a `no_day_cooked`-flagged booking clear or resolve the flag? Needed before T-064 and T-048.~~ Resolved by D-57 (2026-10-15).
- Q-37 ~~(T-070 review L3) Does D-52's "whatever the status" include cancelled bookings?~~ Resolved by D-56 (2026-10-14).
- Q-38 (T-067 review, open risk for a real launch, not blocking) Admin can read every customer's saved allergy profile through the existing `profile_private` admin policy, like phone and address. Allergy and dietary notes can reveal health or religion. Should admin see saved profiles at all, or only the booking's intake copy when handling a report?
- Q-39 (T-074 review I1, for information, not blocking) Kitchen photos are visible per chef, not per booking: a past customer still inside the D-52/D-58 window also sees kitchen photos the chef uploads later. Pre-existing design. Keep, or limit to photos that existed at booking time?
- Q-40 (Jimmy, 2026-10-15) Add "Continue with Google" sign-in next to email and password? Planner notes: free in Supabase (a Google Cloud OAuth client; keys in the Supabase dashboard, never in the repo); a first Google login needs an extra "customer or chef" step, because sign-up sets the role today; it does not change the free-trial check (verified phone plus address hash); mock mode needs a fake Google login for tests. Phone-number login is not an option for V1: it needs a paid SMS provider and SMS stays MOCK (CLAUDE.md). Emailed one-time links are free but Supabase's built-in sender allows only a few emails an hour. Planner recommends: keep email and password for the mentor demo; Google sign-in as its own small Work Order afterwards if Jimmy wants it.

Known limits for the README: cheap SIMs and multiple addresses can evade the free-trial rule; real launch needs ID verification. The contact-details filter is best effort (spelled-out digits, disguised emails and street addresses pass). No rate limit on booking requests beyond D-28 (D-35). Request expiry is lazy until a scheduled sweep is added (WO-7). Kitchen-address snapshot rows (T-065) are never deleted after the contact window; a retention job is a later decision (T-074 N5).

## 7. Task notes
Notes for each finished task are added here (CLAUDE.md §8).

### T-023 — Issue and PR templates, labels, Issues (done 2026-10-07, PR #44)
- Issue forms `task.yml` and `bug.yml`, blank issues off, PR checklist (Issue link, tests, Work Order, no secrets, MOCK labels, handoff).
- Labels `owner:*` and `phase:2a…6`; Issues #8–#43 mirror T-020 to T-055.
- Reviewer approved. Follow-up idea: a phase dropdown in `task.yml` (labels are added by hand for now).

### T-020 — App scaffold (done 2026-10-07, PR #45)
- Next.js 16.4, TypeScript, Tailwind, ESLint, Prettier, Vitest (2 tests), Playwright Chromium smoke test. Scripts: `dev`, `build`, `lint`, `typecheck` (runs `next typegen` first), `test`, `test:e2e`, `format`.
- `@types/node` bumped to ^24 (Vitest peer conflict). `AGENTS.md` generated by Next is committed. `.prettierignore` skips `CLAUDE.md` and `docs/`.
- Tester PASS on a fresh clone; Reviewer approved.
- `npm audit`: 5 high findings, dev-only lint chain (`braces` → … → `eslint-config-next`); production audit clean. Follow-up Issue #46.
- Later cleanups: Geist font loaded but body uses Arial; unused template SVGs in `public/`. `next.config.ts` enables `cacheComponents` and `partialPrefetching`: Backend must account for this when loading Supabase data (T-021 onward).

### T-021 — Supabase setup (done 2026-10-07, PR #47)
- `supabase init` (local config only, not linked), `@supabase/supabase-js`, `@supabase/ssr`, `server-only`, Supabase CLI as dev dependency.
- `src/lib/supabase/`: `env.ts` (names missing variables, never values), `client.ts` (browser), `server.ts` (cookies, per request), `admin.ts` (secret key, server-only). `npm run db:check` prints OK/FAIL only.
- Jimmy's hosted project uses new-style keys (`sb_publishable_…`, `sb_secret_…`) in the `…ANON_KEY` / `…SERVICE_ROLE_KEY` variables. db:check passes. Rename to `…PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` awaits Jimmy.
- With `cacheComponents`, call the server client inside `<Suspense>`, a Route Handler or a Server Function; session refresh needs a proxy that forwards the `setAll` headers (auth task T-028).
- Tester PASS, Reviewer approved. Small follow-ups: `env.ts` comment should say server-only; `env.test.ts` "never includes a value" test needs `expect.assertions(1)`. For T-028: `config.toml` has `minimum_password_length = 6`, `enable_confirmations = false`, and references a `seed.sql` that does not exist yet.

### T-022 — CI workflow (done 2026-10-07, PR #48)
- `.github/workflows/ci.yml`: one job `ci` on every PR and push to `main`: npm ci, lint, typecheck, prettier check, unit tests, local Supabase (`supabase start`, unused services excluded), Playwright Chromium smoke test. `contents: read`, no secrets, superseded PR runs cancelled. Playwright report uploaded on failure.
- `.prettierignore` now skips `PLAN.md`.
- Green run 2m16s. Tester proved it goes red on a failing unit test (throwaway draft PR #49, closed, never merged). Reviewer approved.
- Follow-ups in Issue #50: add `npm run build` to CI; pin the Supabase CLI version in CI to match the repo; move to `checkout@v5` / `setup-node@v5` before GitHub drops Node 20; confirm the failure artifact on the first real e2e failure.

### T-024 — Branch protection on `main` (done 2026-10-07, settings change, no code PR)
- Required status check `ci`; branch must be up to date with `main` before merging; applies to admins too; force-push and deletion blocked; no required reviews (D-6).
- Effect: nothing reaches `main` without a green `ci` run on a PR, including Planner notes like this one.

### T-056 — Env rename and CI hardening (done 2026-10-07, PR #54)
- Variables are now `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (D-8). Old names remain only in history notes on purpose.
- CI now builds, pins Supabase CLI 2.120.0, uses checkout/setup-node v5. `supabase/.temp` ignored by Prettier. Closed #50 and #52.

### T-025 — Core schema + RLS (done 2026-10-07, PR #55; applied to hosted project 2026-10-07)
- 19 tables, RLS on all, deny-by-default grants (tables and functions), private data split into `profile_private`, `chef_private`, `booking_addresses`. Contact reveal only via `get_booking_contact` after acceptance. Clients cannot write bookings, claims, hashes or check statuses; the server does (service role), so every API route must authorize in code.
- One active booking per chef per date; one free trial per customer, phone hash and address hash (released claims excluded).
- Review round 1 fixed: no email-derived display names; chef file paths locked to own folder, re-verification on change, kitchen change disables chef's-home until admin re-enables; no bucket listing; kitchen photos private (D-10); only chefs upload chef files; column-level inserts; report categories enum.
- Data model and migration checklist: `docs/data-model.md`. Later-task notes: `.team/handoffs/T-025-reviewer.md`.

### T-027 — RLS test harness (done 2026-10-07, PR #56)
- `npm run test:rls`: 8 files, 107 tests against local Supabase in CI, acting as real users, each denied case paired with an allowed one. Exact privilege snapshot for anon and authenticated. Localhost guards on API and DB URLs.

### T-026 — API contract v1 (done 2026-10-07, PR #58)
- `docs/api-contract.md` + shared types `src/lib/api/types.ts`: auth, profile, phone (MOCK), address, chef application, admin queue (MOCK checks), public chef list. §2 lists the authorization every route must do in code (service role bypasses RLS). Two review rounds; decisions D-11, D-12.
- For T-035: approve must also require both checks still `verified` in the same update; allow `reviewedAddress: null`; a "checks pending" queue filter.

### T-030 — Seed data (done 2026-10-07, PR #59; not yet loaded into hosted)
- `npm run db:seed -- --local|--hosted|--verify`, idempotent. 61 GTA postal prefixes (approximate centroids), admin (only with `SEED_ADMIN_PASSWORD`), 3 demo customers, 12 chefs (8 approved incl. Lan, Vietnamese, Mississauga L5B, both locations; 3 pending; 1 rejected), 31 dishes, 21 days of availability. All fictional, `@example.com`, 555 numbers. Demo logins in README.
- Hosted run waits for Jimmy to set `SEED_ADMIN_PASSWORD`. Anyone reading the public README can log in to hosted demo accounts (fictional data, A-11).

### T-028 — Auth backend (done 2026-10-07, PR #61; migration applied to hosted 2026-10-07)
- Routes: signup, login, logout, GET/PATCH /api/me, phone + MOCK verify, address. Identity from `getUser()`, role from `profiles`, column whitelists, exact JSON content type (CSRF), `no-store`, in-memory placeholder rate limits (disclosed). Session refresh in `src/proxy.ts`.
- Domain: `src/lib/domain/{phone,address,hash,private-rows}.ts` (E.164; full A-2 normalization; HMAC-SHA256). Seed imports the same code; a test proves identical hashes for demo customers.
- Migration revokes client UPDATE on profiles/chefs/chef_private (D-12), photo-path folder checks, unique verified phone (D-11). Tests: 81 unit, 105 RLS, 29 API.
- Follow-ups: tighten phone (N11 codes) and postal-letter validation (WO-4 domain tests); README known limits (T-054): address-hash evasion (`5-100` vs `Unit 5,`, accents, unit position), MOCK SMS lets anyone claim a number, one phone cannot hold a chef and a customer account; `X-Forwarded-For` trust (WO-7); T-031 must repair missing chef rows and apply the N1 re-verification reset in routes; test that JWT metadata role is ignored.

### T-029 — Auth UI (done 2026-10-07, PR #60)
- /signup (role choice), /login, /verify-phone (MOCK SMS badge), /address, log out in AccountBar. One fetch helper (JSON content type always, contract error shape, 429 retry). "MOCK API" badge whenever the mock adapter is on. axe: zero violations; keyboard-only flow; 375px OK.
- Review caught a false privacy hint and lost focus after client navigation (fixed, regression test). Integration with real routes is T-057.

### T-057 — Auth UI on real routes (done 2026-10-07, PR #64)
- MOCK adapter off by default (only `NEXT_PUBLIC_API_MOCK=1`), dynamically imported. Client-side route guards and onboarding order (phone → address). Real-route Playwright e2e in CI against local Supabase (sign-up, MOCK verify, address, logout/login, 409/401/422 errors, guards); mock-mode e2e kept separately. Per-test client IP in e2e so retries can't trip the in-memory sign-up limit.
- Follow-ups: server-side guards before any page showing private data (bookings, chat, admin) — put in those Work Orders; `clientIp()` trusts the first X-Forwarded-For entry (WO-7); decide whether unfinished onboarding blocks booking (booking API must require a verified phone server-side, WO-4); `signedIn:false` path tested in mock only while email confirmation is off.

### WO-2 summary (finished 2026-10-07)
Tasks T-056, T-025, T-027, T-026, T-030, T-028, T-029, T-057 merged. Hosted Supabase has all 4 migrations; demo data not yet loaded (needs `SEED_ADMIN_PASSWORD`). Open issue: #46 (dev-only audit findings, no upstream fix yet).

### T-058 — Lessons-learned file (done 2026-10-08, PR #69)
- `docs/lessons-learned.md` plus a CLAUDE.md §8 line telling every agent to read it. Reviewer round 1 fixed handoff ownership (builders commit theirs; Planner commits Tester/Reviewer handoffs, D-7) and the handoff-then-done order.

### T-031 — Chef onboarding API (done 2026-10-08, PR #67; migration applied to hosted 2026-10-08)
- Routes: GET/PATCH `/api/chef/application`, POST/DELETE `/api/chef/application/documents`, POST `/api/chef/application/submit`. Identity from `getUser()`, role from `profiles` (JWT `user_metadata.role` ignored, tested). Service-role client only after the role check; GET repairs missing chef rows (display name copied from `profiles`, never from the email).
- Every client storage path goes through `checkStoragePath` (own folder, no `..`/`/`/backslash/control chars, lower-case `<prefix>-<uuid>.<ext>`); new paths also get an object-exists probe (skipped for paths already registered, which is the cause of R1). N1 reset in routes: registering a new ID or food-handler file moves its check (including `failed`) back to `pending`; a kitchen-address change, or adding or removing a kitchen photo, resets the kitchen check and turns chef's home off. All check statuses commented MOCK; submit returns `mock: true`.
- `chef_private` writes are conditional on `updated_at` (retry, 409 after 12 losses); rejected → pending on submit is conditional on `status = 'rejected'`.
- Migration `20261008150000_kitchen_photos_insert_only.sql` (Planner-decided fix for tester F3): drops the kitchen-photo update and delete policies so that bucket is insert-only for the chef, like `chef-documents` already was. Applied with `npx supabase db push`.
- Tests: 165 unit, 111 RLS, 207 API, Playwright real-route 7 + mock 6. Tester PASS (round 2), Reviewer APPROVE.
- Reviewer follow-ups:
  - R1 (backlog): a kitchen photo deleted in parallel can be re-registered after a race (`src/lib/server/chef-application.ts:472-495`); fails safe (check pending, chef's-home off). Fix: re-probe Storage when the path was skipped as already registered.
  - R2 (T-035): submit completeness reads `chefs`/`dishes` without a lock. Admin approve must recompute completeness server-side in the same conditional write and refuse if anything is missing.
  - R3: done (db push above).
  - R4 (info): `20261007221003_storage_buckets.sql:5` comment is stale; already applied, do not edit.
  - R5 carry-forwards: T-033 — MOCK badge on every check status; uploads use fresh lower-case uuid names with `upsert: false`. T-035 — admin verdict writes stay conditional on the reviewed paths and bump `chef_private.updated_at`. T-054 README known limits — orphan uploads the chef never registered can no longer be deleted by the chef.

### T-033 — Chef onboarding and profile UI (done 2026-10-08, PR #70)
- `/chef/apply` with a server-side chef guard (`src/lib/server/page-guard.ts`: `getUser()` + `profiles.role`, fails closed; meta-refresh redirect with HTTP 200 because of Suspense, no private HTML sent). Sections: status, display name, profile and service area, profile photo, ID and Food Handler uploads, kitchen (address, photos, hygiene ack), allergen ack, submit with the API's `missing` list. MOCK badge on every check.
- Uploads go to Storage as `<uid>/<prefix>-<uuid>.<ext>` (fresh lower-case uuid, `upsert: false`), then are registered via the API. Focus moves to the error after every error path. Mock adapter reuses the server's pure rules. New dev dependency `@axe-core/playwright` (MPL-2.0).
- Tests: unit 236, mock Playwright 19, real-route Playwright 11 (CI). Tester round 1 FAIL (F1 display name accepted control characters → client fix here, server fix T-059; F3 focus after photo removal), round 2 PASS. Reviewer APPROVE.
- Follow-ups:
  - T-034: server guard on every `/chef/*` page (a `src/app/chef/layout.tsx`); reword "sends its check back to pending" (only true once reviewed); remove "dish editor not available yet" (`src/lib/chef/form.ts:91-92`); remove the word "draft" on the acknowledgements (D-14) but keep the "not legal advice" note and the MOCK "nobody checks this" note (CLAUDE.md §11, Q-3); reword "You can remove a photo" (`ChefApplicationView.tsx:593`) to say removal takes it off the application and tries to delete the file (corrected in T-034; a failed delete leaves an orphan).
  - T-035: approve recomputes completeness in the same conditional write (T-031 R2); verdict writes bump `updated_at`; consider a `submittedAt` field (the "submitted" label is inferred today).
  - T-036 / booking (WO-4): tell chefs the kitchen address is shared with the customer once a chef's-home booking is accepted; verify unlinked (removed) kitchen photos are not visible to customers via `kitchen_photos_select_customer`.
  - T-054 README known limits: orphan uploads; a removed kitchen photo stays stored only if its delete fails; meta-refresh guard.

### T-059 — Unsafe text in display name and address (done 2026-10-08, PR #72)
- New `Fields.text` (`src/lib/api/validate.ts`); `hasUnsafeText` moved to `src/lib/domain/text-safety.ts` (re-exported from `chef-application.ts`). Sign-up and `PATCH /api/me` (`displayName`) and `PUT /api/me/address` (`line`, `city`) return 422 for control characters and lone surrogates, before any write. Contract §§3–4 updated. Address fields folded in by Planner decision (same bug class).
- Tests: unit 191, API 213 (CI). Tester PASS, Reviewer APPROVE.
- Not changed on purpose: email validation (Supabase Auth validates; login email is not stored). Bare `tsc --noEmit` needs `next typegen` first; use `npm run typecheck`.
- Follow-up: T-060 (#73) bidi / zero-width / C1 characters in public text, keep ZWJ for emoji, client/server agreement test.

### T-032 — Dishes and availability API (done 2026-10-08, PR #75; migration applied to hosted 2026-10-08)
- Routes: GET/POST `/api/chef/dishes`, PATCH `/api/chef/dishes/:id` (edit, deactivate, reactivate; no DELETE), GET/PUT `/api/chef/availability` (`{add?, remove?}`). Contract v1.1 §§5A–5B cites D-15 and D-16.
- Migration `20261009120000_dishes_availability_routes_only.sql`: routes are the only writers of `dishes` and `availability` (extends D-12; client writes revoked, six write policies dropped, read policies kept); 50-active-dish cap trigger under a per-chef advisory lock, EXECUTE revoked. Applied with `npx supabase db push`.
- Dish photo paths go through `checkStoragePath` (403 for another chef's folder). PATCH is one conditional statement. Pending/rejected chefs' dishes and dates stay hidden; approved chefs show active dishes only.
- Tests: unit 285, RLS 115, API 261, Playwright 11 + 19 (CI run 37822068827). Tester round 1 FAIL (year 0000 passed `isRealDate`, Postgres would answer 500) → fixed; round 2 PASS. Reviewer APPROVE.
- Reviewer findings:
  - LOW: `docs/api-contract.md:175` says 422 before 404/409; the code checks ownership first (404, 403 foreign path) then 422. Code is right; contract sentence corrected in #76 (including unknown keys, which are 422 on their own before the 403).
  - INFO: `src/lib/domain/dishes.ts:6` said "ASSUMPTIONS"; comment fixed in #76 (names which bounds are D-15, D-16 or still assumptions). Migration line 16 says the same; already applied, do not edit.
  - Accepted gaps: PUT availability is two statements, not one transaction (resend fixes it); replaced dish photos stay in Storage; a chef can delete their own photo between check and save; clearing a booked date does not change the booking.
- Follow-ups:
  - T-034: mock adapter dish and availability routes; dish photos with a fresh lower-case uuid; expect 404 before 422, 403 foreign path, 409 at the cap; use the server's `today` and `lastBookableDay`; missing-photo fallback; labelled fields and focus to errors. Removed-photo wording must match the code (corrected in T-034: the route tries to delete the file; it stays stored only if that delete fails).
  - WO-4: booking requires an available date and a double-booking check; decide what clearing a booked date does; customer read routes for dishes and availability; compare intake allergies with the stored lower-case allergens.

### T-034 — Dish menu and availability calendar UI (done 2026-10-08, PR #77)
- `src/app/chef/layout.tsx`: one server-side chef guard for every `/chef/*` page (fails closed; the per-page guard in `apply/page.tsx` was removed). `ChefNav` links Application, Dishes and Availability.
- `/chef/dishes` (`DishesView.tsx`, `src/lib/chef/dishes.ts`): create, edit, deactivate, reactivate (no delete). Dollars in the form, cents to the API, reusing `parseDishBody`. Allergen picker plus "Other allergens". Photos to `dish-photos` as `<uid>/dish-<uuid>.<ext>` (`upsert: false`); after a failed save the upload is reused on retry and dropped only when the server rejects the photo (`uploadRejected`). Missing-photo fallback. 409 cap message takes focus.
- `/chef/availability` (`AvailabilityView.tsx`, `src/lib/chef/calendar.ts`): ARIA grid, one tab stop, arrows/Home/End/PageUp/PageDown, Space/Enter; `aria-pressed` plus a check mark. Window from the server's `today`/`lastBookableDay` (D-15); PUT sends only `{add, remove}`.
- Mock adapter has the dish and availability routes in the real check order; "with dish" seeds a real mock dish with a photo. T-033 carry-overs done ("draft" removed per D-14 with the legal and MOCK notes kept; dish-editor link; "back to pending review" wording).
- Brief correction: the Planner's brief said a removed kitchen photo "stays stored". The code tries to delete it (`src/lib/server/chef-application.ts:529`); the builder wrote true wording instead ("also tries to delete the file; if that fails, the file may stay stored").
- Tests: unit 388, RLS 115, API 261, Playwright real 17 + mock 39 (CI). Tester round 1 PASS with LOW findings; Planner sent LOW 1 (photo re-uploaded on every retry) and LOW 2 (aria-disabled had no visible style) back before review; round 2 PASS. Reviewer APPROVE.
- Reviewer findings:
  - LOW `src/app/chef/layout.tsx:5-9`: comment says /chef pages need no guard of their own; only true while they load data in the browser. A layout does not re-run on in-app navigation, so a page that reads private data on the server needs its own guard. Fix the comment in T-036.
  - LOW `DishesView.tsx:540-542`: replacing a dish photo does not say the old photo stays public at its old link. Record in T-054 README known limits.
  - INFO: "Discard changes" can be pressed during a save (harmless). No raw-HTML /chef test for a signed-in admin yet.
- Backlog: `allergenList` (`src/lib/domain/dishes.ts` ~60) counts duplicates before merging them, so 13 ticked plus a retyped one is refused (backend, low). Bidi/C1 characters → T-060.
- Follow-ups:
  - T-035: admin decision writes conditional on the reviewed files; recompute completeness on approve (T-031 R2); add a seeded admin to the real-route suite so the /chef raw-HTML admin test can be written.
  - T-036: server guard on `/admin/*` (page by page where data is read on the server); MOCK badge on every check status; fix the layout comment.
  - WO-4: search shows only active dishes and ticked dates inside the D-15 window.
  - T-054 README: dish photos, including replaced ones, are public by link; guard answers 200 with a streamed redirect.

### T-035 — Admin chef-queue API (done 2026-10-08, PR #79; migration applied to hosted 2026-10-08)
- Six routes under `/api/admin/chefs` (contract v1.2 §6): list (`status` and `checks=pending` filters, `limit` 1–50, strict opaque keyset cursor, newest first), detail (300-second signed URLs only for our own file names, never cached or logged, no hashes), approve, reject (reason 3–500, unsafe text refused), PATCH checks (MOCK), kitchen review (MOCK). `requireAdmin()` reads `profiles.role` before any query; service role only after; JWT metadata ignored (tested). Logs carry only admin and chef ids.
- Migration `20261010120000_admin_chef_decisions.sql`: `admin_approve_chef`, `admin_reject_chef`, `admin_review_kitchen` (SECURITY INVOKER, `search_path ''`, EXECUTE for service_role only). Each locks the chef's rows, re-reads, decides and writes with its notification in one transaction. Approve recomputes the 16 completeness items plus stored-file existence and requires both MOCK checks still `verified` (closes T-031 R2). PATCH checks is one conditional UPDATE keyed on the reviewed paths (B1). Adds functions only. Applied with `npx supabase db push`.
- Tests: unit 426, RLS 118, API 315, Playwright real 18 + mock 39 (CI). Real-route suite creates a local-only admin (`e2e/helpers/local-admin.ts`, host-guarded) and checks raw `/chef` HTML for a signed-in admin (closes T-034 finding 5). Tester PASS; added a static guard test that fails if the SQL and TypeScript completeness rules drift, or if the migration's security settings weaken. Reviewer APPROVE.
- Findings (none blocking): rejecting leaves `chef_home_enabled` on (→ Q-16 d); kitchen review for any status and check rollback on approved chefs (→ Q-16 a, b); SQL `btrim` vs TS `trim()`; DB error text in logged messages (not sensitive today); approve's `missing` can name a vanished file the chef's own list does not show.
- Known gap: the approve rules live in SQL and TypeScript; a new rule needs both, plus a new `create or replace function` migration (the guard test catches drift).
- Follow-ups:
  - T-036: MOCK badge on every check status incl. police; server guard on `/admin/*`; fix the `src/app/chef/layout.tsx` comment (T-034 finding 1); refetch signed URLs after ~5 min and show "not available" for a listed file without a URL; send exactly the reviewed paths and address (`null` when none); on 409 ask to reload and focus the error; `Content-Type: application/json` on every write incl. approve; reason and note as plain text; explain approve's `missing` for vanished files; mock adapter admin routes.
  - WO-4: chef's-home search and booking require `approved` AND `chef_home_enabled`; decide what happens to future bookings when an approved chef is rejected.
  - WO-5: notification read API.
  - Not built: `submittedAt` (optional, contract §12 open point 13).
  - Hosted demo admin still needs Jimmy's `SEED_ADMIN_PASSWORD` (hosted seeding needs Jimmy).

### T-036 — Admin chef-queue UI (done 2026-10-08, PR #81) — WO-3 complete
- `/admin/chefs` queue: status filter (pending default, approved, rejected, all) and "checks pending", newest first, cursor "Load more" (focus to the first new chef); filters kept after visiting a chef. `/admin/chefs/[id]` review: application fields, files from 300-second signed links (refreshed ~60 s before expiry, on tab focus and on demand; a failed refresh shows a notice and retries every 30 s; "Not available" for a file without a link, which cannot be marked verified), kitchen section.
- Actions: approve (409 `missing` in plain words, vanished file explained), reject (reason 3–500, shared unsafe-text rule), MOCK checks (only changed statuses, with the stored paths shown), MOCK kitchen review (every stored photo path and the address, `null` when none). 409 `INVALID_STATE` says nothing was saved and offers reload; focus to the error after every error; `Content-Type: application/json` on every write. Reasons and notes rendered as plain text. MOCK badge on every check status (incl. police) and on the controls.
- Guard: `page-guard.ts` generalised (`requireAdminPage`, fails closed) and used by `src/app/admin/layout.tsx`; admins land on the queue after login. The `src/app/chef/layout.tsx` comment now says a layout guard protects only pages that load data in the browser through guarded routes (T-034 finding 1). Root-layout `AccountBar` and the `[id]` params are inside Suspense (Next 16 `cacheComponents`).
- Mock adapter: the six admin routes in `src/lib/mocks/mock-admin.ts` with the real rules and order (offset cursor only); log in with an email starting `admin` in mock mode.
- Tests: unit 512, RLS 118, API 315, Playwright real 23 + mock 67 (CI). Real-route: an admin approves a new complete chef (CLAUDE.md §12 step 5), rejects with a reason, stale file, raw `/admin` HTML for visitor, customer and chef. Tester round 1 PASS; Planner sent back LOW 1 (silent link-refresh failure), LOW 2 (long names overflowed at 375 px) and the search wording before review; the builder also fixed the queue reusing first-render filters. Round 2 PASS. Reviewer APPROVE.
- Findings (none blocking):
  - LOW `ChefReviewView.tsx` `reload()` returns `false` for both a failure and a superseded request: a "may have expired" notice can show on fresh links until the next retry, and a second click on "Reload" briefly shows "Could not reload". Fix with `ok | failed | superseded` and an early return while refreshing (next frontend task).
  - LOW `ChefQueueView.tsx:255` "Applied {createdAt}" is the sign-up time; say "Signed up" until `submittedAt` exists (next frontend task).
  - INFO: build-log `cookies()` line from the T-035 GET list handler during prerender; harmless; Backend can add `await connection()` (next backend task). Q-16 defaults not flagged in the UI.
- Follow-ups:
  - WO-4: chef's-home search and booking require `approved` AND `chef_home_enabled`; decide what happens to future bookings when an approved chef is rejected.
  - After Q-16: flag an approved chef with a `failed` MOCK check; apply the kitchen-review status rule in UI and API.
  - WO-5: extend `AdminNav` to bookings, reports and free-trial blocks.
  - T-054 README: mock admin login works only in mock mode; hosted demo admin needs Jimmy's `SEED_ADMIN_PASSWORD`.
- Process: Jimmy's status rule added to `docs/lessons-learned.md` §1 (Planner records an agent's task and 0% before starting it; agents report progress at 25/50/75/100).

### T-037 — Domain rules (done 2026-10-09, PR #84)
- Pure functions in `src/lib/domain/` (no I/O), summarised in `docs/domain-rules.md`: `config.ts` (A-6, A-8, A-13 to A-15 and the A-21 quantity cap, marked ASSUMPTION), `money.ts` and `pricing.ts` (estimate in integer cents: labour, ingredients, travel per day for customer's home, platform fee on labour only and not added to the total; A-23 rounding), `visitLimit.ts` (6-hour warning per day), `bookingValidation.ts` and `bookingIntake.ts` (1–3 distinct days, no past date, D-15 window in Toronto time, availability, double booking, service radius, chef's home only when offered AND approved AND `chef_home_enabled`, active dishes of that chef; errors as codes), `allergy.ts` (A-24), `receipt.ts` (A-15), `cancellation.ts` (A-6, A-22, free-trial effect A-16), `eatBy.ts` (A-7), `distance.ts` (A-1), `dietary.ts` (A-17).
- Also: `allergenList` counts the 14 limit after de-duplication (T-034 backlog); phone validation rejects invalid NANP codes (N11) and postal codes follow Canada Post letter rules (T-028 follow-up). Two seed postal codes changed to valid ones with the same prefixes (`L6P4D4`→`L6P4C4`, `L4K6F6`→`L4K6E6`); test phone helpers fixed (the Tester found one more that failed about 1 call in 100).
- Tests: unit 702 (from 512), RLS 118, API 315 (CI). Only the allergen fix and the allergy rounds were strictly test-first; the Tester added 91 tests including an independent BigInt check of the money maths over 400 random bookings and DST boundaries. Tester PASS. Reviewer: three rounds — round 1 an allergy-safety gap ("nuts" did not warn for "tree nuts") and a 10%/15% doc slip; round 2 extra words still hid a conflict ("Extremely allergic to nuts"); round 3 APPROVE.
- Findings (none blocking): existing hosted rows are not re-checked against the stricter phone and postal rules — an admin kitchen review that sends a now-invalid stored address gets 422, and a stored N11 phone makes `phoneHash` throw (only typed test data could hit this); receipt tolerance rounds half up before a strict compare (at most half a cent); blank intake strings accepted (Q-19); allergy synonyms missing (Q-20).
- Follow-ups: T-038 — a stored phone the new rule rejects must give a clean 409/422, not 500; use `freeTrialEffect` as the single source. T-042 — pass `torontoToday()` as `ctx.today`; `chefBookedDates` must match the `is_active` index; map `CHEF_NOT_BOOKABLE` to 404 and `DOUBLE_BOOKED` to 409; build the intake allergy field from `ALLERGEN_CHOICES` plus free text; no-show and meal-pickup handling.
- Process: status reports from worktrees were lost (team-status writes to the current folder); fixed with `CLAUDE_PROJECT_DIR`, now in `docs/lessons-learned.md` §1.

### T-039 — Search API (done 2026-10-09, PR #85; no migration)
- Contract v1.3 §7: `GET /api/chefs` (location by `postalCode` or `city` — A-18 city centre; filters `cuisine`, `language`, `avoidAllergens` A-17, `minRateCents`/`maxRateCents`, `date` inside the D-15 window, `locationType`; distance sort A-1, then rating, name, id; keyset cursor; out-of-radius chefs left out unless chef's home is bookable, then `chefHomeOnly: true`), `GET /api/chefs/:id` (active dishes, `bookableDates` A-19, `today`, `lastBookableDay`), `GET /api/reference/postal-prefixes` (public, cacheable, cookie-free client).
- Approved only with an explicit `.eq('status','approved')`; A-20 hides incomplete chefs in search and detail; one identical 404 for non-uuid, unknown, pending, rejected and hidden chefs. Named columns, no private fields, anon-capable client only, `no-store` except the reference route. Without a location, order is rating then name (A-25). Reads at most 1000 approved chefs and filters in code (prototype scale).
- Backlog done: `await connection()` in `GET /api/admin/chefs` removes the build-log prerender error (T-036).
- Tests: unit 756, RLS 118, API 347, Playwright real 23 + mock 67 (CI run 38019520989). Pending and rejected chefs hidden for seven kinds of viewer; header-identical 404s; radius boundary through the DB; cursor tampering; tie paging. Tester PASS, Reviewer APPROVE.
- Findings (none blocking): Q-21 (a chef with only an unenabled chef's home is hidden in search but its page opens with no booking option; Reviewer recommends the same 404); the contract says a chef's postal prefix is never shown, but the service-area centre can be inferred from `distanceKm` over a few searches (area only, never an address; soften the wording at the next contract edit); `locationType=customer_home` still returns `chefHomeOnly` chefs, so T-040 must label them.
- Follow-ups: T-040 — postal-prefixes for the city picker and map pins (area centres only); chef's-home-only label; list is the main view and works without the map; 422 errors next to inputs with focus; mock adapter routes per §7 with cursor paging. T-041 — one "Chef not found" state; handle `locationOptions: []` unless Q-21 changes it; date picker from `today`/`lastBookableDay`; allergens on each dish. T-042 — remove booked dates from the `date` filter and `bookableDates`; re-check approved, `chef_home_enabled` and radius at booking; hidden chef → same 404.

### T-038 — Free-trial rules (done 2026-10-10, PR #87; no migration)
- Pure rules in `src/lib/domain/freeTrial.ts` (`evaluateFreeTrial`, `transitionFreeTrial`); outcomes come only from T-037's `freeTrialEffect` (A-16). Server functions in `src/lib/server/free-trial.ts` for T-042: `checkFreeTrialEligibility`, `holdFreeTrial`, `applyFreeTrialEvent`. No routes yet.
- Hold is one INSERT into `free_trial_claims`; the three partial unique indexes (customer, phone hash, address hash) and the unique `booking_id` decide races; a unique violation becomes a generic 409 `FREE_TRIAL_USED`, and the real rule goes to admin-only `free_trial_blocks`. State changes are one conditional UPDATE from `held`, with a re-read after a lost race. Hashes built server-side from stored data. Bad stored data gives 409 (`PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `ADDRESS_NOT_SET`), never 500. Contract §11A has notes for T-042.
- Tests: unit 806, RLS 118, API 403, Playwright real 23 + mock 67 (CI). §10 second free trial by same phone, same address (written differently), same customer and new account; all 24 event × state combinations through the real database; parallel holds and completed-versus-cancelled races, green on two CI attempts. Tester PASS, Reviewer APPROVE.
- Findings (none blocking): MEDIUM for T-042 — `holdFreeTrial` reads the booking status then inserts separately, so a decline or cancel landing in between could leave a claim `held` on a finished booking forever (not reachable until booking routes exist); T-042 must create booking and claim in one transaction or SQL function, or lock the booking row. Q-22 (cancel after day 1 releases the trial). The block log has no size limit. A customer can read their own claim hashes (nothing new: the same hashes are already readable in `profile_private`); restrict the hash columns in `free_trial_claims` and `profile_private` later with column-level grants. Later code fix: the `src/lib/domain/config.ts:6` header lists an eat-by default (A-7) that actually lives in `dishes.ts` as `DEFAULT_SHELF_LIFE_DAYS`.
- Follow-ups for T-042: one transaction for booking plus hold; set `bookings.is_free_trial` only when the hold succeeds; call `applyFreeTrialEvent` on every status change and on request expiry, only from a route that has authorized and saved the change; contract §11A to add 409 `INVALID_STATE` for re-holding a released or consumed claim and 403 for admins; rate-limit or group the block log.

### T-040 — Search and results UI with map (done 2026-10-10, PR #89)
- `/search` (public, linked from home): postal code or city picker (from `/api/reference/postal-prefixes`), cuisine, language, avoid-allergens (A-17; says it is not an allergy guarantee and that diets such as vegetarian are not supported), price in dollars sent as cents, date (Toronto time; the server's 422 is the authority), where the cooking happens. No nationality filter or wording.
- Results list is the main view and works without the map: photo, cuisines, languages, rate, rating, distance, "Chef's home only" label; cursor "Load more" with focus to the first new result; empty state; 422 errors next to inputs with focus; stale responses dropped.
- Map: Leaflet 1.9.4 (BSD-2-Clause, new dependency) with OpenStreetMap tiles and attribution, client-only, collapsed under 1024 px. Pins at the average of a city's postal-area centres (the contract hides a chef's own area), keyboard-operable with names. Mock adapter `src/lib/mocks/mock-search.ts` reuses the real search and ranking functions (offset cursor). T-036 backlog done (`reload()` ok/failed/superseded; "Signed up").
- Tests: unit 924, RLS 118, API 403, Playwright real 38 + mock 98 (CI run 38063168825). Real-route: a visitor finds a newly approved Vietnamese chef in Mississauga (CLAUDE.md §12 step 1); pending chef not listed. Tester round 1 PASS; Planner sent back two LOWs before review (mock pages requested hosted public storage for made-up photo paths — also fixed in the dish editor; a malformed chef id crashed the mock); round 2 PASS with zero hosted requests across all 98 mock tests. Reviewer APPROVE.
- Findings for later: a one-area city would pin that chef's area centre (seed has at least 4 areas per city); the public OSM tile server is for light use only (configurable tile URL and README limit before WO-7); unit tests for the mock adapter time out on a busy machine (also on main; T-051).

### T-041 — Chef detail page (done 2026-10-10, PR #90) — WO-4a complete
- `/chefs/[id]` reads only `GET /api/chefs/:id`: photo, name, bio, cuisines, languages, rate, rating, location options (chef's home with a MOCK kitchen-review note), active dishes (photo with fallback, cost in dollars, cook time, servings, eat-by days, allergens in words; "No allergens listed by the chef", never "free"), available days from the response's `today`/`lastBookableDay` (booked days not yet removed, stated). One "Chef not found" for every 404; retry state for other errors and malformed answers (`isChefDetail`), plus `error.tsx`; neutral "cannot be booked yet" for no location options (Q-21). Book is an inert "Booking opens soon" stub.
- "Back to search keeps filters" via sessionStorage (own searches only, one tab, strict read-back). Photo paths checked by `isSafeStoragePath` (no dot or empty segments, leading slash, backslashes or control characters). T-040 carry-overs done (A-25 list label, MOCK note on the kitchen filter).
- Tests: unit 1012 (plus 3 known-gap expected failures), RLS 118, API 403, Playwright real 41 + mock 120 (CI run 38069625414). Tester round 1 PASS; Planner sent back the dot-segment path and the malformed-answer crash before review; round 2 PASS. Reviewer APPROVE.
- Findings for later: the saved search can keep a full postal code in sessionStorage until the tab closes (save the prefix only or add "Clear search"); `isChefDetail` does not type-check dish `photoPath`, `description` or `serviceCity` (three `it.fails` "KNOWN GAP" tests; `error.tsx` catches it); the real-route helper always makes a chef offering both places, so "cannot be booked yet" is covered only by mock and unit tests; no skip link (T-052).
- Follow-ups for WO-4b: T-042 — enable Book when the chef has at least one place to cook; remove booked days from `bookableDates`, the `date` filter and the page text; re-check approved, `chef_home_enabled` and radius at booking; settle Q-20 and Q-21 first. T-043 — reuse the dish cost and allergen display; keep the "estimate" wording.
- Process: three lessons added to `docs/lessons-learned.md` (mock mode must not reach hosted services; check API paths before building URLs; name custom map markers) plus the macOS `sed -i ''` note.

### T-061 — Rule changes from D-21, D-24, D-25 (done 2026-10-10, PR #93; migration applied to hosted 2026-10-10)
- D-21: admin list items carry `failedChecks` and `flagged` (approved chef with any failed MOCK check, police included; status unchanged); kitchen review of a `rejected` chef is a 409 `INVALID_STATE` with no write, checked on the locked row; rejecting a chef turns `chef_home_enabled` off in the same update (re-approve leaves it off). New migration `20261010150000_admin_rules_d21.sql` (create or replace of the two T-035 functions, service_role only, SECURITY INVOKER) with a drift guard test. **Pushed to hosted 2026-10-10.**
- D-24/D-30: `SYNONYM_GROUPS` in `src/lib/domain/allergy.ts`, both directions, no under-warning regression. D-25: a chef with no bookable location option gets the same 404 as an unknown id. Contract v1.3.1 (v1.4 stays for T-042).
- Tests: unit 1264 (3 known-gap expected fails), API and RLS in CI (run 38093455855). CI failed once on an outdated exact-key test (builder fixed); the Tester's first pushes failed on two test-setup mistakes (fixed). Tester PASS, Reviewer APPROVE.
- Findings for later: gluten grains missing (now D-32, T-042); coconut and buckwheat correctly do not match (Health Canada lists); mock admin adapter does not mirror the 409 or the reject side effect (T-062); the drift guard strips `--` even inside quotes (harmless today).

### T-042 — Booking API (done 2026-10-10, PR #95; migrations applied to hosted 2026-10-10)
- Contract v1.4 (§7A, plus 5B, 7, 11A): `POST /api/bookings/estimate`, `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/:id`, `POST /api/bookings/:id/accept`, `POST /api/bookings/:id/decline`. T-063 route shapes are in §7A marked PROPOSED. New codes `DOUBLE_BOOKED`, `TOO_MANY_OPEN_REQUESTS`, `REQUEST_EXPIRED`, `DATE_BOOKED`, `DATE_TOO_SOON`, `CONTACT_DETAILS_NOT_ALLOWED`.
- Migrations `20261011100000_booking_expired_status.sql` (enum value `expired`) and `20261011100100_booking_api.sql` (`create_booking`, `answer_booking`, `expire_stale_bookings`, `chef_remove_availability`, `record_free_trial_block` service-role only; public `chef_booked_dates` and `chefs_booked_on` return only approved chefs inside tomorrow..today+180). **Pushed to hosted 2026-10-10.**
- Booking, days, dish snapshots with eat-by, intake, free-trial claim and chef notification are written in one transaction (T-038 MEDIUM closed). Double booking by unique index; D-28 by a per-customer advisory lock; accept, decline and expiry serialised under a row lock. D-19 expiry is lazy (create, list, detail, answer, availability); public reads skip stale requests without writing. D-22 409 `DATE_BOOKED`; D-23 blank intake refused; D-27 earliest day 1 is tomorrow (`firstBookableDay`); D-31/D-32 search uses the synonym map with the gluten grains. Free-trial block log grouped per customer, reason and hour. D-34 decline reason required. Implementation choices (not Jimmy decisions): the reason is 3 to 500 characters (builder's rule), and the Planner added a best-effort guard, the shared `src/lib/domain/contactDetails.ts`, that refuses a reason that looks like a phone number, email or link (§6.8: no contact details before acceptance; from the Tester's round 1 finding).
- Tests: unit 1513 (3 known-gap expected fails), RLS, API and Playwright real + mock in CI (final run 38103215218). Tester round 1 PASS (37 cases incl. races repeated 4 to 5 times), round 2 PASS (D-34 and the guard). Reviewer APPROVE with 5 LOW; findings 1 (public date helpers too open) and 5 (stale comment) fixed in round 3, Reviewer confirmed APPROVE.
- Carry-ins: T-063 — accept locks the chef row and re-checks `chef_home_enabled` (finding 2); D-33 completion; D-22 reject cascade; D-26 cooked marker; `findContactDetails` on cancel reasons. WO-5 — messages on a stale request (finding 4a); `findContactDetails` on chat before acceptance; notifications read route; admin lists incl. block `attempts`. WO-7 — scheduled `expire_stale_bookings(null)` (findings 3, 4b). T-062 — mock adapter still lists today and has no `firstBookableDay`; stale e2e-mock wording "booked days are not removed"; mirror 409 `DATE_BOOKED`. T-043 — show `wouldExpireAt`, the under-48-hour late-cancel warning, addresses after acceptance; handle `FREE_TRIAL_USED` by retrying with `useFreeTrial: false`.
- Found during the task: `findContactDetails` flags dotted dates and 7+ digit runs (accepted, pinned in tests); Q-23 street addresses. No Docker on this Mac: API and RLS tests run only in CI; Backend checked SQL locally with PGlite (added to lessons-learned).

### T-062 — UI updates from D-21, D-22, D-25, D-27 (done 2026-10-11, PR #98; no migration)
- D-21: admin queue shows a "Needs a look" flag with a MOCK badge for an approved chef with a failed MOCK check (the chef stays approved until rejected); a rejected chef's kitchen section has no review controls. D-22: availability save refused with 409 `DATE_BOOKED` names the booked dates, moves focus to the alert and says "Nothing was saved. … Keep it/them ticked." D-25/D-27: chef page has no "cannot be booked yet" state; dates start at `firstBookableDay` (now a required field). Out-of-window calendar days got a darker colour for dark-mode contrast. `parseSavedForm` uses `TEXT_MAX` on the trimmed length, like the form check.
- Mocks now mirror the real API: rejected-chef kitchen review 409, reject turns the chef's home off, 409 `DATE_BOOKED` (in MOCK the day 3 days from today is always booked), hidden chef 404, dates start tomorrow. `blockStorage(page)` is in every mock Playwright spec that renders photos (lessons-learned backfill done).
- Tests: unit 1520 (3 known-gap expected fails), mock Playwright 121, real Playwright/API/RLS in CI (green on the PR's final head 8a781a7, run 38113060263). Tester PASS; it fixed a calendar e2e that skipped itself near month end and a vacuous admin-mock check. Reviewer round 1 REQUEST CHANGES (1 MEDIUM: the 409 message promised "ask the customer to cancel", which does not exist yet; 4 LOW wording/type/test fixes); round 2 APPROVE.
- Later: T-063/WO-5 — the 409 message can suggest cancel or chat once they exist. WO-6 README demo script — mention the MOCK booked day (today + 3).

### T-063 — Booking changes API (done 2026-10-11, PR #101 merged c3677e8; migration applied to hosted 2026-10-11)
- Contract v1.5 (§7A "Booking changes"; error fields `reason` and `latest`; new BookingDetail fields `cookedAt`, `pickupDeadlineDate`, `pickups`). Routes under `/api/bookings/:id/`: `cancel`, `no-show`, `complete`, `days/:dayNumber/cooked`, `days/:dayNumber/pickup/propose`, `days/:dayNumber/pickup/respond`, `pickup/missed`.
- Migration `20261011200000_booking_changes.sql`: `change_booking`, `sweep_booking_changes` (lazy D-33 auto-complete), time helpers; tables `pickup_proposals` and `booking_flags` (RLS, select-only); `answer_booking` locks the chef row and re-checks `approved` and `chef_home_enabled` (T-042 finding 2); `admin_reject_chef` does the D-22 cascade. **Pushed to hosted 2026-10-11 by Jimmy** (verified with `supabase migration list --linked`).
- Built: D-20 cancel timing, D-26 cooked marker (cooked before cancel consumes the trial), D-29 missed pickup, D-33 completion, D-34 contact-details guard on cancel reasons, N3 kitchen-address change blocked while a chef's-home booking is accepted. Builder assumptions 1-9 are in `.team/handoffs/T-063-backend.md`; the Reviewer found none that conflicts with a recorded decision. 3 and 7 are now Q-25 and Q-24; 4 (24 h = end of the last date + 24 h, later for chef's-home pickups) stands until Jimmy says otherwise.
- Tests: unit 1550 (3 known-gap expected fails), API and RLS in CI only (no Docker locally), CI green on the final head 87c0ec2. Tester PASS and added 6 API tests (`booking-changes-extra.test.ts`). Correction to the Tester handoff: the auto-complete with zero cooked days case *is* covered, by `tests/api/booking-changes.test.ts:336-343`, so that test must change if Q-29 changes the rule.
- **Process:** the Reviewer agent was blocked twice by the auto-mode permission check ("self-approval"), so Jimmy approved the merge in chat. The Reviewer then did a post-merge review (comment on PR #101; `.team/handoffs/T-063-reviewer.md`): no revert needed, security, locking, RLS and the MOCK labels are sound; 4 MEDIUM, 6 LOW. M1 → Q-29, M2 → Q-30, M3 → T-064 and Q-28, M4 → T-065 and Q-12, L1/L2/L5 → T-066, L3 → Q-26, L4 → T-065, L6 → Q-23.
- Next agents: T-045 uses `days[].cookedAt`, `pickupDeadlineDate`, `pickups`, `error.reason`, `error.latest`, and tells chefs the kitchen address is locked while a chef's-home booking is accepted (409 `kitchen_in_use`). T-043 shows the `late` warning when day 1 is under 48 h away; `cancelledBy: system` means the chef was removed. WO-5: admin list shows `booking_flags`; resolve reports (Q-27); reviews rely on `completed` (settle Q-29 and Q-30 first). WO-7: schedule `expire_stale_bookings(null)` and `sweep_booking_changes(null)`.

### T-043 — Booking flow UI (done 2026-10-13, PR #103 merged e770a48; no migration)
- Two-step flow at `/chefs/:id/book` (form, then review and send), plus a customer "My bookings" list (`/bookings`) and booking page (`/bookings/:id`). Built: 1–3 days from tomorrow (D-27) with dishes per day, cooking place (only the options the chef offers; address only for the customer's home), mandatory intake (D-23), allergy conflict tick (D-24, D-38), grocery options A and B at cost, estimate matching `pricing.ts` (platform fee shown with MOCK and not collected; travel only at the customer's home), 6-hour limit per day, free-trial label and the `FREE_TRIAL_USED` retry at full price, MOCK payment panel with no card form (D-18), D-19 expiry note, D-20 late-cancel warnings, D-28 refusal, chef phone and kitchen address only after acceptance (§6.8). Server guards with `requireCustomerPage()` on all three pages.
- Round 2 (Jimmy's answers): D-39 "Day by day" block from the estimate API's `days[]`; D-40 warning above the form at 3 open requests (`GET /api/bookings?status=requested`; warning only, as built). D-38 and D-41 need no change.
- Round 3: the Tester found the per-day caption said labour was "before the free first booking", but `days[].labourCents` is 0 under the trial (`pricing.ts:98`). The Planner chose a frontend-only fix: the caption now says labour is free on this booking and the waived value is in the totals. The contract wording goes to T-044.
- Round 4: the Reviewer's 5 LOW findings fixed before merge: per-instance heading ids, focus stays on the alert after "Book at full price instead", "At this address" wording, the "Waiting now" count uses the `requested` query, fallback text depends on `locationType`.
- Builder assumptions 1–8 are in `.team/handoffs/T-043-frontend.md` (two-step flow; free trial ticked by default; send disabled without a verified phone; `/bookings` list added; cooking address prefilled from home and editable; form closes after send; text-only MOCK payment; eat-by days are a prototype default). The Reviewer judged the `/bookings` page in scope (well under 25%).
- Tests: unit 1625 (3 known-gap expected fails), mock Playwright 149, real Playwright/API/RLS in CI (green on the final head eef4e81). Tester PASS in every round (round 2 with one MEDIUM, fixed in round 3); it added `e2e-mock/booking-flow-tester.spec.ts` and `PerDayEstimate.sums.test.tsx`. Reviewer APPROVE in round 1 (5 LOW) and round 4, posted as PR comments (`.team/handoffs/T-043-reviewer.md`).
- **Process:** the Reviewer agent started fine in auto mode, but one GitHub account cannot approve its own PR, so the verdict is a comment that starts with "APPROVE". `main` protection requires only `ci`. Jimmy approved the merge plan in chat on 2026-10-13.
- Info for later: "Waiting now: 0" shows briefly before the count loads; `ChefDetailView.tsx` keeps a fixed `where-h` id (no clash now); `BookingFlow.tsx` is about 1,550 lines (split is a safe follow-up); `MockPayment` always uses an `h2`. Next: T-044 (backend), then T-045; T-067 and T-068 queued.

### T-068 notes (Impeccable install, WO-T068)
- Install command (run from the repo root, 2026-10-14): `npx impeccable@4.5.2 install --providers=claude --scope=project --yes` (skill version 4.5.2, engine v0.1.14). `install --help` documents no separate hook flag; `--yes` accepts the detected defaults, which includes the design hook, and `--no-hooks` is the documented way to skip it.
- The hook went only to `.claude/settings.local.json` (gitignored here, committed `.claude/settings.json` untouched). The 16 MB engine binary the installer drops in `.claude/skills/impeccable/scripts/bin/` is gitignored; the launcher downloads the pinned engine into `~/.impeccable/` on first use.
- `.impeccable/config.json` has `"telemetry": false` (committed, shared). `PRODUCT.md` is written from CLAUDE.md sections 2 to 4 only; gaps say "Not decided yet (open question for Jimmy)".
- Done 2026-10-14: PR #107 merged fe56d03 (Work Order PR #105 merged 30506b0), issue #106 closed, no migration. Tester PASS (lint clean, unit 1625 + 3 expected fails, mock e2e 149); Reviewer APPROVE (3 LOW, see `.team/handoffs/T-068-reviewer.md`). Merged under D-42.
- The installer exited with code 1 after printing "Done"; all files were in place and `detect` works. It shipped no LICENSE or NOTICE, so the upstream files were added (byte-identical, checked by the Reviewer). ESLint ignores `.claude/skills/**` (vendored scripts gave 94 warnings).
- Telemetry: the installed files do not document the config key, so the Planner and Reviewer checked upstream `crates/context/src/telemetry.rs`: `"telemetry": false` in the project `.impeccable/config.json` is honoured. The hook command also sets `IMPECCABLE_NO_TELEMETRY=1` as a second guard.
- Hook: the installer wrote it into the worktree's `settings.local.json`; after merge and Jimmy's OK (D-43) the Planner placed it in the main folder's `.claude/settings.local.json` (SessionStart, PostToolUse on Edit|Write, Stop). A manual run exited 0, and the first run downloaded engine 0.1.14 into `~/.impeccable/bin/` (checksum-checked). It runs for every agent, Backend too.
- Baseline for the T-045 trial (`detect`, 4.5.2): search, bookings, booking and search components clean; across `src/app` and `src/components` one finding, `[overused-font]` Arial at `src/app/globals.css:25`. Not fixed (left for T-045 or T-069).
- D-44: the 4 `impeccable-*` agents were removed in the notes PR. Only the skill's new-work and live-mode flows spawn them; `frontend.md` now says to skip those steps (our Tester and Reviewer cover them). Q-31: PRODUCT.md gaps drafted by the Planner; approved 2026-10-14 (D-45).

### T-044 — Grocery options API (done 2026-10-14, PR #110 merged 42d1aec; migration 20261014100000 pushed to hosted 2026-10-14 with Jimmy's OK)
- Contract v1.6: §7B shopping list and receipts; §7A now says `days[].labourCents` is after the free-trial waiver (T-043 carry-in). Routes: GET `/api/bookings/:id/shopping-list`; GET/POST `/api/bookings/:id/receipts`; POST `/api/bookings/:id/receipts/:receiptId/respond` (confirm, or dispute with a 3–300 character note). Booking parties only (route checks + RLS); admin can read receipt objects.
- Migration `20261014100000_grocery_receipts.sql` (additive): receipts `superseded_at`, `customer_disputed_at`, `dispute_note`; unique `file_path`; one current receipt per booking; `submit_receipt` / `answer_receipt` (service role only, booking row locked, conditional update); storage upload only for an accepted or completed `chef_shops` booking (`booking_accepts_receipts`), still insert-only.
- Mismatch flag uses `checkReceipt` (A-15) against the immutable estimate snapshot. Reimbursement is MOCK (`mock: true, collected: false`), amount only after the customer confirms, no markup.
- Tests: Backend 33 unit + API + RLS; Tester added 51 unit, 30 API, 2 RLS (A-15 boundaries, access matrix, paths, races, storage privacy); final CI green (unit 1709 + 3 expected fails, API 596, RLS 143). Tester PASS twice, Reviewer APPROVE twice (round 2 fixed LOW-1 option B only and LOW-2 comment). See `.team/handoffs/T-044-{backend,tester,reviewer}.md`.
- Jimmy's decisions: D-46 to D-49. Open: Q-32 orphan receipt files, Q-33 A-15 tolerance.
- Carry-ins for T-045: upload to `receipts/<booking id>/<uuid>.<ext>` with the chef's session (never upsert), then POST path + `amountCents`; handle 409 reasons `not_chef_shops`, `wrong_status`, `receipt_waiting`, `receipt_confirmed`, `path_used`, `already_answered`, `receipt_superseded`; flagged receipts show `differenceCents` and `toleranceCents` and need an explicit answer; MOCK badge on reimbursement; show `plan.note` for option A at the chef's home; `fileUrl` is a 10-minute signed link. T-045 is the Impeccable trial (D-43; baseline: only Arial in `globals.css:25`).

### T-045 — Chef booking dashboard and grocery screens (done 2026-10-14, PR #112 merged 5a8afdb; no migration, no API change)
- Built: `/chef/bookings` (grouped: waiting for your answer, accepted, finished) and `/chef/bookings/[id]` (server guard `requireChefPage` in the layout and each page); intake and allergy conflicts above Accept / Decline; decline reason required (D-34); eat-by per dish; mark day cooked, then "Visit done"; kitchen-address notice and `kitchen_in_use` wording; D-29 pickups on both sides (customer proposes in Toronto time, chef accepts or declines, "pickup missed" after the window with a confirm step); groceries on both booking pages (option A per-dish list and plan note in chef wording; option B chef upload to `receipts/<booking id>/<uuid>.<ext>` with `upsert: false`, all §7B refusals worded; customer confirm or dispute 3–300 chars; flagged receipts show difference and tolerance; MOCK badge on every reimbursement; signed link http(s) only, refetched every 8 minutes). New `useAnnounce` hook shared by the chef page, the customer page and groceries.
- Rounds: Tester PASS (3 observations); Jimmy's answers (round 2, D-50, D-51, T-070; Tester round 2 PASS on 0d968a7); Reviewer REQUEST CHANGES on M1 (privacy wording on finished bookings did not match `booking_contact_unlocked`) plus L1–L7; round 3 fixed M1 and L1–L6 (L7 `http:` links skipped, needed locally); Tester and Reviewer PASS / APPROVE. Final: unit 1850 + 3 expected fails, mock e2e 198, CI green on 202d34a.
- Not proven yet: the real storage upload and the server redirects run only with a real session (CI real mode or a hosted try). Worth a manual try on hosted before the demo.
- Follow-ups: T-070 (chef cancel and no-show buttons, Reviewer N1, customer-page wording); Q-34 backend gaps.
- **Impeccable trial (D-43):** Frontend used `SKILL.md`, `impeccable context`, `craft-floor`, `operate`, `layout`, `clarify`, `harden` and one screenshot round at 420 px (Frontend's report; not seen by the Reviewer). `detect` on `src/components/booking` and `src/app/chef` was clean before and after (not re-run across all of `src/app`; `globals.css` untouched, so the Arial baseline at line 25 stands). It shaped choices (list grouped by what the chef must do, allergies first, dividers instead of nested cards, action-named buttons). The Reviewer found the UI follows `PRODUCT.md` and stays consistent with existing pages; some sentences were long for English learners (shortened in round 3). The static detector added nothing here; the value came from the reference guides plus axe, 375 px and dark-mode checks. The design hook did not visibly fire for the subagent in the worktree. Verdict for Jimmy: useful as a design checklist, not a quality gate; keep it for T-069.

### T-066 — Booking change fixes (done 2026-10-14, PR #116 merged adc0d98; migration 20261014150000 pushed to hosted 2026-10-14 with Jimmy's OK)
- Migration `20261014150000_booking_change_fixes.sql`: `booking_flags.reason` allows `no_day_cooked`; `sweep_booking_changes` auto-completes only with a cooked day (D-36), else one `no_day_cooked` flag and a neutral `booking_flagged` notice to each party, and auto-completion voids pickups; `change_booking` `complete` voids proposed and accepted pickups (L2); `admin_reject_chef` cascade skips stale requests, which the expiry sweep marks `expired` (L1). Service role only, lock order unchanged. TS: `freeTrialEffect` `no_show_chef` follows the cooked marker (D-37). Contract v1.7.
- Tester: the first Tester session was cut off by the usage limit; a second one finished it. Two CI failures were bugs in the new tests (a shared `far(5)` date across RLS files; a cooked mark after the lazy sweep had already flagged). PASS, no app bug. Reviewer APPROVE: function bodies diffed against `20261011200000` (only intended changes). LOW-1 -> Q-36; LOW-2 and NIT-1 -> T-064. See `.team/handoffs/T-066-{backend,tester,reviewer}.md`.

### T-070 — Chef cancel, customer no-show, privacy wording (done 2026-10-14, PR #117 merged 3152803; no migration, no API change)
- Chef cancels an accepted booking (D-20 timing, D-26 trial wording, MOCK) and reports a customer no-show once a visit date has come and is uncooked; privacy wording per status matches `booking_contact_unlocked`; customer page promises sharing only while `requested`.
- Rounds: Tester PASS (4 LOW, 1 INFO); Reviewer REQUEST CHANGES (M1 a mock e2e test used the UTC date as "today" and failed every evening; M2 chef's-home cancel text did not say the chef loses the customer's phone; L1-L4, N1); round 2 fixed M1, M2, L1, L2 (stale alert), N1; Tester and Reviewer PASS / APPROVE. L3 became Q-37 -> D-56 (copy stays). L4 (mock order for expired requests) skipped. Unit 1923 + 3 expected fails, mock e2e 211. See `.team/handoffs/T-070-{frontend,tester,reviewer}.md`.

### T-067 — Saved allergy profile, backend part (PR #120 merged 106b99b; migration 20261014200000 pushed to hosted 2026-10-14 with Jimmy's OK; frontend part still to do)
- Routes `GET`, `PUT`, `DELETE /api/me/intake` (customer only, role from `profiles`); two nullable columns on `profile_private` with an object check; validation reuses the booking `parseIntake`; never shown to chefs or in `/api/me`; `savedAt` always ISO with `Z` (the first CI run caught GET returning Postgres `+00:00`). Contract v1.8 section 4A (renumbered from v1.7 by the Planner when merging main, since T-066 took v1.7).
- Tester PASS (added `tests/api/saved-intake-tester.test.ts` and RLS privacy assertions); Reviewer APPROVE: LOW DELETE checks content type before the session (fix in the frontend part); NITs (state the order of checks in 4A, comment in `savedIntake.ts:26`, odd contract status line; the last one is fixed on main by the v1.8 merge); admin read access -> Q-38. See `.team/handoffs/T-067-{backend,tester,reviewer}.md`.
- Process: `gh pr merge --delete-branch` from the main folder also removed the task worktrees (seen 2026-10-14 with the installed gh), so no manual `git worktree remove` was needed.

### T-065 — Contact privacy (done 2026-10-15, PR #124 merged a5a846b; migration 20261015100000 pushed to hosted 2026-10-15 with Jimmy's OK)
- Migration `20261015100000_contact_privacy.sql`: table `booking_kitchen_addresses` (RLS on, no client access); `answer_booking` copies the chef's kitchen address on accept in the same transaction (T-063 review M4); backfill for already-accepted chef's-home bookings (D-62); `set_chef_kitchen_address` locks chef then chef_private and refuses `kitchen_in_use` (N3 / L4); `booking_contact_ends_at` = 00:00 Toronto on last visit day + 8 (D-52), for accepted, completed and both no-shows; cancelled, declined, expired and requested never show contact (D-56). `get_booking_contact` returns the snapshot and `visible_until`, revoked from anon. Contract v1.9 adds `contactVisibleUntil` (D-61). A refused kitchen-address PATCH now saves nothing.
- Backend fixed two of its own CI failures (Supabase default execute grant on a new function; RLS fixtures). Tester PASS, no bugs (added DST, multi-day, no-days, stranger and grant tests). Reviewer APPROVE: L1 two transactions in `mutate` (safe state) -> T-074, L2 `contactVisibleUntil` -> D-61, L3 UI copy -> T-073, L4 kitchen photos -> D-58, NITs -> T-074. See `.team/handoffs/T-065-{backend,tester,reviewer}.md`.

### T-072 — UI follow-ups from T-066 (done 2026-10-15, PR #125 merged 1f59aaa; no migration, no API change)
- Neutral "waiting for a check" on accepted bookings whose days are all past and uncooked (customer and chef pages, derived from days); list line "All visit days have passed..."; chef no-show trial wording via `freeTrialEffect("no_show_chef", { anyDayCooked })` (D-37); mark-cooked prompt for past uncooked days (matches D-57).
- Tester PASS (L-A wording shows up to 2 days before the server flag; L-B customer Cancel shown on a waiting booking, refusal worded). Reviewer APPROVE (same LOWs, freeze-awareness LOW, plural NIT) -> T-073 (L-A waits on Q-35). Unit 1949 + 3 expected fails, mock e2e 215. See `.team/handoffs/T-072-{frontend,tester,reviewer}.md`.

### T-074 — Backend follow-ups from T-065 (done 2026-10-15, PR #129 merged 4b6b43f; migration 20261016100000 pushed to hosted 2026-10-15 with Jimmy's OK)
- Migration `20261016100000_kitchen_followups.sql`: D-58 `can_view_kitchen_photos` uses `booking_contact_open`, so kitchen photos follow the D-52 window (and hide at once on cancel, D-56); D-59 `answer_booking` returns `kitchen_address_missing` for a chef's-home accept without a complete kitchen address (API 409 `INVALID_STATE` with that reason); T-065 L1 `set_chef_kitchen_address` writes whitelisted `chefs` columns in the same transaction; N1 `for no key update`, N2 explicit revoke, N3 assert, N4 indentation, N5 retention note. Contract v1.10.
- Tester PASS, no bugs (30 tests: photo status/window matrix, D-59 per missing part, rollback, whitelist). Reviewer APPROVE: L1 empty-string check and N1 comment -> T-064; I1 photos per chef -> Q-39. See `.team/handoffs/T-074-{backend,tester,reviewer}.md`.

### T-073 — Contact window UI (done 2026-10-15, PR #130 merged 425c751; no migration, no API change)
- Booking pages explain D-52 and show the cut-off in Toronto time from `contactVisibleUntil`; "Contact details are hidden now" after it; cancelled bookings promise no window (D-56). Customer Cancel hidden when every visit is past (T-072 L-B); plural "Mark them as cooked". D-59 refusal shown in the focused alert above Decline (UI wording; mock switch only in tests). D-58 needed no UI change (no kitchen photos block on booking pages).
- Round 2 after Jimmy's D-63 and D-64: "Chat stays open." removed; the cut-off day is (`contactVisibleUntil` − 1 ms) in America/Toronto; shared `KITCHEN_ADDRESS_MISSING_MESSAGE`; mock detail route passes `now`. Tester added DST edge tests (spring and fall).
- Tester PASS both rounds; Reviewer REQUEST CHANGES (only D-63/D-64) then APPROVE (NIT doc comment -> T-067 frontend). Unit 1978 + 3 expected fails (before the Tester's round-2 DST tests), mock e2e 220. Left out by design: D-53 freeze item (T-064), Tester L-A (Q-35); a page left open across the cut-off keeps its text until reload. Declined and expired bookings keep the "not shown for this booking" line (builder question 2, accepted in review). See `.team/handoffs/T-073-{frontend,tester,reviewer}.md`.

### T-064 — Flagged bookings freeze (done 2026-10-15, PR #134 merged aff0070; migration 20261017100000 pushed to hosted 2026-10-15 with Jimmy's OK)
- Migration `20261017100000_flag_freeze.sql`: `booking_flags.resolved_at`; an open flag other than `no_day_cooked` freezes the booking (D-53): `change_booking` refuses every action by either party with 409 `frozen` (D-65), the sweep never auto-completes it, receipt submit and upload are refused; receipt confirm and dispute stay allowed (D-66). `no_day_cooked` does not freeze and completing the booking resolves it, by the chef or the sweep (D-57). Chef reject upgrades an open `no_day_cooked` flag to `chef_rejected` (D-68). Contract v1.11: `BookingDetail.frozen` read through `get_booking_frozen` (parties only; null for strangers and admin); neutral message, no reason. Mock hook `frozenSeeded`. Follow-ups done: T-066 LOW-2 (id-order locking) and NIT-1, T-074 L1 (btrim) and N1.
- Tester PASS, no bugs (added D-65, D-66, D-68 API tests and mock tests). Reviewer APPROVE: LOW-1 interim wording -> Planner comment-only commit citing D-65 to D-68 before the db push; LOW-2 the sweep re-locks due frozen and `no_day_cooked` bookings on every call (fine at prototype scale; WO-7 or T-048); INFO-1 an upgraded flag keeps its original `created_at`, INFO-2 a resolved `chef_rejected` flag is not reopened by a second reject (both for T-048); INFO-4 e2e with `frozenSeeded` -> T-077. See `.team/handoffs/T-064-{backend,tester,reviewer}.md`.

### T-067 — Saved allergy profile, frontend part (done 2026-10-15, PR #133 merged d41f3d4; no migration)
- New customer-only page `/allergies` (view, save, update, delete with confirmation); the booking intake is prefilled only while untouched; an unticked opt-in saves changed answers back after the booking is created; a failed save keeps the booking and shows a notice. Shared `IntakeFields`. Mock routes for `/api/me/intake`, forgotten on log out. Carry-ins: DELETE check order 401, 403, 400 (contract sentence and API test), `changes.ts` comment moved. Privacy wording states only what the code enforces and says nothing about admin (Q-38).
- Tester found T67-T1 (LOW: "Book another visit" refilled from the old profile after a replace); fixed in round 2, which also waits for the pending save before refilling. Tester PASS (proved the test fails without the fix). Reviewer APPROVE: LOW focus on the delete confirm and NITs -> T-076; `apiFetch` timeout -> T-075; `aria-invalid` on a fieldset kept as is. Planner decision: no one-time prompt asking existing customers to save a profile (builder's optional question). Unit 2002 + 3 expected fails, mock e2e 234. See `.team/handoffs/T-067-{frontend,tester-frontend,reviewer-frontend}.md`.

### T-077 — Frozen booking UI, includes T-076 (done 2026-10-15, PR #137 merged 5cc3773; no migration, no API change)
- Both parties see a neutral "On hold." notice from `BookingDetail.frozen` (no reason, flag or admin wording). Hidden while frozen: the chef's mark-cooked prompt, Mark day N, Visit done, chef cancel and customer no-show, pickup accept/decline and missed pickup, receipt upload; the customer's Cancel and propose form. Kept (D-66): receipt Confirm and Dispute. `no_day_cooked` stays unfrozen (D-57). Every 409 `frozen` maps to the shared `FROZEN_TEXT`. T-076: focus moves to the delete confirm question and to the saved-state line after a delete; the hidden save box unticks; contract 4A wording.
- Reviewer round 1 REQUEST CHANGES: MEDIUM-1 missed pickup still showed on a frozen booking (no control test had a passed pickup window); INFO-1 cancel used the server message; N1/N2 wording. Round 2 fixed all four ("Pickups are paused while this booking is on hold.", "A receipt cannot be added while this booking is on hold."). Tester PASS both rounds; Reviewer APPROVE round 2. Unit 2025 + 3 expected fails, mock e2e 243. NIT-2 (repetitive on-hold wording) accepted for the prototype; other follow-ups -> T-078 and T-048. See `.team/handoffs/T-077-{frontend,tester,reviewer}.md`.

### T-075 — One timeout for every API call (done 2026-10-16, PR #140 merged 5c33629; no migration, no API change)
- `apiFetch` (`src/lib/api/client.ts`) has one 20 s timer (`API_TIMEOUT_MS`) over the whole exchange, including the body read, on the real fetch, injected fetches and the mock adapter. On expiry it throws `TIMEOUT` (status 0, separate from `NETWORK`) and aborts the request. GET says "Please try again."; writes say the change "may or may not have gone through. Check before you try again." No per-call override (no caller needs one; uploads go straight to Storage). SearchView, `lib/booking/changes.ts` and `lib/admin/queue.ts` treat `TIMEOUT` like `NETWORK`.
- The admin link-retry mock e2e needed a second `fastForward("00:31")`: under Playwright's fake clock a big jump can fire the 20 s timeout before the mock answers. Real users only see a change when a request hangs (it now fails after 20 s, then retries 30 s later).
- Tester PASS (+4 edge tests: AbortError still TIMEOUT, limit boundary, no unhandled rejection after a late answer, timer cleared on 500 and 502). Reviewer APPROVE: LOW lessons line on fake-clock jumps (added), INFO duplicate messages/reviews on a retried write -> T-048, NITs (shadowed names; `AbortController` + race instead of `AbortSignal.timeout` is the better fit). `ci` was red only from T-079. Unit 2040 + 3 expected fails, mock e2e 243. See `.team/handoffs/T-075-{frontend,tester,reviewer}.md`.

### T-079 — RLS test date clash (done 2026-10-16, PR #142 merged 2f1a62d; tests and docs only)
- Root cause: `booking-changes.test.ts` (L5 test) books 3 chefs on the fixed date 2026-10-31, which is Toronto today + 15 = `far(5)` in `booking-api.test.ts` only on 2026-10-16, so an exact list saw 4 chefs. `chefs_booked_on` itself is correct. The earlier red run on main (340dcc4) was a different flake: `groceries-tester.test.ts` matched "fee" inside a random signed-URL token.
- Fix: `chefs_booked_on` asserts check only the test's own chefs (`toContain` / `not.toContain`, pending and rejected chefs still checked), `ids()` fails on an RPC error; the groceries check drops `fileUrl`, `id` and `bookingId` and keeps the plain `/markup|fee/i` (camelCase keys like `platformFeeCents` are still caught). Two lessons rows.
- Reviewer round 1 REQUEST CHANGES (UUIDs can contain "fee"; `ids()` swallowed errors; long lesson row); round 2 REQUEST CHANGES (`\b` regex missed camelCase keys); escalated, D-72 round 3; Reviewer APPROVE. `ci` green. See `.team/handoffs/T-079-{tester,reviewer,reviewer-r2,reviewer-r3}.md`.

### T-071 — Customer confirms pickup, D-55 (done 2026-10-16; backend PR #145 merged f41105b, frontend PR #146 merged f29c546; migration `20261018100000_pickup_confirm.sql` pushed to hosted, DBPUSH-T071)
- Backend: `booking_days.picked_up_at`; `change_booking` gets a customer-only `pickup_confirm` action (idempotent, one `pickup_confirmed` notice to the chef, voids that day's proposals); `pickup/missed` ignores confirmed days (409 `pickup_confirmed`, text "...for every visit whose pickup deadline has passed, so there is no missed pickup to report now"); `pickup/propose` on a confirmed day is 409 `picked_up`. Contract v1.12 with A-26 to A-29 marked as assumptions. Frontend: per-day "I picked up my meals" button with a "This can't be undone" step, "Picked up on <time>" for both sides (kept after the booking ends), chef's "pickup missed" hidden unless a past-deadline cooked day is unconfirmed, proposing hidden on a confirmed day; mock route and `pickedUpSeeded` hook.
- Backend Tester PASS twice (+10 API gap tests: content type, roles, per-day void, parallel confirms, mixed days). Backend Reviewer round 1 REQUEST CHANGES (MED-1 the `pickup_confirmed` text claimed missed could never happen; LOW contract check order, grant block; NIT), round 2 APPROVE. Frontend Tester PASS twice (+13 unit, +4 mock e2e); Reviewer APPROVE twice (LOW-1 picked-up line lost after completion, fixed in round 2; stale-409 reload -> T-080). Planner merged main into #146 after #145 (conflicts only in backend files, taken from main). Unit 2088 + 3 expected fails, mock e2e 254. See `.team/handoffs/T-071-{backend,frontend,tester-backend,tester-frontend,reviewer-backend,reviewer-frontend}*.md`.
