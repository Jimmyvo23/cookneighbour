# Handoff: T-029 Auth UI

From: frontend  To: tester

## What changed
- Branch: `feature/T-029-auth-ui`
- Pull request: see PR for branch `feature/T-029-auth-ui` (Closes #17)
- Files: `src/lib/api/client.ts` (fetch helper), `src/lib/api/mocks/mock-adapter.ts` (MOCK), `src/lib/validation/auth.ts`, `src/components/{MockBadge,forms,AuthForms,AccountBar}.tsx`, pages `src/app/{signup,login,verify-phone,address}/page.tsx`, `src/app/layout.tsx` (AccountBar), `.env.example`, tests `src/lib/api/client.test.ts`, `src/lib/validation/auth.test.ts`, `e2e/auth.spec.ts`.

## How to verify
`npm ci && npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run build && npm run test:e2e`. All pass locally (21 unit tests, 3 e2e).
Manual: `npm run dev`, open /signup. Flow: sign-up (customer or chef) -> /verify-phone (MOCK badge, any 6 digits) -> /address -> home shows "Signed in as ..." and Log out.
Mock magic inputs: email `taken@example.com` (409 EMAIL_IN_USE), `limited@example.com` (429, retry 2 minutes, sign-up and login), password `wrongpass` on login (401), phone ending 0000 (409 PHONE_IN_USE), postal code not starting with M or L (422 "Not a GTA postal code.").

## Known gaps or risks
- The whole API is MOCK until T-028. Mock state lives in sessionStorage (per tab), no real accounts.
- Mock GTA check is only "starts with M or L"; the real check is the server's `postal_prefixes`.
- Login redirects to `/` regardless of phone/address status; no route guards yet (needs real session; later task).
- `signedIn: false` sign-up shows a "check your email" page (contract assumption), untested in e2e.
- Mock is default-on only when NODE_ENV is not production and NEXT_PUBLIC_API_MOCK is unset.

## What the next agent needs
Switch off the mock: set `NEXT_PUBLIC_API_MOCK=0` (in `.env.local`, or in the build env; it is inlined at build time) once T-028 routes exist, then run the same e2e against real routes (e2e currently relies on mock magic inputs and needs adapting). Errors: field errors show on fields via aria-describedby and focus moves to the first invalid field or to `#form-alert`; 429 shows the retry time. Helper always sends `Content-Type: application/json`.
