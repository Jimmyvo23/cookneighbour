# T-111 Backend handoff

- New `src/lib/domain/local-test-pepper.ts`: `LOCAL_TEST_PEPPER` (35 chars, not a secret, local/throwaway only). No server-only import.
- `scripts/seed.ts` `--local` fallback and `playwright.config.ts` both use it. `--hosted` unchanged (still needs a real HASH_PEPPER).
- Unit test `src/lib/domain/local-test-pepper.test.ts`; `t102-tester-pepper.test.ts` now checks the config uses the constant.
- New e2e test in `e2e/auth-real.spec.ts`: new account submits seeded customer1's phone (4165550101), expects 409 PHONE_IN_USE. Only works in the `supabase` CI job (seed runs before e2e). Could not run locally (no Docker).
- No ci.yml, migration or hosted change. No docs mentioned `local-dev-pepper` (only old handoffs, left as history).
- Builder choices: new pepper value `local-test-pepper-not-a-secret-0000`; test placed in auth-real.spec.ts; test asserts the phone block (not the address/free-trial block).
- Note: a local app run seeded without HASH_PEPPER now needs HASH_PEPPER=local-test-pepper-not-a-secret-0000.
