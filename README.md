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
| `npm run format`    | Prettier                                                       |

## Supabase setup

1. Create a free project at https://supabase.com (hosted). Do not paste keys into chat, issues or commits.
2. In the dashboard open Project Settings > API Keys. Copy the project URL, the **publishable** key (`sb_publishable_...`) and the **secret** key (`sb_secret_...`).
3. Put them in `.env.local` (git-ignored). Variable names are kept from the older naming:
   - `NEXT_PUBLIC_SUPABASE_URL` = project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the publishable key
   - `SUPABASE_SECRET_KEY` = the secret key (server only, bypasses row-level security)
4. Run `npm run db:check`. It prints only OK or FAIL lines, never key values.

Code lives in `src/lib/supabase/`: `client.ts` (browser), `server.ts` (server, cookie session) and `admin.ts` (server-only secret key; the `server-only` package makes the build fail if it is imported into browser code).
With `cacheComponents` on, `server.ts` reads `cookies()`, so call it per request from inside a `<Suspense>` boundary, a Route Handler or a Server Function; never at module level or in a `"use cache"` function.

Local Supabase (`supabase/config.toml`) needs Docker and runs only in CI (T-022). Tables and migrations arrive in a later task.

More setup (demo script) arrives in later tasks.
