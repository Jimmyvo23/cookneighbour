# Handoff: T-034 Dish menu and availability calendar UI

From: frontend  To: tester

## What changed
- Branch `feature/T-034-dish-menu-availability`, PR https://github.com/Jimmyvo23/cookneighbour/pull/77 (Closes #22).
- `src/app/chef/layout.tsx`: one server guard (`requireChefPage`, fail closed) inside Suspense for every /chef/* page, plus `ChefNav` (Application, Dishes, Availability, `aria-current`). `apply/page.tsx` lost its own guard.
- `/chef/dishes` (`src/components/chef/DishesView.tsx`): list, create, edit, deactivate, reactivate, no delete. Dollars in the form, cents sent. Rules reused from `src/lib/domain/dishes.ts` via `src/lib/chef/dishes.ts`. Allergen picker (13 priority allergens, lower case) plus "Other allergens". Photo upload to `dish-photos` as `<uid>/dish-<uuid>.<ext>`, `upsert: false`; an uploaded file is reused if only the save failed. Fallback box when there is no photo or it fails to load. 409 shows "You already have 50 active dishes..." and takes focus.
- `/chef/availability` (`AvailabilityView.tsx`, `src/lib/chef/calendar.ts`): ARIA grid, one tab stop, arrows/Home/End/PageUp/PageDown, Space/Enter toggles, `aria-pressed` plus a check mark and unsaved-change dot (not colour only). Window from the server (`today`, `lastBookableDay`); PUT `{add, remove}` as a diff.
- MOCK adapter: dish and availability routes with the real pure rules and real check order (404, unknown keys alone 422, foreign photo 403, field 422, cap 409). "with dish" now seeds a real mock dish with a photo; `chefHasDish` is gone.
- T-033 carry-overs done (see deviation below).
- `useSection.run` takes optional `describe` and `fields` so a page can word its own errors.

## Deviation to confirm
- The brief said to word removal of a kitchen photo as "the file stays stored". The code does the opposite: `DELETE /api/chef/application/documents` deletes the object (best effort, `removeObject`; contract section 5 says so). I wrote "Removing a photo takes it off your application and also tries to delete the file (if that fails, the file may stay stored)" so the UI matches the code. The Planner's PLAN T-033 line may need the same fix.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (323), `npm run build`, `npm run test:e2e:mock` (29): all pass locally.
- CI on PR #77 head 1cddb2d is green: unit 323, RLS 115, API 261, Playwright real routes 17, Playwright mock 29.
- New specs: `e2e-mock/chef-dishes-mock.spec.ts` (5), `e2e-mock/chef-availability-mock.spec.ts` (5), `e2e/chef-dishes-real.spec.ts` (6, CI only), unit `src/lib/chef/{dishes,calendar}.test.ts`, extended `upload.test.ts` and `mock-adapter.test.ts`.

## Known gaps or risks
- Next 16 `cacheComponents` keeps the previous client page mounted but hidden after in-app navigation, so tests must use exact labels (for example "Cuisine" also matches "Cuisines" on the hidden application page).
- Dish photo preview uses the public bucket URL from `NEXT_PUBLIC_SUPABASE_URL`; in MOCK mode there is no URL, so the fallback box shows "Photo not available".
- A replaced dish photo stays in Storage (backend decision). A photo upload whose save fails leaves an orphan if the chef then picks another file.
- Calendar has no bulk select (one day at a time, up to 181 days). Month buttons use `aria-disabled` at the ends.
- Real-route spec for the application still inserts its fixture dish with the service role (kept so that spec stays about the application).
- No server-error case for availability is tested in the UI (the window is checked by the server and by the calendar); a stale page after midnight shows the server's 422 message.
- Docker was not available locally; real-route, RLS and API suites ran in CI only.

## What the next agent needs
- Try: keyboard-only through the editor (all checkboxes, file input), the calendar grid in a screen reader (names read "Thursday, October 8, 2026, today", pressed state), 375px width, dark mode, 50 active dishes, cancel and Escape behaviour, a second tab after log-out, opening /chef/* as customer, admin and signed out (HTML must carry no chef content).
- Lessons-learned section 3 self-check: ids come from the loaded list only; photo paths are built from the signed-in user id; names are new uuids, `upsert: false`; shared text rule is applied before sending; labels and MOCK notes match behaviour; focus moves to the error or first invalid field after every error; server guard on every /chef page.

## Round 2 (tester LOW findings)
- **Upload kept on save failure:** `DishesView` now drops the stored upload only when `uploadRejected(err)` is true (403, or a `photoPath` field error); other failures (409 cap, 422 on other fields, network) keep it so a retry does not upload again. Choosing a different file still uploads anew. Unit test `uploadRejected` in `src/lib/chef/dishes.test.ts`.
- **Visible disabled style:** `buttonCls` and `secondaryButtonCls` get `aria-disabled:opacity-60 aria-disabled:cursor-not-allowed` (month Prev/Next, Edit/Deactivate while busy, Save availability). They stay focusable.
- Finding 3 untouched (`src/lib/domain/dishes.ts`), backlog.
- Local: lint, typecheck, npm test (386), mock Playwright (36) pass. CI green on head 60c8a16ae856f655d60ff14bd99d173fa9d5135d (run 37832780391).
