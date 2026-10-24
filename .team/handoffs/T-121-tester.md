# Handoff: T-121 Seed uploads placeholder photos (Tester)

From: tester  To: reviewer

Verdict: PASS (head eecd9d9). No blocking or medium findings.

## What changed
- No code changed by the Tester. This file is the only new file (uncommitted, for the Planner).
- PR #231 (Issue #230), branch `feature/T-121-seed-photos`.

## How to verify (what I ran, all in the T-121 worktree)
- `npm run lint`: clean. `npm run typecheck`: clean. `npx vitest run`: 3240 passed, 3 expected fail (existing). `npx prettier --check .`: clean.
- `node --experimental-strip-types -e "import('./scripts/seed-photos.ts')"`: loads. `import('./scripts/seed.ts')`: loads and prints its usage text (no ERR_MODULE_NOT_FOUND).
- Generator determinism: ran a copy of `make-seed-images.mjs` from a scratch folder; output is byte-identical to the committed PNGs.
- Viewed all four PNGs: flat food icons (bowl with steam, pot, pan with egg, plate with three food discs). No people, no text. 160x160, 543 to 2318 bytes (limit 5 MB, PNG allowed in both buckets).
- CI run 39994199906 (all jobs success: e2e-mock, checks, supabase, ci), read in the log:
  - Seed run 1: `photos set this run: 43` (12 chefs + 31 dishes). Run 2: `photos set this run: 0`. Then `--verify`: `verify ok: 12 chefs, 1 approved Vietnamese in Mississauga, 31 dishes`. Seed ran before the e2e step.
  - e2e: `seed-photos-real.spec.ts` both tests passed (1.8 s and 820 ms); `50 passed`. The first one checks the image really loads (naturalWidth > 0) under the app CSP and the storage URL returns 200 image/png.
  - Bite step: photo_path cleared with the service role, spec run with `--retries=0`, both tests failed, the first with `SEEDED-LISTED: Chef Lan (demo) ... Received array: []`; `Bite test ok: the spec fails without photos`. Right reason. The CI shows the key masked (`Authorization: ***`).

## Findings
### 1. Idempotency (from code and unit tests)
- Run 1: no `photo_path`, uploads (`upsert:false`), then updates `photo_path` only `where photo_path is null`. OK.
- Run 2: `photo_path` set, action `kept`, no upload (CI shows 0). OK.
- Crash between upload and row update: next run uploads the same deterministic name, storage answers duplicate, `isAlreadyThere` (409 / "already exists" / "duplicate") adopts it, no overwrite. Unit test covers this with a fake store.
- Chef set own photo: `photo_path` is non-null, so it is kept and the update also has `is null` (race-safe). Never overwritten.
- Deterministic names vs WO "new name per upload": deviation from the WO wording, but no overwrite path. Every seed upload is `upsert:false`, so storage refuses a name that exists; app uploads use `crypto.randomUUID()`, which cannot collide with the sha1-derived seed uuid; update/delete policies are owner-only and the seed never calls update or delete. Old seed objects remain as orphans if a chef replaces the photo (harmless, noted by backend).
- Dish keys `dish:<chef>:<dish name>`: I checked that dish names are unique per chef in seed data (no shared object).

### 2. Pending and rejected hidden
- The new spec asserts by name that pending and rejected seeded chefs are absent from the unfiltered public list (passed in CI). Detail 404 for pending/rejected is not asserted in the new spec; it is covered by `tests/api/search.test.ts` (lines 393 to 435, passed in CI). Seed gives them photos but status still hides them.

### 3. Shared-search pollution
- New spec only uses `toContain` and `not.toContain` on names, paginates (limit 50, up to 30 pages), and the UI part clicks Load more up to 15 times. No exact-list assertion, so chefs from other real tests (cuisine "Vietnamese", Mississauga) cannot break it. Other real specs and API tests use unique tags or `toContain` (search-real, demo-path-real, search.test.ts). Seeded Lan now being listed did not break them in CI. Name clash is unlikely (seed names end in "(demo)").
- Order in CI: API tests run before the seed, so exact-list API tests never see seeded chefs; they use per-test tags anyway.

### 4. Logs
- Seed log lines: counts only. Storage error text is never printed (status code only in the thrown message). `must()` prints a PostgREST message if the `photo_path` update fails (not storage, not secret).

## Known gaps or risks (all LOW, none block)
- LOW: The adopt-on-409 path is only proven with a fake store. CI never hits it, because run 2 skips upload when `photo_path` is set. The real storage error shape (statusCode "409", "The resource already exists") is the documented one but not exercised on a real stack. If it differed, a re-run after a crash would fail loudly, with no data harm.
- LOW: Hosted images under the CSP are proven locally (naturalWidth > 0 in CI, http loopback) and by `security-headers.test.ts` for the https host, not on hosted. Planner's post-seed live check covers it.
- LOW: If a chef sets `photo_path` to null later, a re-seed gives back the seed icon (by design: fills empty only).
- INFO: I did not run e2e-mock (no app code changed) and could not run the real stack (no Docker); CI is the evidence.

## What the next agent needs
- Reviewer: check the docs claim (README line 55) and that the deterministic-name choice is acceptable against the WO wording "new name per upload". After merge, hosted needs one `npm run db:seed -- --hosted` (Planner with Jimmy's OK) and a live search check.
