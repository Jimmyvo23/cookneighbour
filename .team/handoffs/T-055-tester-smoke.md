# T-055 live smoke test (read-only): https://cookneighbour.vercel.app, 2026-10-23

Verdict: PASS (no blocker). One MED finding on guarded-page status codes, and a few LOW items. Only GET requests were sent. No sign-up, login or POST. `.env.local` not read.

## Checks
1. Pages: `/`, `/search`, `/login`, `/signup`, `/chefs/<id>` all return 200. h1 values: "CookNeighbour — prototype", "Find a home cook", "Log in", "Create your account", "Chef Lan (demo)". "MOCK API" count is 0 on every page. A MOCK label shows on the chef page ("MOCK check. Nothing was inspected for real" for the kitchen review). The login and signup pages show no MOCK label without logging in; the README does not say they should.
   Console: one error on every page, "401 Failed to load resource", caused by the anonymous `GET /api/me` (the app checks the session). No script errors, no failed requests. See LOW-1.
2. Search: `GET /api/chefs?city=Mississauga&cuisine=Vietnamese` returns Chef Lan (demo) and Chef Hoa (demo). In the browser I picked Mississauga and typed Vietnamese, then pressed "Find chefs". It sent `GET /api/chefs?...&locationType=customer_home&limit=20` and showed "Showing 2 chefs". Both profile photos load (supabase storage, naturalWidth 160). The map has 6 OSM tiles, all 200 and naturalWidth > 0 (one page load only). Opening `/search?city=...` straight from the URL does not run the search; the form only searches on submit (info only).
3. Chef detail `/chefs/71fc64d8-...`: 4 or more dishes with photos (all 160 px wide), allergens, "eat by" and costs shown. "Available days" lists Oct 24 to Apr 21 2027 (7 dates in October, 11 in November). A "Book Chef Lan (demo)" link points to `/book`. An unknown id gets "Chef not found" (the page) and 404 `NOT_FOUND` from `/api/chefs/<id>`, and `not-a-uuid` gets the same. I could not test a real pending or rejected chef id, because the public API only lists approved chefs. Jimmy or the DB-side check must confirm that case. See LOW-2.
4. Headers (`/`, `/search`, `/login`, chef page, `/api/chefs`): all of `Content-Security-Policy` (includes `https://krxehqogpsbkpkyjdbzk.supabase.co` in img-src and connect-src, plus wss), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and HSTS are present. No `X-Powered-By` anywhere. `/api/chefs` has `Cache-Control: no-store`. The CSP still allows `script-src 'unsafe-inline'` (known, MED-3 partly fixed in the README).
5. Guarded pages: no `Location` header and no 3xx. See MED-1. `/bookings`, `/chef/apply`, `/chef/bookings`, `/chef/dishes`, `/admin`, `/admin/chefs`, `/bookings/<uuid>` and `/allergies` all return 200 with a "Loading..." shell. The body holds `NEXT_REDIRECT;replace;/login;307`, which the browser follows. No private data is in the HTML (bookings page: title and the redirect marker only). `/chef` alone returns 404 (there is no `/chef` page; only `/chef/*`). `/address` and `/verify-phone` return 200 and show their forms without a redirect (no data in them).
6. API: `GET /api/me`, `/api/bookings` and `/api/admin/chefs` return 401 `{"error":{"code":"UNAUTHENTICATED"}}`. `/api/messages` returns an HTML 404 page (no such route; messages are not a route here).
7. README contradictions: (a) the README (step 7 and the Deploy section) lists "no console errors" on home and search; there is the anonymous 401 console line (LOW-1). (b) The README does not claim a 3xx for guarded pages, but the task brief expected one (MED-1).

## Findings
- MED-1: Guarded pages answer HTTP 200 with the redirect inside the streamed body (`Suspense` around `requireCustomerPage()` in `src/app/bookings/page.tsx`), not a real 307. It is still a server-side guard and no private data leaks. Impact: crawlers, curl and uptime checks see 200 on a private page. `robots: noindex` is set. The Planner decides whether to accept this (prototype) or move the guard before the Suspense.
- LOW-1: Every page logs a console error "401" from `/api/me` for a signed-out visitor. Cosmetic noise; makes the "no console errors" smoke line fail on a strict reading.
- LOW-2: Unknown chef page `/chefs/<unknown>` returns HTTP 200 with the "Chef not found" content, not 404 (client-rendered). The API correctly returns 404. Pending, rejected and unknown ids look the same (checked for unknown ids only).
- LOW-3: Chef Lan shows "4.9 out of 5 (14 reviews)" but the Reviews section says "No reviews yet" and `/api/chefs/<id>/reviews` returns `items: []`. The seeded rating numbers do not match the review rows. A demo reader may notice.
- INFO: `/search?city=...` links do not pre-run the search.

## Left for Jimmy's logged-in steps
- Sign up a new customer with made-up details, log out, log in.
- Seeded customer: booking estimate shows, and MOCK labels for payments and checks show.
- Seeded admin: pending-chef queue and free-trial blocks list open.
- Open a booking, send a chat message (Realtime).
- Confirm a pending or rejected chef id gives the same 404 as an unknown id (needs a real id from the admin queue).
- Supabase Auth URLs, min password 8, and the test pull request that must not build on Vercel (README steps 4 and 5).
