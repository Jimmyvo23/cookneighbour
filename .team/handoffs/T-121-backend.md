# Handoff: T-121 Seed uploads placeholder photos so seeded chefs show in search

From: backend  To: tester

## What changed
- Branch: `feature/T-121-seed-photos`
- Pull request: see `gh pr list --head feature/T-121-seed-photos` (Closes #230)
- Files:
  - `scripts/make-seed-images.mjs` (new): draws four flat food icons (bowl, pot, pan, plate) with circles and rectangles, plain Node, deterministic output.
  - `scripts/seed-images/{bowl,pot,pan,plate}.png` (new): the generated 160x160 PNGs, 0.5 to 2.3 KB each. Original art, no people.
  - `scripts/seed-photos.ts` (new): pure helpers (`iconFor`, `seedObjectPath`, `ensurePhotoPath`, `isAlreadyThere`). `.ts` imports only.
  - `scripts/seed.ts`: uploads one photo per chef (`profile-photos`) and per dish (`dish-photos`), sets `photo_path` only where empty; `--verify` fails on an approved chef or seeded dish without `photo_path`.
  - `src/lib/seed-photos.test.ts` (new): 10 unit tests.
  - `e2e/seed-photos-real.spec.ts` (new) and `playwright.config.ts` (added to the no-stack ignore list): demo step 1 with seeded data.
  - `.github/workflows/ci.yml`: last step of the `supabase` job is the bite test.
  - `README.md`: "Seeded chefs have no photos" replaced, new placeholder-photo bullet.
  - `docs/work-orders/WO-T121-seed-photos.md`.

## How to verify
- `npx vitest run src/lib/seed-photos.test.ts` -> 10 pass. `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx prettier --check .` all clean.
- Real stack (CI only): `npm run db:seed -- --local` twice, then `--verify` (CI already does this). `e2e/seed-photos-real.spec.ts` must pass in the normal e2e step.
- Bite test: the last CI step sets every `chefs.photo_path` to null with the service role, runs only the seeded spec and requires it to fail with the "SEEDED-LISTED" message.
- Re-run safety: second run prints "photos set this run: 0"; the objects count in `profile-photos`/`dish-photos` does not grow.

## Known gaps or risks
- Not run against a real stack locally (no Docker); CI is the first real run of the upload and the bite step.
- Object names are deterministic per chef or dish key (uuid v5 style from the key), not random. Chosen so a re-run or a crashed run never piles up objects (a duplicate answer is adopted, never overwritten). If a chef later replaces the photo, the old seed object stays in the bucket; nothing is deleted.
- If the storage duplicate answer ever changed shape (not 409 / "already exists" / "duplicate"), a re-run after a crash would fail loudly (no data harm).
- Hosted needs one more `npm run db:seed -- --hosted` (Planner, with Jimmy's OK) to get photos. CSP `img-src` already allows the Supabase host.
- Pending and rejected seeded chefs also get photos but stay hidden by status (spec asserts it).

## What the next agent needs
- Tester: seed twice on a fresh stack, count objects, check pending/rejected hidden, check images load, try the bite test by hand.
- The seed run prints no keys; storage error text is not printed (status code only).
