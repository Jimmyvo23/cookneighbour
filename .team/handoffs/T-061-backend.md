# Handoff: T-061 Rule changes from D-21, D-24, D-25

From: backend  To: tester

## What changed
- Branch: `feature/T-061-rule-changes`
- Pull request: see the PR titled "T-061: Rule changes from D-21, D-24, D-25"
- Files:
  - Migration (NEW, not yet pushed to hosted): `supabase/migrations/20261010150000_admin_rules_d21.sql` (`create or replace` of `admin_reject_chef` and `admin_review_kitchen`; the T-035 migration is untouched).
  - D-21a: `src/lib/domain/admin-chefs.ts` (`failedChecks`, `isFlagged`), `src/lib/server/admin-chefs.ts` (list items carry `failedChecks` and `flagged`), `src/lib/api/types.ts` (`AdminChefListItem`), `src/lib/mocks/mock-admin.ts` (listItem only, so the mock keeps compiling; behaviour parity is T-062), `src/lib/admin/queue.test.ts` (fixture).
  - D-21b: migration plus `reviewKitchen` maps `invalid_state` to 409 `INVALID_STATE`.
  - D-21d: migration (reject also sets `chef_home_enabled = false`).
  - D-24: `src/lib/domain/allergy.ts` (`SYNONYM_GROUPS`, `sameWord`), `src/lib/domain/allergy.test.ts`.
  - D-25: `src/lib/server/search.ts` (`getChefDetail` throws the usual 404 when no public location option).
  - Tests: `src/lib/domain/admin-rules-d21-guards.test.ts` (drift guard), `src/lib/domain/admin-chefs.test.ts`, API tests in `tests/api/admin-chefs-access.test.ts`, `admin-chefs-checks.test.ts`, `admin-chefs-decisions.test.ts`, `search.test.ts`.
  - Docs: `docs/api-contract.md` (v1.3.1), `docs/domain-rules.md`.

## How to verify
- `npm run lint && npm run typecheck && npm test` : all pass (1041 passed, 3 expected fail).
- Drift guard: `npx vitest run src/lib/domain/admin-rules-d21-guards.test.ts` (new bodies equal the old ones except the two intended lines).
- API tests need local Supabase (`npm run test:api`). **I could not run them: this machine has no Docker.** They are written but unrun; the Tester must run them locally with the new migration applied (`supabase db reset` or equivalent), and read any failure as possibly mine.

## Known gaps or risks
- API tests were first unrun locally; CI ran them and found one exact-key list test (fixed, now includes failedChecks and flagged). D-30: extra synonym words kept. D-31: search avoidAllergens map goes to T-042.
- Allergy map: over-warns on purpose. Peanut and nut are one group, so "peanut" now also warns on a dish with "tree nuts" and the other way round; "shellfish" matches both crustaceans and molluscs. Existing unit expectations were updated for this. I added a few extra words to the groups beyond the D-24 list (prawn, crab, lobster, clam, squid, oyster, mussel, scallop, almond, cashew, walnut, pecan, pistachio, hazelnut, groundnut). Remove them if Jimmy wants only the listed pairs.
- The `flagged` rule counts all four MOCK checks including police (D-21a says "any MOCK check"). "Checks pending" still ignores police (D-21c).
- Not changed: the search filter `avoidAllergens` is still exact-word matching and does not use the synonym map (separate code, outside T-061). Worth a Planner decision.
- After rejecting a chef, `kitchen_status` stays as is (for example `verified`) while `chef_home_enabled` is false; re-approval needs a new kitchen review to turn chef's home on. Kitchen review of a re-approved chef is allowed (approved).
- Mock adapter (`mock-admin.ts`) does not yet apply the 409 for rejected chefs or the reject side effect; T-062 covers the mock.
- Hosted DB: the Planner runs `supabase db push` after merge.

## What the next agent needs
- Contract changes: `GET /api/admin/chefs` items gain `failedChecks` and `flagged`; `POST /api/admin/chefs/:id/kitchen-review` gives 409 `INVALID_STATE` for a rejected chef (both decisions); reject sets `chefHomeEnabled` false; `GET /api/chefs/:id` is 404 when `locationOptions` would be empty.
- Tester focus: rejected chef kitchen review (approve and reject) writes nothing and sends no notification; approved chef kitchen review still works; reject of a chef with chef's home on turns it off and re-approve leaves it off; flag only for `approved` + a failed check (police counts); the 404 body and text for an unbookable chef is byte-identical to an unknown id; allergy synonyms in both directions and no false match for fish vs shellfish, eggs vs milk, nutmeg vs nuts.
