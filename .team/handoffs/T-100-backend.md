# Handoff: T-100 Security headers and CSP (T-053 MED-3)

From: backend  To: tester

## What changed
- Branch: `feature/T-100-security-headers`
- Pull request: see PR "T-100: Security headers and CSP"
- Files: `src/lib/security-headers.ts` (+ `.test.ts`), `next.config.ts` (`headers()` for `/:path*`, `poweredByHeader: false`), `e2e-mock/t100-security-headers-mock.spec.ts`, `e2e/home.spec.ts` (header test), this handoff.

## Policy (why each source)
- `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'` (+ `X-Frame-Options: DENY`) against clickjacking.
- `connect-src 'self'` + Supabase https origin + wss (same host) from `NEXT_PUBLIC_SUPABASE_URL`: API calls and Realtime chat. In non-production, also `http://127.0.0.1:54321` and `ws://127.0.0.1:54321` (local stack, CI).
- `img-src 'self' data: blob: https://tile.openstreetmap.org` + Supabase origin: Leaflet tiles, signed Storage photos (same Supabase origin), data/blob previews.
- `font-src 'self' data:`: next/font/google is self-hosted at build.
- `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` only when NODE_ENV is not production, for React refresh). `style-src 'self' 'unsafe-inline'`.
- Also: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

## How to verify
- `npx vitest run src/lib/security-headers.test.ts`
- `npx playwright test -c playwright.mock.config.ts t100-security` (headers, search map with tiles, no CSP console error)
- Real stack (CI): `e2e/home.spec.ts` header test, plus existing booking-real chat live step proves Realtime is not blocked.
- Local results: lint, typecheck, prettier, vitest (3010 pass), mock e2e (full suite passed; 1 allergy test flaked under load and passed on rerun; the t040 host test hardcodes port 3101 so it only fails if you change the port).

## Known gaps or risks
- Builder choice, unconfirmed by Jimmy: `'unsafe-inline'` for scripts. Next.js writes inline RSC payload scripts and the app uses cacheComponents; a nonce via `src/proxy.ts` would force every page dynamic. So script injection is not blocked by CSP; framing, exfiltration, plugins, base tag and form targets are. A nonce/hash setup is a possible follow-up.
- Production Supabase URL must be set at build/start time (`NEXT_PUBLIC_SUPABASE_URL`) or connect-src lacks it.
- Real-stack chat/map under CSP only verified in CI (no Docker locally).

## What the next agent needs
- Look in the browser console for "Content Security Policy" messages on pages not covered by tests (admin documents signed-URL images, receipts, kitchen photos use the same Supabase origin).
