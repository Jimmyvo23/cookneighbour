# Handoff: T-108 Cache Playwright browsers in CI, supabase job 35 minutes

From: backend  To: tester

## What changed
- Branch: `feature/T-108-ci-playwright-cache`
- Pull request: #210
- Files: `.github/workflows/ci.yml` only (README does not describe CI timing).
- `supabase` and `e2e-mock`: read the locked `@playwright/test` version (1.63.0) from package-lock.json, `actions/cache@v4` on `~/.cache/ms-playwright` with key `playwright-<OS>-<version>`. Miss: `npx playwright install --with-deps chromium`. Hit: `npx playwright install-deps chromium`.
- `supabase` `timeout-minutes` 25 -> 35. `checks`, `e2e-mock` stay 25 (e2e-mock ran 13 min; no evidence of need). `ci` gate unchanged.

## How to verify
`gh run view <id> --json jobs` on run 39817506333 (attempt 1 = cache miss for e2e-mock, hit for supabase; attempt 2 = hit for both). Final `ci` passes.

Install step timings (CI):
- Miss, full `install --with-deps` (e2e-mock, attempt 1): 1m18s (fast apt mirror that run).
- Hit, `install-deps` only (supabase, attempt 1): 8m46s (slow apt mirror that run).
- Hit, `install-deps` only (attempt 2): e2e-mock 13s, supabase 12s.

## Known gaps or risks
- The cache saves only the browser download (~170 MB). The slow part is apt (`--with-deps` / `install-deps`), which still runs on a hit and varies from 12 s to 9 min with the mirror. So the cache helps a little; the 35 min limit is what removes the cancellations. Not fixed: apt itself (options: cache .deb files or use the Playwright container image; both bigger changes, not done).
- Cache is written by whichever job finishes first (same key in both jobs); the cache is scoped to branch/base, so PR runs share main's cache only after a main run saves it.

## What the next agent needs
No code or tests changed. Check the YAML and the two runs above.
