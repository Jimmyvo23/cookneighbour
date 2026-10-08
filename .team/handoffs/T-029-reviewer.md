# Handoff: T-029 review — changes requested

From: reviewer (written by planner)  To: frontend

Review: https://github.com/Jimmyvo23/cookneighbour/pull/60#issuecomment-6049931804

## Blocking
1. False privacy claim in `src/components/AuthForms.tsx` (PhoneVerifyForm): "is never shown to chefs". Per CLAUDE.md §6.8 the phone is shared after a booking is accepted. Use: "Chefs see it only after they accept your booking."
2. Focus lost after a server error on client navigation (WCAG 2.4.3). `cacheComponents` keeps hidden previous pages mounted; `useApiForm` uses document-wide `querySelector('[aria-invalid="true"]')` and `getElementById("form-alert")`. Scope lookups to the submitted form (form ref / `e.currentTarget`) and give the alert a unique id via `useId`. Add a Playwright regression: /signup empty submit → Log in link → wrong password → focus lands on the form alert or first invalid field.

## Planner additions (same PR)
3. MOCK honesty (CLAUDE.md §3, §11): when `isMockEnabled()` is true, show a visible "MOCK API" badge (e.g. in AccountBar) on every page.
4. Move the adapter to `src/lib/mocks/` (PLAN.md Rec-4).
5. Mock sessionStorage: store only a masked phone.
6. Logout: if the request fails, show an error and stay signed in; on success navigate to `/`.

## Follow-ups for T-028 integration (not now)
`.env.example` `NEXT_PUBLIC_API_MOCK` → 0/blank; dynamic import of the mock; route guards; `signedIn:false` path test; e2e against real routes.
