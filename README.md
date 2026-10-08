# CookNeighbour

Prototype marketplace to hire a home cook for 1 to 3 days. Payments, identity checks and SMS are MOCKED. See `CLAUDE.md` for the full spec.

## Prerequisites

- Node.js 24 (LTS) with npm
- Git

## Install

```bash
npm install
npx playwright install chromium   # one time, for end-to-end tests
cp .env.example .env.local        # placeholders only; never commit .env.local
```

## Scripts

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Start the dev server at http://localhost:3000                  |
| `npm run build`     | Production build                                               |
| `npm run lint`      | ESLint                                                         |
| `npm run typecheck` | TypeScript check                                               |
| `npm test`          | Vitest unit tests                                              |
| `npm run test:e2e`  | Playwright smoke test (Chromium; starts the app itself)        |
| `npm run db:check`  | Checks the hosted Supabase project is reachable (OK/FAIL only) |
| `npm run db:seed`   | Demo data (needs `--local` or `--hosted`, see Demo data below) |
| `npm run format`    | Prettier                                                       |

## Supabase setup

1. Create a free project at https://supabase.com (hosted). Do not paste keys into chat, issues or commits.
2. In the dashboard open Project Settings > API Keys. Copy the project URL, the **publishable** key (`sb_publishable_...`) and the **secret** key (`sb_secret_...`).
3. Put them in `.env.local` (git-ignored):
   - `NEXT_PUBLIC_SUPABASE_URL` = project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the publishable key
   - `SUPABASE_SECRET_KEY` = the secret key (server only, bypasses row-level security)
4. Run `npm run db:check`. It prints only OK or FAIL lines, never key values.

Code lives in `src/lib/supabase/`: `client.ts` (browser), `server.ts` (server, cookie session) and `admin.ts` (server-only secret key; the `server-only` package makes the build fail if it is imported into browser code).
With `cacheComponents` on, `server.ts` reads `cookies()`, so call it per request from inside a `<Suspense>` boundary, a Route Handler or a Server Function; never at module level or in a `"use cache"` function.

Local Supabase (`supabase/config.toml`) needs Docker and runs only in CI (T-022). Tables and migrations arrive in a later task.

## Demo data (T-030)

All seed data is **fictional**: invented names, `@example.com` emails, 555-01xx phone numbers and made-up street addresses. ID, food-handler, police and kitchen statuses on chefs are **MOCK** values; nobody verified anything. Seeded chefs have no photos or uploaded documents.

- `supabase/seed.sql` loads about 60 GTA postal-code prefixes (Mississauga L4T to L5W, Toronto, Brampton, Oakville, Markham, Vaughan, Richmond Hill). Coordinates are **approximate** area centres, only used for straight-line distance. It runs automatically on `supabase start` and `supabase db reset`.
- `scripts/seed.ts` creates the accounts, 12 chefs, dishes and 3 weeks of availability. It is server-only (secret key), idempotent, and refuses to run unless you pass a target: `npm run db:seed -- --local` (running local stack) or `npm run db:seed -- --hosted` (needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `HASH_PEPPER` and `SEED_ADMIN_PASSWORD` in `.env.local`). Add `--verify` to check the result without writing.
- The **admin** password is never in this repo. Set `SEED_ADMIN_PASSWORD` in `.env.local` (or the shell) before seeding; without it the admin account is skipped. Admin login: `admin@example.com`.

Demo logins (local and demo use only):

| Role     | Email                                                                                                                                                                                                                                                                                     | Password            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Customer | `customer1@example.com`, `customer2@example.com`, `customer3@example.com`                                                                                                                                                                                                                 | `DemoCustomer!2026` |
| Chef     | `chef.lan@example.com` (Vietnamese, Mississauga, both locations), `chef.hoa@`, `chef.maria@`, `chef.harpreet@`, `chef.giulia@`, `chef.devon@`, `chef.minjun@`, `chef.layla@` (approved); `chef.wei@`, `chef.selam@`, `chef.ana@` (pending); `chef.carlos@` (rejected), all `@example.com` | `DemoChef!2026`     |

Pending and rejected chefs exist so you can show they never appear in search.

More setup (demo script) arrives in later tasks.
