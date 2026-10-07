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

| Script              | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Start the dev server at http://localhost:3000           |
| `npm run build`     | Production build                                        |
| `npm run lint`      | ESLint                                                  |
| `npm run typecheck` | TypeScript check                                        |
| `npm test`          | Vitest unit tests                                       |
| `npm run test:e2e`  | Playwright smoke test (Chromium; starts the app itself) |
| `npm run format`    | Prettier                                                |

More setup (Supabase, demo script) arrives in later tasks.
