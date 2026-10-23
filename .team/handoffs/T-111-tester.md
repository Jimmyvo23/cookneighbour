# T-111 Tester handoff: PASS

- Trace: CI runs `db:seed -- --local` with no HASH_PEPPER, so the seed uses LOCAL_TEST_PEPPER (trim is a no-op, constant has no padding). The e2e app gets HASH_PEPPER=LOCAL_TEST_PEPPER, and getHashPepper trims too. Same value, same hashes.
- supabase job log: `auth-real.spec.ts:215 a seeded demo customer's phone number is refused (409)` passed; 48 e2e passed. All 4 checks incl. `ci` gate green.
- Old main: seed "local-dev-pepper" vs app "e2e-test-pepper-..." gave different phone hashes, so /api/me/phone would return 200 and the test would FAIL. It proves T-111. (Reasoned from code; no local Docker to replay.)
- Robust: read-only on customer1 (409 happens before any save), fresh account and random IP per test, seed idempotent.
- Added `src/lib/t111-tester-hosted-pepper.test.ts` (3 tests): --hosted branch has no LOCAL_TEST_PEPPER, bad peppers refused, constant is trimmed and valid.
- vitest 3190 passed (+3 new), lint clean, prettier clean.
- Gap (LOW): README/.env.example do not say a locally seeded DB needs HASH_PEPPER=local-test-pepper-not-a-secret-0000 (or unset in seed and set in the app). Backend handoff notes it; docs not updated.
