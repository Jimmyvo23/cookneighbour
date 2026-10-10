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
- A-6 **Cancellation timing:** free cancellation until 48 hours before the first day; later cancellations are recorded as "late". A cancellation before the visit never consumes the free trial (§6.6). *Values are placeholders — see Q-8.*
- A-7 **Eat-by date** = cook date + the dish's shelf-life days (default 2).
- A-8 **Fee defaults:** platform fee 10%, travel fee $0.60/km one way, chef travel radius default 15 km. Configurable constants. *Placeholders — see Q-5.*
- A-9 **One visit per chef per date.** A second booking for the same chef and date is a double booking.
- A-10 **Payments:** pure mock "payment step" with a MOCK badge; no Stripe integration in V1 unless Jimmy asks (see Q-9).
- A-11 **Seed accounts** (admin, demo customer, demo chefs) use known demo passwords, documented in the README. Seed data only; no real personal data.
- A-12 Money stored in cents (integer) with `currency = 'CAD'`.
- A-13 **Travel fee** (customer's home only): charged per visit day; distance = straight-line (haversine) from the chef's service-prefix centre to the customer's address-prefix centre (A-1); fee = distance × A-8 rate, one way, whole cents per day. *(WO-4a, from the PR #83 review.)*
- A-14 **Platform fee** = A-8 percentage of **labour only**; never on ingredients (no grocery markup, §6.4) or travel. A free-trial booking has $0 labour, so $0 platform fee.
- A-15 **Receipt mismatch** is flagged when the receipt differs from estimated ingredients by more than the larger of 15% or $5.00 (configurable).
- A-16 **Free-trial claim** (extends §6.6): released when the chef declines, the request expires, the chef does not show up, or the booking is cancelled before the visit; consumed when the booking is completed or the customer does not show up.
- A-17 **Dietary filter:** chefs and dishes carry allergens only, so "dietary needs" in search means allergen exclusion: a chef matches when at least one active dish is free of every selected allergen. Diets such as vegetarian or halal are not supported in V1 (see Q-18).
- A-18 **Search area:** a city search uses the average of that city's prefix centres. For customer's-home results, chefs whose service radius does not reach the search point are left out, unless they offer chef's home (`approved` AND `chef_home_enabled`), in which case they are shown marked "chef's home only".
- A-19 **Bookable dates on the public chef page** are the chef's ticked dates inside the D-15 window. Already-booked dates are removed once bookings exist (WO-4b, T-042).
- A-20 **Incomplete approved chefs** (interim for Q-13): search leaves out an approved chef with no bio, no photo or no active dish.
- A-21 **Dish quantity:** at most 10 of one dish per visit day (`MAX_DISH_QUANTITY`); cook time and ingredient cost scale linearly with quantity. *(T-037 builder placeholder.)*
- A-22 **Cancellation timing detail:** day 1 starts at 00:00 Toronto time; the 48-hour cutoff (A-6) is inclusive; a chef cancellation uses the same timing.
- A-23 **Rounding:** labour, travel and platform fee are each rounded half up to whole cents once per visit day; the total is the sum of the rounded lines.
- A-24 **Allergy matching:** a dish allergen conflicts with the intake when the intake contains its words in order, or when any intake word (ignoring filler such as "allergy", "severe") equals any allergen word; lower case, punctuation stripped, trailing "s" ignored. Over-warning is accepted; a conflict is a warning the customer acknowledges. No synonyms (Q-20). Raw allergen entries capped at 50 before de-duplication.
- A-25 **Search without a location** returns approved chefs ordered by rating, then name; no distance. An absent `locationType` behaves like customer's home (A-18).

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

### Phase 4 — Customer side (WO-4a: T-037 to T-041; WO-4b: T-042 to T-045)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-037 | Domain rules (TDD): estimate, 6-hour limit, booking validation (1–3 days, past date, double booking, service area, chef-home offered), allergy conflict, receipt check, cancellation timing | backend | T-020 | done |
| T-038 | Free-trial rules: eligibility by phone and address hash, hold / consume / release | backend | T-028, T-037 | todo |
| T-039 | Search API: approved chefs only, filters, distance sort | backend | T-030, T-037 | done |
| T-040 | Search and results UI with map | frontend | T-039 | todo |
| T-041 | Chef detail page | frontend | T-039 | todo |
| T-042 | Booking API: create, estimate, accept / decline, cancel, no-show, eat-by, notifications | backend | T-037, T-038 | todo |
| T-043 | Booking flow UI: days and dishes, location, intake form, allergy acknowledgement, grocery option, estimate, 6-hour warning, free-trial label, MOCK payment step | frontend | T-042 | todo |
| T-044 | Grocery option A shopping list and option B receipt upload with mismatch flag (API) | backend | T-042 | todo |
| T-045 | Grocery screens and chef booking dashboard (requests with intake, accept / decline, eat-by) | frontend | T-044 | todo |

### Phase 5 — Engagement (WO-5)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-046 | Messaging backend: Realtime, RLS, contact details hidden until accepted | backend | T-042 | todo |
| T-047 | Chat UI | frontend | T-046 | todo |
| T-048 | Reviews (completed bookings only) and report-a-problem API; admin lists of bookings, reports, free-trial blocks | backend | T-042 | todo |
| T-049 | Reviews, report button, admin lists UI | frontend | T-048 | todo |

### Phase 6 — Hardening (WO-6, deploy has its own WO-7)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-060 | Refuse bidi and zero-width characters in public text (issue #73); client/server agreement test | backend | T-059 | todo |
| T-050 | Playwright end-to-end demo path (§12 steps 1–5) | tester | Phase 5 | todo |
| T-051 | §10 edge-case test sweep and bug list | tester | Phase 5 | todo |
| T-052 | Accessibility pass (axe checks in Playwright) and fixes | frontend | Phase 5 | todo |
| T-053 | Security and privacy review of the whole app | reviewer | T-050, T-051 | todo |
| T-054 | README: setup, mocks list, known limits, demo script; open legal risks | planner | T-053 | todo |
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
- Q-8 Cancellation timing rules (placeholder in A-6), and what happens on a late cancellation.
- Q-9 Stripe test-mode checkout, or a pure mock payment step (A-10)? A pure mock is cheaper to build.
- Q-10 Real eat-by window must be confirmed against Ontario public-health guidance before any real launch.
- Q-11 How long may a `requested` booking hold a chef's date before it expires, and should customers be rate-limited on requests?
- Q-12 Should contact details re-lock some days after a visit is completed?
- Q-13 May an approved chef clear their bio or photo and stay listed in search? (Planner suggests blocking it: an approved profile must stay complete.) Interim: A-20 hides them from search and the public page.
- Q-14 Should replaced ID and food-handler files be deleted from Storage? (Deleting data needs Jimmy's OK; today they stay as orphans.)
- Q-15 ~~Confirm or replace the draft allergen-awareness and kitchen-hygiene acknowledgement wording from T-033.~~ Resolved by D-14 (2026-10-08).
- Q-16 Admin MOCK-check rules (T-035 builder defaults, contract §12 open points 12–13, and T-035 Reviewer findings 1–2; in place until decided): (a) an admin may set a MOCK check back to `not_started` or `pending`, and setting an approved chef's check to `failed` does not change the chef's status; (b) kitchen review is allowed for a chef of any status, so chef's home can be enabled while pending or rejected; (c) the "checks pending" filter ignores the police check; (d) rejecting a chef leaves `chef_home_enabled` on, so a re-approved chef gets chef's home back if the kitchen did not change. Planner suggests: (a) keep, but an approved chef with a `failed` check should be flagged; (b) allow only for pending or approved chefs; (c) keep; (d) turn chef's home off on reject. Search and booking must require `approved` AND `chef_home_enabled` either way (WO-4).
- Q-17 What happens to a booking when the chef clears that date, or when an approved chef is rejected? Planner suggests: a chef cannot clear a date with an active booking (409); rejecting a chef cancels their future `requested` bookings and flags `accepted` ones for the admin. Needed before WO-4b.
- Q-18 Should search support diets beyond allergens (vegetarian, halal, kosher)? That needs new dish data. Until decided, A-17 applies.
- Q-19 The intake form is mandatory (§6.4), but today the allergy and dietary fields may be submitted blank. Must the customer type something explicit such as "none"? Needed before T-043.
- Q-20 Should allergy matching know synonyms and spellings for the 13 picker allergens (gluten vs wheat is the riskiest; also dairy/lactose vs milk, shellfish/shrimp vs crustaceans, nuts vs peanuts, soya, mollusks, sulfites)? Planner suggests a small fixed synonym map. Needed before T-043.
- Q-21 A chef who offers only cooking at their own home, before an admin enables it, is hidden from search, but their public page opens with no booking option. Keep, or return the same 404 as other hidden chefs?

Known limits for the README: cheap SIMs and multiple addresses can evade the free-trial rule; real launch needs ID verification.

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
- Pure functions in `src/lib/domain/` (no I/O), summarised in `docs/domain-rules.md`: `config.ts` (A-6, A-8, A-13 to A-17, A-21 constants, marked ASSUMPTION), `money.ts` and `pricing.ts` (estimate in integer cents: labour, ingredients, travel per day for customer's home, platform fee on labour only and not added to the total; A-23 rounding), `visitLimit.ts` (6-hour warning per day), `bookingValidation.ts` and `bookingIntake.ts` (1–3 distinct days, no past date, D-15 window in Toronto time, availability, double booking, service radius, chef's home only when offered AND approved AND `chef_home_enabled`, active dishes of that chef; errors as codes), `allergy.ts` (A-24), `receipt.ts` (A-15), `cancellation.ts` (A-6, A-22, free-trial effect A-16), `eatBy.ts` (A-7), `distance.ts` (A-1), `dietary.ts` (A-17).
- Also: `allergenList` counts the 14 limit after de-duplication (T-034 backlog); phone validation rejects invalid NANP codes (N11) and postal codes follow Canada Post letter rules (T-028 follow-up). Two seed postal codes changed to valid ones with the same prefixes (`L6P4D4`→`L6P4C4`, `L4K6F6`→`L4K6E6`); test phone helpers fixed (the Tester found one more that failed about 1 run in 100).
- Tests: unit 702 (from 512), RLS 118, API 315 (CI). Only the allergen fix and the allergy rounds were strictly test-first; the Tester added 91 tests including an independent BigInt check of the money maths over 400 random bookings and DST boundaries. Tester PASS. Reviewer: three rounds — round 1 an allergy-safety gap ("nuts" did not warn for "tree nuts") and a 10%/15% doc slip; round 2 extra words still hid a conflict ("Extremely allergic to nuts"); round 3 APPROVE.
- Findings (none blocking): existing hosted rows are not re-checked against the stricter phone and postal rules — an admin kitchen review that sends a now-invalid stored address gets 422, and a stored N11 phone makes `phoneHash` throw (only typed test data could hit this); receipt tolerance rounds half up before a strict compare (at most half a cent); blank intake strings accepted (Q-19); allergy synonyms missing (Q-20).
- Follow-ups: T-038 — a stored phone the new rule rejects must give a clean 409/422, not 500; use `freeTrialEffect` as the single source. T-042 — pass `torontoToday()` as `ctx.today`; `chefBookedDates` must match the `is_active` index; map `CHEF_NOT_BOOKABLE` to 404 and `DOUBLE_BOOKED` to 409; build the intake allergy field from `ALLERGEN_CHOICES` plus free text; no-show and meal-pickup handling.
- Process: status reports from worktrees were lost (team-status writes to the current folder); fixed with `CLAUDE_PROJECT_DIR`, now in `docs/lessons-learned.md` §1.

### T-039 — Search API (done 2026-10-09, PR #85; no migration)
- Contract v1.3 §7: `GET /api/chefs` (location by `postalCode` or `city` — A-18 city centre; filters `cuisine`, `language`, `avoidAllergens` A-17, `minRateCents`/`maxRateCents`, `date` inside the D-15 window, `locationType`; distance sort A-1, then rating, name, id; keyset cursor; out-of-radius chefs left out unless chef's home is bookable, then `chefHomeOnly: true`), `GET /api/chefs/:id` (active dishes, `bookableDates` A-19, `today`, `lastBookableDay`), `GET /api/reference/postal-prefixes` (public, cacheable, cookie-free client).
- Approved only with an explicit `.eq('status','approved')`; A-20 hides incomplete chefs in search and detail; one identical 404 for non-uuid, unknown, pending, rejected and hidden chefs. Named columns, no private fields, anon-capable client only, `no-store` except the reference route. Without a location, order is rating then name (A-25). Reads at most 1000 approved chefs and filters in code (prototype scale).
- Backlog done: `await connection()` in `GET /api/admin/chefs` removes the build-log prerender error (T-036).
- Tests: unit 756, RLS 118, API 348 (CI). Pending and rejected chefs hidden for seven kinds of viewer; header-identical 404s; radius boundary through the DB; cursor tampering; tie paging. Tester PASS, Reviewer APPROVE.
- Findings (none blocking): Q-21 (a chef with only an unenabled chef's home is hidden in search but its page opens with no booking option; Reviewer recommends the same 404); the contract says a chef's postal prefix is never shown, but the service-area centre can be inferred from `distanceKm` over a few searches (area only, never an address; soften the wording at the next contract edit); `locationType=customer_home` still returns `chefHomeOnly` chefs, so T-040 must label them.
- Follow-ups: T-040 — postal-prefixes for the city picker and map pins (area centres only); chef's-home-only label; list is the main view and works without the map; 422 errors next to inputs with focus; mock adapter routes per §7 with cursor paging. T-041 — one "Chef not found" state; handle `locationOptions: []` unless Q-21 changes it; date picker from `today`/`lastBookableDay`; allergens on each dish. T-042 — remove booked dates from the `date` filter and `bookableDates`; re-check approved, `chef_home_enabled` and radius at booking; hidden chef → same 404.

