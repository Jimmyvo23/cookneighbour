# Work Order WO-2: Phase 2b Foundation — data and sign-up

Tasks: T-056 (new), T-025, T-026, T-027, T-028, T-029, T-030
Plan summaries drafted by the Planner on each agent's behalf (starting subagents only to write summaries would itself need approval).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-056 Env rename + CI hardening (Issue #50) | Rename env vars to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in code, `.env.example`, README (Planner renames the two names in Jimmy's `.env.local` in the same step; values untouched). Fix the two T-021 review notes (`env.ts` comment, `env.test.ts` assertion). CI: add `npm run build`, pin Supabase CLI to the repo version, `checkout@v5` / `setup-node@v5`. | S | `db:check` breaks if the rename and `.env.local` drift; done together |
| backend | T-025 Schema + RLS | Migrations in `supabase/migrations/` for every table in PLAN.md §3 (profiles, chefs, dishes, availability, bookings, booking days and dishes, intake forms, receipts, messages, notifications, reviews, reports, free-trial claims, postal prefixes). Enums for statuses; money in cents; `country`, `currency`, `language` columns. RLS on every table: owners see their own rows, approved chefs public, addresses and phone hashes never public, admin via role. Storage buckets per §3. Apply to the hosted project after Jimmy links the CLI (one-time step). | L | RLS mistakes leak data; caught by T-027 tests |
| backend | T-030 Seed data | `supabase/seed.sql` for GTA postal prefixes and cuisines; `scripts/seed.ts` (secret key, server-only) creates demo users and ~10 chefs incl. a Vietnamese chef in Mississauga, some pending/rejected, dishes, availability, demo customers, admin. Demo customer/chef passwords documented in README; admin password read from `SEED_ADMIN_PASSWORD` in `.env.local` (repo is public). Idempotent (safe to re-run). Fake names, fake addresses. | M | Re-running duplicates data; script upserts by fixed ids |
| backend | T-026 API contract v1 | `docs/api-contract.md`: routes for sign-up, phone verify (MOCK), profile, address, chef application, admin queue, plus request/response shapes, error codes and which role may call each. Later phases extend it. Published before Frontend starts T-029. | S | Contract drift; Frontend codes against it, Tester checks it |
| backend | T-028 Auth backend | Supabase email + password sign-up as customer or chef (chef starts `pending`), seeded admin. `src/lib/domain/phone.ts` and `address.ts` (TDD): Canadian E.164 normalize, address normalize (PLAN.md A-2/A-3), SHA-256 with server-only `HASH_PEPPER`. MOCK SMS verify (any 6 digits, labelled MOCK). Session-refresh proxy that forwards `setAll` headers (T-021 note). | M | Pepper leak; server-only module, never logged |
| frontend | T-029 Auth UI | Pages: sign up (role choice), log in, phone verify with a visible MOCK badge, home address. Mobile-first, accessible labels and errors. Built against `docs/api-contract.md`; mocked until the routes exist. Playwright test for sign-up → verify → address. | M | Contract changes; starts only after T-026 merges |
| tester | T-027 RLS harness + verify WO-2 tasks | Vitest suite run against local Supabase in CI: two customers, two chefs, admin; proves no access to others' bookings, messages, addresses, phone hashes; pending/rejected chefs not public. Adds an `rls` step to CI. Verifies each WO-2 PR on a fresh clone. | M | Tests pass for the wrong reason; each test also checks the allowed case |
| reviewer | Review WO-2 PRs | Security and privacy focus: RLS on every table, no secret in browser code, hashes peppered, MOCK labels, no real personal data in seed, contract matches code, plan compliance. Review notes on each PR. | M | None notable |

Order: T-056 → T-025 → (T-030, T-026, T-027 in parallel) → T-028 → T-029. One branch and PR per task.

Manual steps for Jimmy (the Planner walks you through each when it comes up):
1. T-025: run `npx supabase login` and `npx supabase link --project-ref <your project id>` once (needs your database password). This lets migrations reach the hosted database.
2. T-028: add `HASH_PEPPER` to `.env.local` (one command, given at the time).
3. T-030: add `SEED_ADMIN_PASSWORD` to `.env.local`.

## Recommendation
Approve all. Planner decisions made under Jimmy's "do what you think is best" (2026-10-07): rename the key variables (D-8); fold Issue #50 into T-056 so CI also builds before migrations land. Issue #46 stays open: `eslint-config-next` 16.4.0 is already the latest, so there is no fix to take yet.

## Left out
Chef profile, dishes UI, admin UI (WO-3). Search, booking, pricing, free-trial rules (WO-4). Messaging, reviews (WO-5). No Vercel deploy (WO-7). No real SMS, no Stripe. Issue #46.

## Decision
Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each answer with `team-status decide` (ids `WO-2-backend`, `WO-2-frontend`, `WO-2-tester`, `WO-2-reviewer`).
