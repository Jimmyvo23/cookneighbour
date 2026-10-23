# Handoff: T-114 Patch Next.js to 16.4.2

From: backend  To: tester

## What changed
- Branch: `feature/T-114-next-16-4-2`
- Pull request: see PR titled "T-114: Patch Next.js to 16.4.2 (security advisories)"
- Files: `package.json` (next and eslint-config-next 16.4.0 -> 16.4.2, exact pins), `package-lock.json` (next, @next/*, eslint-config-next only; no unrelated upgrades).
- No code changes, no migration, ci.yml untouched.

## How to verify
- `npm audit --omit=dev`: before 1 critical (next, 3 advisories GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r); after 0 vulnerabilities.
- `npm run lint`, `npx prettier --check .` clean; `npx vitest run` 147 files, 3199 passed, 3 expected fail.
- `npx tsc --noEmit`: same 15 PageProps/LayoutProps typegen lines as main (pre-existing, identical before/after).
- `npx next build` succeeds on 16.4.2, no advisory notice.

## Known gaps or risks
Exposure: no `next/image` (plain img with eslint-disable), no `dangerouslyAllowSVG`, no `images` config, no `"use cache"` directive and no "use server" Server Actions in src. `cacheComponents: true` is on. App was likely not exposed to the three issues; patched anyway. Nothing deployed.

## What the next agent needs
Check CI (`ci` gate) incl. e2e on 16.4.2.
