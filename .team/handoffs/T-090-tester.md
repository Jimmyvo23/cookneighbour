# Handoff: T-090 (tester)

From: tester  To: reviewer

## Verdict: PASS (API and RLS suites run in CI only; no Docker locally)

## What I checked
- Function diff: new `admin_decide_booking` body vs 20261023100000 differs only by `'booking_id', b.id` in the result. Signature, `set search_path = ''`, no security definer, revoke from public/anon/authenticated and grant to service_role are unchanged.
- `decide()`: throws on a failed `free_trial_claims` read; booking id comes from the function result (throws if missing); no `reports` read (unit test asserts the table list).
- Policy `reports_insert_party`: identical to the original minus `admin_note is null`; keeps reporter = auth.uid(), status open, resolved_at null, party check.
- `admin_note`: no remaining use in src, tests or docs except the "column is gone" assertions. Reporter API test already asserts no note key.
- Local: lint, typecheck, `prettier --check .` clean; vitest 107 files, 2339 passed, 3 expected fail.

## Tests added
- `tests/rls/t090-tester.test.ts` (CI only): non-party refused; spoofed reporter, born dismissed/resolved, born with resolved_at refused; `admin_note` select/insert fails for service role and party; plain party insert still works and returns no note; anon and customer get 42501 on the RPC.

## Findings (by severity)
- None blocking.
- LOW: the new RLS file could not be run locally; if CI shows a failure it is likely in my test (e.g. the cleanup delete), not product code.
- LOW (builder-noted): app and migration must ship together, migration first on hosted; run the `admin_note is not null` count (must be 0) first.
- INFO: admin decision flows (resolve, dismiss, resolve-flag, completed change) are covered by the existing T-048 API/RLS tests, which are unchanged and run in CI.
