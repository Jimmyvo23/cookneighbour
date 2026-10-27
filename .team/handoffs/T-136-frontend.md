# Handoff: T-136 "I love to cook" for logged-in users

From: frontend  To: tester

## What changed
- Branch: `feature/T-136-love-to-cook`
- Pull request: #241
- Files: `src/components/home/LoveToCookLink.tsx` (new client component, reads `/api/me` via `apiFetch`), `src/components/home/LoveToCookLink.test.tsx` (new), `src/app/page.tsx` (uses the component; still a Server Component), `docs/work-orders/WO-T136-love-to-cook.md`.
- Behaviour (D-209): signed out `/signup`; chef `/chef/apply`; customer and admin render nothing; loading or error shows the signed-out link. Bounce rule, design, copy, Tab order unchanged.

## How to verify
- `npx vitest run src/components` : 44 files, 644 passed | 3 expected fail (647). Includes 6 new tests (signed out, chef, customer, admin, loading, error).
- `npm run lint` : clean. `next typegen && tsc --noEmit` : exit 0.
- `npx playwright test --config playwright.mock.config.ts e2e-mock/t126-home-mock.spec.ts` : 21 passed.

## Known gaps or risks
- Customer/admin: link is absent until `/api/me` answers, so they see the signed-out link briefly (by design, per WO). Not tested against hosted with a real session.
- Worktree needed a cloned `node_modules` (symlink breaks Turbopack); not committed.
- The dev server printed an "upgrade Next.js / run next upgrade" notice in its output; I did not act on it.
- Impeccable detect not run: no visual change.

## What the next agent needs
- Bite test: change chef href or the customer branch and a unit test should fail.
