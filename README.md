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

All seed data is **fictional**: invented names, `@example.com` emails, 555-01xx phone numbers and made-up street addresses. ID, food-handler, police and kitchen statuses on chefs are **MOCK** values; nobody verified anything. Seeded chefs have no uploaded documents. Since T-121 the seed uploads a **placeholder picture** (a drawn food icon, no people) as the profile photo of every seeded chef and as the photo of every seeded dish, because search hides an approved chef without a photo (A-20).

- `supabase/seed.sql` loads about 60 GTA postal-code prefixes (Mississauga L4T to L5W, Toronto, Brampton, Oakville, Markham, Vaughan, Richmond Hill). Coordinates are **approximate** area centres, only used for straight-line distance. It runs automatically on `supabase start` and `supabase db reset`.
- `scripts/seed.ts` creates the accounts, 12 chefs, dishes and 3 weeks of availability. It is server-only (secret key), idempotent, and refuses to run unless you pass a target: `npm run db:seed -- --local` (running local stack) or `npm run db:seed -- --hosted` (needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `HASH_PEPPER` (at least 32 characters, the same value as the app), `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD` in `.env.local`; `SEED_ADMIN_PASSWORD` is optional). Add `--verify` to check the result without writing.
- **Placeholder photos (T-121).** The pictures are four original flat icons (bowl, pot, pan, plate) in `scripts/seed-images/`, drawn by `node scripts/make-seed-images.mjs` (no third-party art, each under 3 KB). The seed uploads them with the service role to `profile-photos` and `dish-photos`, insert-only (`upsert: false`), as `<owner id>/photo-<uuid>.png` or `<chef id>/dish-<uuid>.png`, and sets `photo_path` only where it is empty. The uuid in the name comes from the chef or dish key, so a re-run finds the photo already set and uploads nothing, and an object left by a run that died before the row was updated is adopted, never overwritten. Hosted needs no extra setting: the CSP already allows the Supabase host in `img-src`. `--verify` fails when an approved chef or a seeded dish has no `photo_path`. Hosted databases seeded before T-121 need `npm run db:seed -- --hosted` once more to get the photos. Pending and rejected chefs get a photo too but stay hidden by their status.
- The **admin** password is never in this repo. Set `SEED_ADMIN_PASSWORD` in `.env.local` (or the shell) before seeding; without it the admin account is skipped. Admin login: `admin@example.com`.
- **Local pepper (T-111).** `--local` uses `HASH_PEPPER` from `.env.local` when it is set, so local hashes already match the app. The `LOCAL_TEST_PEPPER` fallback (`local-test-pepper-not-a-secret-0000`, from `src/lib/domain/local-test-pepper.ts`) applies only when no pepper is set (CI and throwaway stacks). **Never** put that constant in `.env.local` or in any hosted or Vercel environment; it is public. `db:seed -- --hosted` and the app on Vercel (`VERCEL` set) refuse it (T-112).
- **Demo chef and customer passwords.** The local logins are unchanged (the demo passwords in `scripts/seed-data.ts` are used for `--local` only, on a throwaway local stack). Those passwords are public because the repo is public, so `--hosted` never uses them: it refuses to run unless `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD` are set (each at least 12 characters and different from the repo defaults). The script never prints password values.

Demo logins (local only; hosted uses your `SEED_DEMO_*` values):

| Role     | Email                                                                                                                                                                                                                                                                                     | Password            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Customer | `customer1@example.com`, `customer2@example.com`, `customer3@example.com`                                                                                                                                                                                                                 | `DemoCustomer!2026` |
| Chef     | `chef.lan@example.com` (Vietnamese, Mississauga, both locations), `chef.hoa@`, `chef.maria@`, `chef.harpreet@`, `chef.giulia@`, `chef.devon@`, `chef.minjun@`, `chef.layla@` (approved); `chef.wei@`, `chef.selam@`, `chef.ana@` (pending); `chef.carlos@` (rejected), all `@example.com` | `DemoChef!2026`     |

Pending and rejected chefs exist so you can show they never appear in search.

## What is MOCK

Nothing real is charged, sent or verified. Every item below is labelled **MOCK** in the code and the UI.

| Area                                                        | What happens instead                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments                                                    | The estimate shows labour, ingredients, travel fee and the platform fee (10 %), but no money moves. Stripe is not connected.                                                                                                                                                                                                                                                           |
| Free first booking                                          | Chef labour is shown as free; nobody pays the chef (open question Q-1).                                                                                                                                                                                                                                                                                                                |
| Grocery receipts (option B)                                 | The chef uploads a receipt and the customer confirms the amount; the reimbursement is recorded, never collected.                                                                                                                                                                                                                                                                       |
| SMS phone check                                             | `MOCK_SMS_ENABLED` in `src/lib/server/mock-sms.ts`: any 6-digit code is accepted. No SMS is sent.                                                                                                                                                                                                                                                                                      |
| ID, food-handler certificate, police check, kitchen hygiene | Uploaded files are stored; the admin records a MOCK outcome. Nobody verifies anything.                                                                                                                                                                                                                                                                                                 |
| UI without Supabase                                         | `NEXT_PUBLIC_API_MOCK=1` runs the screens on fake data and shows a "MOCK API" badge. Leave it blank for the real routes. A production build or `next start` with the flag also needs `ALLOW_MOCK_BUILD=1` (T-118). `npm run typecheck` runs `next typegen`, which loads the config as a production build, so with the flag in `.env.local` it also needs `ALLOW_MOCK_BUILD=1` (T-120). |

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

