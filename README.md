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

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Start the dev server at http://localhost:3000                  |
| `npm run build`     | Production build                                               |
| `npm run lint`      | ESLint                                                         |
| `npm run typecheck` | TypeScript check                                               |
| `npm test`          | Vitest unit tests                                              |
| `npm run test:e2e`  | Playwright smoke test (Chromium; starts the app itself)        |
| `npm run db:check`  | Checks the hosted Supabase project is reachable (OK/FAIL only) |
| `npm run test:rls`  | RLS tests (needs local Supabase, see `tests/rls/README.md`)    |
| `npm run test:api`  | API route tests (same local Supabase env as `test:rls`)        |
| `npm run db:seed`   | Demo data (needs `--local` or `--hosted`, see Demo data below) |
| `npm run format`    | Prettier                                                       |

## Supabase setup

1. Create a free project at https://supabase.com (hosted). Do not paste keys into chat, issues or commits.
2. In the dashboard open Project Settings > API Keys. Copy the project URL, the **publishable** key (`sb_publishable_...`) and the **secret** key (`sb_secret_...`).
3. Put them in `.env.local` (git-ignored):
   - `NEXT_PUBLIC_SUPABASE_URL` = project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the publishable key
   - `SUPABASE_SECRET_KEY` = the secret key (server only, bypasses row-level security)
4. Run `npm run db:check`. It prints only OK or FAIL lines, never key values.

Code lives in `src/lib/supabase/`: `client.ts` (browser), `server.ts` (server, cookie session) and `admin.ts` (server-only secret key; the `server-only` package makes the build fail if it is imported into browser code).
With `cacheComponents` on, `server.ts` reads `cookies()`, so call it per request from inside a `<Suspense>` boundary, a Route Handler or a Server Function; never at module level or in a `"use cache"` function.

Local Supabase (`supabase/config.toml`) needs Docker. On a machine without Docker the RLS, API and real-stack end-to-end tests run only in CI. The schema lives in `supabase/migrations/`; after a merged migration, `npx supabase db push --linked` brings the hosted project up to date (ask the project owner first).

### Security headers (T-100)

