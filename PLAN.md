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
| T-032 | Dishes and availability API | backend | T-025 | todo |
| T-033 | Chef onboarding and profile UI | frontend | T-031 | todo |
| T-034 | Dish menu and availability calendar UI | frontend | T-032 | todo |
| T-035 | Admin chef-queue API: approve / reject with reason, kitchen review, police status | backend | T-031 | todo |
| T-036 | Admin chef-queue UI | frontend | T-035 | todo |
| T-058 | Lessons-learned file for all agents (`docs/lessons-learned.md`) | planner | — | in_review |

### Phase 4 — Customer side (WO-4, may split into two)
| ID | Task | Owner | Depends on | State |
|---|---|---|---|---|
| T-037 | Domain rules (TDD): estimate, 6-hour limit, booking validation (1–3 days, past date, double booking, service area, chef-home offered), allergy conflict, receipt check, cancellation timing | backend | T-020 | todo |
| T-038 | Free-trial rules: eligibility by phone and address hash, hold / consume / release | backend | T-028, T-037 | todo |
| T-039 | Search API: approved chefs only, filters, distance sort | backend | T-030, T-037 | todo |
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
- Q-13 May an approved chef clear their bio or photo and stay listed in search? (Planner suggests blocking it: an approved profile must stay complete.)
- Q-14 Should replaced ID and food-handler files be deleted from Storage? (Deleting data needs Jimmy's OK; today they stay as orphans.)

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

### T-031 — Chef onboarding API (done 2026-10-08, PR #67; migration applied to hosted 2026-10-08)
- Routes: GET/PATCH `/api/chef/application`, POST/DELETE `/api/chef/application/documents`, POST `/api/chef/application/submit`. Identity from `getUser()`, role from `profiles` (JWT `user_metadata.role` ignored, tested). Service-role client only after the role check; GET repairs missing chef rows (display name copied from `profiles`, never from the email).
- Every client storage path goes through `checkStoragePath` (own folder, no `..`/`/`/backslash/control chars, lower-case `<prefix>-<uuid>.<ext>`) and an object-exists probe. N1 reset in routes: registering a new ID or food-handler file moves its check (including `failed`) back to `pending`; a kitchen-address change or photo removal resets the kitchen check and turns chef's home off. All check statuses commented MOCK; submit returns `mock: true`.
- `chef_private` writes are conditional on `updated_at` (retry, 409 after 12 losses); rejected → pending on submit is conditional on `status = 'rejected'`.
- Migration `20261008150000_kitchen_photos_insert_only.sql` (Planner-decided fix for tester F3): kitchen-photo and document buckets are insert-only for the chef. Applied with `npx supabase db push`.
- Tests: 165 unit, 111 RLS, 207 API, Playwright real-route 7 + mock 6. Tester PASS (round 2), Reviewer APPROVE.
- Reviewer follow-ups:
  - R1 (backlog): a kitchen photo deleted in parallel can be re-registered after a race (`src/lib/server/chef-application.ts:472-495`); fails safe (check pending, chef's-home off). Fix: re-probe Storage when the path was skipped as already registered.
  - R2 (T-035): submit completeness reads `chefs`/`dishes` without a lock. Admin approve must recompute completeness server-side in the same conditional write and refuse if anything is missing.
  - R3: done (db push above).
  - R4 (info): `20261007221003_storage_buckets.sql:5` comment is stale; already applied, do not edit.
  - R5 carry-forwards: T-033 — MOCK badge on every check status; uploads use fresh lower-case uuid names with `upsert: false`. T-035 — admin verdict writes stay conditional on the reviewed paths and bump `chef_private.updated_at`. T-054 README known limits — orphan uploads the chef never registered can no longer be deleted by the chef.

