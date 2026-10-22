# Handoff: T-100 Security headers and CSP (tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-100-security-headers`, PR #204.
- Added `e2e-mock/t100-tester-csp-mock.spec.ts` (test only): CSP console listener across /, /search, /login, /signup, chef signup to /chef/apply, admin login to the queue; a hostile-page iframe check; headers on API route, 404, static JS asset.
- Merged origin/main into the branch.

## Verdict: PASS (no blocking bugs; 2 notes)
Checked against a production build (`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co npm run build` + `next start`):
- Headers present on /, /search, /login, /admin, /chef/dishes, /api/me (401), /api/nonexistent (404), /nope (404), /favicon.ico and /_next/static JS. No X-Powered-By.
- Production CSP has no `'unsafe-eval'` and no 127.0.0.1 sources; connect-src has https+wss for the Supabase host.
- NEXT_PUBLIC_SUPABASE_URL missing or malformed: CSP fails closed (connect-src 'self', no Supabase in img-src). Nothing breaks silently because the app itself throws without that variable.
- OSM: the map uses one host, `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`ChefMap.tsx:12`), no a/b/c subdomains; allowed by img-src.
- Admin documents: images are `<img src=signedUrl>` (Supabase origin, in img-src). PDFs and receipts are plain `<a target="_blank">` links, a top-level navigation, so the app CSP (object-src none, no frame-src) does not apply to them. No iframe/object/embed/createObjectURL in src. Not tested against real Supabase (no Docker).
- Realtime wss allowed by connect-src (real-stack chat verified only in CI).
- Lint, prettier, vitest (3043 pass, 3 expected fail), full mock e2e (320 pass plus my 3) all green.

## Notes (not bugs)
- LOW: `script-src 'unsafe-inline'` means CSP does not stop injected scripts (builder choice, documented). MED-3 is only partly closed against XSS; clickjacking, exfiltration, base/form/object are closed.
- LOW: headers() is evaluated at build time, so a Vercel deploy needs NEXT_PUBLIC_SUPABASE_URL set at build (it must be anyway). Mock e2e runs the dev server, so it does not test production script-src; the production check above was manual curl.
- The framing test has no positive control (it asserts the app form never appears in the iframe).

## What the next agent needs
Reviewer: confirm the unsafe-inline decision with Jimmy.