`next.config.ts` sends the headers built in `src/lib/security-headers.ts`: a Content-Security-Policy with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a `Permissions-Policy` and a referrer policy, and turns off the `X-Powered-By` header. The Supabase host in `connect-src` (https and wss) comes from `NEXT_PUBLIC_SUPABASE_URL` **at build time**, so set it before `next build` (on Vercel, in the project's environment variables). To allow another host (for example `vercel.live` for Vercel preview comments), add it in `src/lib/security-headers.ts`. Inline scripts are still allowed (`script-src 'unsafe-inline'`, no nonce), so the CSP blocks framing but not an injected inline script.

## Demo data (T-030)

All seed data is **fictional**: invented names, `@example.com` emails, 555-01xx phone numbers and made-up street addresses. ID, food-handler, police and kitchen statuses on chefs are **MOCK** values; nobody verified anything. Seeded chefs have no photos or uploaded documents.

- `supabase/seed.sql` loads about 60 GTA postal-code prefixes (Mississauga L4T to L5W, Toronto, Brampton, Oakville, Markham, Vaughan, Richmond Hill). Coordinates are **approximate** area centres, only used for straight-line distance. It runs automatically on `supabase start` and `supabase db reset`.
- `scripts/seed.ts` creates the accounts, 12 chefs, dishes and 3 weeks of availability. It is server-only (secret key), idempotent, and refuses to run unless you pass a target: `npm run db:seed -- --local` (running local stack) or `npm run db:seed -- --hosted` (needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `HASH_PEPPER` (at least 32 characters, the same value as the app), `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD` in `.env.local`; `SEED_ADMIN_PASSWORD` is optional). Add `--verify` to check the result without writing.
- The **admin** password is never in this repo. Set `SEED_ADMIN_PASSWORD` in `.env.local` (or the shell) before seeding; without it the admin account is skipped. Admin login: `admin@example.com`.
- **Demo chef and customer passwords.** The local logins are unchanged (the demo passwords in `scripts/seed-data.ts` are used for `--local` only, on a throwaway local stack). Those passwords are public because the repo is public, so `--hosted` never uses them: it refuses to run unless `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD` are set (each at least 12 characters and different from the repo defaults). The script never prints password values.

Demo logins (local only; hosted uses your `SEED_DEMO_*` values):

| Role     | Email                                                                                                                                                                                                                                                                                     | Password            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Customer | `customer1@example.com`, `customer2@example.com`, `customer3@example.com`                                                                                                                                                                                                                 | `DemoCustomer!2026` |
| Chef     | `chef.lan@example.com` (Vietnamese, Mississauga, both locations), `chef.hoa@`, `chef.maria@`, `chef.harpreet@`, `chef.giulia@`, `chef.devon@`, `chef.minjun@`, `chef.layla@` (approved); `chef.wei@`, `chef.selam@`, `chef.ana@` (pending); `chef.carlos@` (rejected), all `@example.com` | `DemoChef!2026`     |

Pending and rejected chefs exist so you can show they never appear in search.

## What is MOCK

Nothing real is charged, sent or verified. Every item below is labelled **MOCK** in the code and the UI.

| Area                                                        | What happens instead                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Payments                                                    | The estimate shows labour, ingredients, travel fee and the platform fee (10 %), but no money moves. Stripe is not connected. |
| Free first booking                                          | Chef labour is shown as free; nobody pays the chef (open question Q-1).                                                      |
| Grocery receipts (option B)                                 | The chef uploads a receipt and the customer confirms the amount; the reimbursement is recorded, never collected.             |
| SMS phone check                                             | `MOCK_SMS_ENABLED` in `src/lib/server/mock-sms.ts`: any 6-digit code is accepted. No SMS is sent.                            |
| ID, food-handler certificate, police check, kitchen hygiene | Uploaded files are stored; the admin records a MOCK outcome. Nobody verifies anything.                                       |
| UI without Supabase                                         | `NEXT_PUBLIC_API_MOCK=1` runs the screens on fake data and shows a "MOCK API" badge. Leave it blank for the real routes.     |

## Demo script (CLAUDE.md section 12)

Run the app (`npm run dev`) against a seeded stack. Use two browsers (or one normal and one private window) for the customer and the chef.

1. **Search.** Sign in as `customer1@example.com`. Open Search, choose Mississauga and Vietnamese. Lan (`chef.lan@`) appears, sorted by distance, with rating, rate and cuisines. Pending and rejected chefs never appear.
2. **Book 2 days on the free trial.** Open Lan, pick dishes for two days, choose the cooking location and grocery option, fill in the allergy form. The estimate shows the cooking time, labour (free on the first booking), ingredients, travel fee and platform fee. Send the request.
3. **Chef accepts, both chat.** Sign in as `chef.lan@example.com` in the second browser. Open Bookings, read the intake form, accept. Both sides open the booking and send a message; it appears on the other side without a reload. Phone and address show only after acceptance.
4. **Review after the visit.** The review form opens once the booking is completed: the chef marks each visit day cooked (possible from the visit day on) and then marks the visit done. Bookings start tomorrow at the earliest (D-27) and the seed creates no bookings, so prepare one the day before: book a 1-day visit for the demo day and accept it; on the demo day the chef marks it cooked and done, and the customer leaves the review. Or show this step with the automated test below.
5. **Admin and free-trial block.** Sign in as `admin@example.com`. Open **Chef applications**, open a pending chef, record the MOCK checks and approve; the chef now appears in search. Then show that a second free first booking is blocked:
   - **Same phone, new account:** the phone step refuses the number ("This phone number cannot be used."), so the account never reaches booking.
   - **Same home address, new account:** when the customer ticks "Use my free first booking", the estimate says "The free first booking is not available for this account." and charges labour. That attempt now appears in the admin **Free-trial blocks** list (reason "address"): the estimate logs a block row when the trial was asked for and refused (phone and address matches only; one row per customer and rule per hour; every estimate refresh counts as an attempt and the list shows that count). Open the list right after the estimate to show it live.

The whole path runs automatically in CI: `e2e/demo-path-real.spec.ts` (steps 1 to 5, including live chat and the review after a completed visit).

## Known limits

These are prototype limits, not bugs to hide. A real launch needs each one decided.

- **Free first booking can still be gamed.** It is keyed on a verified phone and a normalized home address (both hashed with `HASH_PEPPER`). Cheap SIM cards and several addresses can still get more than one; a real launch needs ID verification.
- **Changing `HASH_PEPPER` invalidates every stored phone and address hash.**
- **Stored address keys are not recomputed.** Addresses saved before T-060 and T-093 with accents, full-width or look-alike letters (for example "ℌ") or non-Latin letters keep their old key until the address is saved again (no migration, D-135).
- **Look-alike text.** Cyrillic look-alike letters and Arabic-Indic digits are not folded into Latin ones. U+200E, U+200F, U+00AD, U+180E, U+2061 and U+3164 are not refused, so a name made only of them can look blank.
- **Contact snapshots are kept.** Phone and address copied onto a booking at acceptance are hidden 7 days after the last visit day (D-52) but the rows are never deleted. A retention job is a later decision.
- **Sign-up says when an email is already registered** (409 `EMAIL_IN_USE`), so anyone can test whether an email has an account (T-053 LOW-8).
- **Email confirmation is off** in the local Supabase config; fine for the demo, not for a launch.
- **Chat topics are open, chat data is not.** There are no Realtime Authorization policies, so anyone can broadcast on a chat topic, but the app listens only to database changes that RLS filters. Turn on private channels before adding broadcast or presence.
- **`NEXT_PUBLIC_API_MOCK=1` must never be set on a deployment.** It turns the page guards off and shows fake data (the API routes still check access).
- **Open security findings.** The T-053 review (`docs/security-review.md`) found no HIGH issues. MED-1, MED-2, MED-4, LOW-1 and LOW-2 are fixed (T-098, T-099, T-101); MED-3 is partly fixed (T-100, inline scripts still allowed); LOW-3 to LOW-7 are fixed by T-102 (LOW-6 only partly: bookings, admin, groceries, messages and storage removal still log database messages); the hosted minimum password length of 8 is a dashboard step for the project owner.
- **The contact filter can refuse normal text.** Number runs and dotted words such as "1 2 3 4 5 6 7 8 9 10", "Mr.Ly" or "kitchen.ca" read as a phone number or web address in names, bios, dishes and intake notes; the form says why and the user rewords it. An old saved allergy profile that now fails the filter loads as empty and must be entered again.
- **Older text is not re-checked for contact details.** Display names, chef bios, dishes and intake notes saved before T-101 keep any phone number or email they contain until they are edited.
- **Hosted demo accounts seeded before T-099** keep the old public passwords until `npm run db:seed -- --hosted` runs again with `SEED_DEMO_*` set.
- **Not verified yet:** hosted Auth settings (email confirmation, minimum password length, leaked-password protection, MFA), hosted Storage settings (hosted migrations were checked against `main` on 2026-10-22: all 28 match), and Vercel environment variables.

## Open legal and business risks

The prototype does **not** claim compliance with Ontario food-safety, licensing or insurance rules. These stay open for Jimmy and his mentor:

- Licensing, food-premises exemption or insurance for cooking in a customer's home, and for selling meals cooked in a chef's own kitchen.
- Liability for allergens and food poisoning. The "eat by" window (about 2 days) still needs Ontario public-health confirmation.
- A real background-check and ID-verification provider, and its cost.
- Who pays the chef during the free first booking.
- Commission percentage and travel-fee rate (10 % and 60 cents per km are placeholders).
