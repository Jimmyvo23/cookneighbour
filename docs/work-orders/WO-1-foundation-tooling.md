# Work Order WO-1: Phase 2a Foundation — tooling

Tasks: T-020, T-021, T-022, T-023, T-024
Plan summaries drafted by the Planner on each agent's behalf (starting subagents only to write summaries would itself need approval).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-020 App scaffold | Run create-next-app (TypeScript, Tailwind, App Router, ESLint, `src/`) in a temp folder and copy it in, so CLAUDE.md and `.team/` are untouched. Add Prettier, Vitest with one sample test, Playwright (Chromium only) with a home-page smoke test, scripts `lint`, `typecheck`, `test`, `test:e2e`, `format`. Placeholder home page "CookNeighbour — prototype". `.env.example`, README setup stub. Confirm `npm run dev` serves the page (finishes the environment check). | M | Scaffolding into a non-empty folder; mitigated by temp-folder copy |
| backend | T-021 Supabase setup | Jimmy creates a free Supabase project (Canada region) and pastes URL, anon key and service-role key into `.env.local` (never committed). Backend runs `npx supabase init` (`supabase/config.toml`), installs `@supabase/supabase-js` and `@supabase/ssr`, adds `src/lib/supabase/client.ts` and `server.ts` (service-role key server-only), a `db:check` connection script, and lists the variables in `.env.example`. No tables yet (that is WO-2). | S | Key leakage; `.env*` already git-ignored, service key never imported in browser code |
| backend | T-022 CI workflow | `.github/workflows/ci.yml`, one job named `ci`, on every PR and on push to `main`: Node 24 with npm cache, `npm ci`, lint, type check, unit tests, `supabase/setup-cli` + `supabase start` (throwaway local database on the runner, unused services excluded), Playwright Chromium smoke test. Needs no GitHub secrets (local Supabase keys are public defaults). | M | Local Supabase adds ~2–3 min per run; acceptable on free minutes for a public repo |
| planner | T-023 Templates and Issues | Add `.github/ISSUE_TEMPLATE/task.yml` and `bug.yml`, `.github/pull_request_template.md` (Issue link, what changed, tests run, MOCK-label check, no-secrets check). Create labels `owner:backend/frontend/tester/reviewer/planner` and `phase:2a … phase:6`. Mirror T-020–T-055 as Issues with matching IDs. Explain Issues, labels and templates briefly. | S | Issue noise; labels keep the board filterable |
| planner | T-024 Branch protection | After T-022 is merged and `ci` has run once: `gh api` PUT on `main` protection — require the `ci` check (branch must be up to date), no required reviews, apply to admins too, block force-push and deletion. Explain what branch protection is and why. No PR (settings change). | S | Admins can't merge a red PR either; intended, can be loosened later |
| tester | Verify T-020–T-022 | Clone the branch fresh, run `npm ci`, every script, and the smoke test; confirm CI goes red on a deliberately failing test (on a throwaway branch, then deleted) and green otherwise; confirm `.env.example` has no real values. Writes `.team/handoffs/T-0NN-tester.md`. | S | None notable |
| reviewer | Review PRs for T-020–T-023 | Check config quality, no secrets, service-role key server-only, CI runs on PRs, templates include MOCK and secret checks, plan compliance. Writes review notes on each PR. | S | None notable |

Order: T-023 and T-020 in parallel → T-021 → T-022 → T-024. One branch and PR per task (`feature/T-020-app-scaffold`, `feature/T-021-supabase-setup`, `feature/T-022-ci`, `feature/T-023-github-templates`).

Manual step for Jimmy (T-021): sign up at supabase.com (free), create one project, copy three values into `.env.local`. The Planner will walk you through it when T-021 starts.

## Recommendation
Approve all. This is tooling only; it unlocks every later phase and costs little. The CI-local Supabase is what lets RLS tests run safely in WO-2.

## Left out
No database tables, auth, seed data or app pages (WO-2). No Vercel (WO-7). No required PR reviews (D-6). No Stripe.

## Decision
Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each answer with `team-status decide` (ids `WO-1-frontend`, `WO-1-backend`, `WO-1-planner`, `WO-1-tester`, `WO-1-reviewer`).