## Deploy (Vercel, prototype)

This is a prototype with **seed data only**. Nothing real is charged or verified: payments, ID checks, police checks and SMS are all **MOCK**. Do not put real people's data in it. Only the project owner enters env var values; this section lists **names only**.

### Rules for this deploy

- Free Vercel Hobby project, connected to the GitHub repo. Only `main` deploys (`vercel.json` turns off automatic deployments for every other branch, using Vercel's `git.deploymentEnabled`, see https://vercel.com/docs/project-configuration/git-configuration).
- Set every env var for the **Production** environment only. Preview and Development get none, so a pull-request build can never hold the hosted database keys.
- Env var values are typed by the project owner in the Vercel dashboard. They never go in chat, issues, commits or this file.

### Env var checklist

Set these three kinds of names in Vercel (Project > Settings > Environment Variables, tick **Production** only).

| Name                                   | Needed                      | Reaches the browser?   | Rule                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Required, at **build** time | Yes (public by design) | The hosted project URL (`https://...supabase.co`). Also sets the Supabase host in the Content-Security-Policy, so it must exist before the build; if you add it later, redeploy.                                                                                                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required, at **build** time | Yes (public by design) | The `sb_publishable_...` key only.                                                                                                                                                                                                                                                                                |
| `SUPABASE_SECRET_KEY`                  | Required, runtime           | **No**, server only    | The `sb_secret_...` key. Bypasses row-level security. Never give it a `NEXT_PUBLIC_` name.                                                                                                                                                                                                                        |
| `HASH_PEPPER`                          | Required, runtime           | **No**, server only    | There is ONE hosted pepper: a secret of at least 32 characters (`openssl rand -hex 32`), never the public test pepper (the app refuses it on Vercel). The same value goes into Vercel and into the environment you use for `--hosted` seeding. Changing it later invalidates every stored phone and address hash. |

Do **not** set these on Vercel:

- `NEXT_PUBLIC_API_MOCK`: leave it unset (or empty). `1` turns on the mock adapter and switches page guards off. Since T-118 the build refuses to start on Vercel if this name is set to any value, and the app ignores it there at runtime too (it looks for any of the Vercel system variables listed in `src/lib/mock-guard.ts`). This works only while Vercel's "Enable access to System Environment Variables" is on (the default); if it is off, only the `ALLOW_MOCK_BUILD` rule stops a `1`. Still leave it unset.
- `SEED_ADMIN_PASSWORD`, `SEED_DEMO_CHEF_PASSWORD`, `SEED_DEMO_CUSTOMER_PASSWORD`: used only by the seed script on your own machine.
- `VERCEL`, `NODE_ENV`, `CI`: Vercel sets them. The app uses `VERCEL` to trust only Vercel's own IP headers and to refuse the public test pepper.

Only the two `NEXT_PUBLIC_SUPABASE_` names carry your own values into the browser bundle; neither is a secret. Two flags are also inlined: `NEXT_PUBLIC_API_MOCK` (empty when unset, harmless) and `NEXT_PUBLIC_MOCK_BLOCKED`, which the build sets to `1` on Vercel (T-118; not a secret, and you never set it yourself). A build with no env vars at all succeeds (checked on 2026-10-23), but the result has empty Supabase settings and a Content-Security-Policy without the Supabase host, so set the variables before the first production build.

### Steps

1. **Check the database.** The newest migration is `20261027100000`. Run `npx supabase migration list --linked` from the repo folder; if any later migration appears, run `npx supabase db push --linked` first.
2. **Create the project.** Vercel dashboard > Add New > Project > import the GitHub repo. Framework preset **Next.js**. Leave build command, output directory and install command on their defaults. Root directory: the repo root.
3. **Add the four env vars** from the table, Production only, before pressing Deploy.
4. **Production branch** (Settings > Git): `main`. After the first deploy open a test pull request and confirm Vercel does **not** build it. If it does, turn previews off in the dashboard (Settings > Git, or an Ignored Build Step) and tell the Planner. The `main` + `**` combination in `vercel.json` was not tried live: confirm it with this test pull request.
5. **Supabase Auth URLs** (Supabase dashboard > Authentication > URL Configuration). The app signs in with email and password through its own routes; it sends no email links, so there are no callback pages. Still set:
   - **Site URL** = your Vercel production URL (`https://<project>.vercel.app`).
   - **Redirect URLs** = add `https://<project>.vercel.app/**`. Keep the existing local entry if you still run locally.
   - **Sign In / Providers > Email:** leave "Confirm email" **off** for the demo (the app has no "check your email" step, and Supabase's built-in email sender allows only a few emails per hour).
   - Set the minimum password length to 8 (still an open step from the security review).
6. **Re-seed the hosted database yourself** from your machine. The environment the scripts read (for example `.env.local`) must hold the **hosted** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, not a local-stack setup (`scripts/seed.ts` and `npm run db:check` use them). Also set:
   - `HASH_PEPPER`: the same value you gave Vercel.
   - `SEED_DEMO_CHEF_PASSWORD` and `SEED_DEMO_CUSTOMER_PASSWORD`: required by `--hosted`, at least 12 characters each.
   - `SEED_ADMIN_PASSWORD`: needed to create the admin account (without it the admin is skipped, and the smoke test needs the admin).

   Then run `npm run db:seed -- --hosted` and `npm run db:check`.

7. **Smoke test** on the Vercel URL:
   - The home page and `/search` load with no console errors; the map shows tiles.
   - Search "Mississauga" + Vietnamese finds a seeded chef.
   - Sign up a new customer (use made-up details, never real ones); log out and log in again.
   - Log in as the seeded customer: a booking estimate shows, and the MOCK labels are visible.
   - (The seeded demo emails are listed in `scripts/seed-data.ts`; the admin is `admin@example.com`. Passwords are the ones you set; none are in the repo.)
   - Log in as the seeded admin: the pending-chef queue and the free-trial blocks list open.
   - Open a booking and send a chat message (checks Realtime).
   - Response headers include `Content-Security-Policy` and `X-Frame-Options: DENY`.
   - There is no "MOCK API" badge on the pages.

### Known deploy limits

- Expired booking requests are cleaned up lazily when someone reads bookings, not by a scheduler.
- The map uses the public OpenStreetMap tile server, which allows light use only. Fine for a demo; not for traffic.
- Realtime chat topics are open (see Known limits).
- Anyone who finds the URL can sign up. It is a prototype: keep it to seed data.

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
- **`NEXT_PUBLIC_API_MOCK=1` must never be set on a deployment.** It turns the page guards off and shows fake data (the API routes still check access). T-118 makes a Vercel build fail when it is set and ignores it at runtime on Vercel, but only while Vercel's "Enable access to System Environment Variables" is on (the default); if it is off, only the `ALLOW_MOCK_BUILD` rule stops a `1`. On any other host, a production build or `next start` with the flag at `1` still stops unless `ALLOW_MOCK_BUILD=1` is also set; a host that sets that variable, or a development server (`next dev`), is not protected.
- **Open security findings.** The T-053 review (`docs/security-review.md`) found no HIGH issues. MED-1, MED-2, MED-4, LOW-1 and LOW-2 are fixed (T-098, T-099, T-101); MED-3 is partly fixed (T-100, inline scripts still allowed); LOW-3 to LOW-7 are fixed by T-102 (LOW-6 only partly: bookings, admin, groceries, messages and storage removal still log database messages); the hosted minimum password length is 8 (set by Jimmy on 2026-10-26, with no required character types, matching the sign-up form).
- **The contact filter can refuse normal text.** Number runs and dotted words such as "1 2 3 4 5 6 7 8 9 10", "Mr.Ly" or "kitchen.ca" read as a phone number or web address in names, bios, dishes and intake notes; the form says why and the user rewords it. An old saved allergy profile that now fails the filter loads as empty and must be entered again.
- **Older text is not re-checked for contact details.** Display names, chef bios, dishes and intake notes saved before T-101 keep any phone number or email they contain until they are edited.
- **Hosted demo accounts seeded before T-099** keep the old public passwords until `npm run db:seed -- --hosted` runs again with `SEED_DEMO_*` set.
- **Hosted settings checked on 2026-10-26 (T-055):** Confirm email is off, so a new account can log in at once (fine for the demo, not for a launch); minimum password length 8; Site URL `https://cookneighbour.vercel.app` with redirect `https://cookneighbour.vercel.app/**`; Vercel builds `main` only, with no preview builds for pull requests. **Still not verified:** leaked-password protection, MFA and the hosted Storage settings.
- **Accepted deploy-smoke limits (D-207).** A page that needs a login answers HTTP 200 and then redirects in the page, instead of a server redirect (the API routes still answer 401). Logged out, the browser console shows one 401 line from `/api/me`. An unknown chef link answers HTTP 200 with "Chef not found", the same as a pending chef (no data is shown). Signing up with an email the auth provider refuses (for example an `example.com` address) shows a general error, not a message on the email field.

## Open legal and business risks

The prototype does **not** claim compliance with Ontario food-safety, licensing or insurance rules. These stay open for Jimmy and his mentor:

- Licensing, food-premises exemption or insurance for cooking in a customer's home, and for selling meals cooked in a chef's own kitchen.
- Liability for allergens and food poisoning. The "eat by" window (about 2 days) still needs Ontario public-health confirmation.
- A real background-check and ID-verification provider, and its cost.
- Who pays the chef during the free first booking.
- Commission percentage and travel-fee rate (10 % and 60 cents per km are placeholders).
