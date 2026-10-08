# Handoff: T-029 Auth UI (test report)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-029-auth-ui` (commit 4f53adc). Pull request: #60. No code changed by Tester; throwaway test files lived only in a scratch clone.
- Verdict: **PASS** (no blocking bugs; 4 non-blocking notes below).

## How to verify (what I ran, fresh clone of the branch)
- `ci` on #60: pass.
- npm ci, lint, `npm run typecheck`, prettier --check, `npm test` (4 files, 21 tests), `npm run build`, `npm run test:e2e` (3 tests): all pass.
- Contract conformance (docs/api-contract.md): POST /api/auth/signup, POST /api/auth/login, POST /api/auth/logout, GET /api/me, POST /api/me/phone, POST /api/me/phone/verify, PUT /api/me/address. Methods, paths and body keys (`email,password,role,displayName`; `phone`; `code`; `line,city,postalCode`) match. Request/response types are imported from `@/lib/api/types` (none redefined; mock uses `satisfies`). Error shape (`error.code/message/fields/retryAfterSeconds`) parsed, with Retry-After header fallback. Real requests captured in a production build: every call, including body-less GET /api/me and logout (unit test), sends `Content-Type: application/json`.
- MOCK: verify page shows badge text "MOCK — no real SMS is sent; any 6-digit code works in demo mode" (also in the MockBadge `data-testid`). `mock-adapter.ts` header says "MOCK ADAPTER ... Nothing here is real". Production builds, measured with `next start` and request capture: env unset -> real POST /api/auth/signup sent, no mock; `NEXT_PUBLIC_API_MOCK=0` -> same; `=1` -> mock used, no network call. (The mock code is still bundled in the client JS but inert when off.)
- Accessibility (axe-core/playwright, WCAG 2 A/AA + 2.1, at 375px): zero violations on /signup, /login, /verify-phone, /address and on error states (signup empty submit, login wrong password, phone invalid and 409, address non-GTA and malformed). Errors have `aria-describedby` pointing to the error text, `aria-invalid`, focus moves to the first invalid field or `#form-alert`. Keyboard-only sign-up completes: Tab order radio group > name > email > password > Sign up, Enter submits, then continued by keyboard through phone, code and address to home and Log out.
- Mobile 375px: no horizontal scroll on /signup (also with errors), /login, /verify-phone, /address.
- Privacy: address page says it is private, used only for the free-trial rule and bookings, and a chef sees it only after accepting. Browser console during the full flow contained only React DevTools/HMR dev messages, no form values (password, email, phone, address). `grep console.` in src (non-test): none.
- Edge cases: malformed phone ("abc") -> field error; phone ending 0000 -> "That phone number can't be used." (409 PHONE_IN_USE, does not reveal the owner); wrong 6-digit code length -> "Enter exactly 6 digits."; postal V6B1A1 -> "Not a GTA postal code."; postal "zzz" -> "Enter a postal code like L5B 1M2."; lowercase "l5b1m2" accepted; 409 EMAIL_IN_USE -> "That email already has an account."; 429 -> "Too many attempts. Try again in 2 minutes."; wrong password -> "Email or password is incorrect."; malformed email -> field error with aria-describedby.

## Known gaps or risks (non-blocking)
1. After client-side navigation the previous page stays mounted but hidden (Next 16 behaviour), so duplicate `id="form-alert"` exists in the DOM (hidden copy). axe did not flag it, but a global `#form-alert` selector can match twice (my selector needed `main:visible`). Frontend could use `useId` for the alert id. Low priority.
2. Everything is mock-driven today (as the builder states). The e2e specs rely on mock magic inputs and will need adapting when the mock is switched off after T-028. Real-route integration (cookies, RLS-backed `/api/me`) is untested here.
3. Mock GTA check is only "starts with M or L"; the real check is the server's `postal_prefixes`. No route guards yet (builder lists this).
4. `signedIn:false` ("check your email") path is untested in e2e. Not exercised by me either.
5. Mock code is shipped in the production client bundle even though disabled. Acceptable for a prototype; Reviewer may want it tree-shaken or dynamically imported.

## What the next agent needs
- Scratch spec files (not in the PR) are in the Tester scratch clone only. Nothing to merge.
- Reviewer: focus on item 1 and 5, and confirm `.env.example` documents `NEXT_PUBLIC_API_MOCK`.
