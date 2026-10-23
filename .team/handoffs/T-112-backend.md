# T-112 Backend handoff

- `src/lib/domain/pepper-rule.ts`: `checkPepper(raw, { forbidPublicTestPepper })` and `PUBLIC_PEPPER_MESSAGE`. Imports LOCAL_TEST_PEPPER (with `.ts` extension, needed by node type stripping in the seed). Generic message, never the value.
- `scripts/seed.ts --hosted` always passes `forbidPublicTestPepper: true` (trimmed value compared).
- `src/lib/server/pepper.ts`: when `process.env.VERCEL` is set, refuses the public pepper, checked before the NODE_ENV=test shortcut. Local, CI, e2e and vitest without VERCEL are unchanged.
- Tests: new `src/lib/t112-public-pepper.test.ts` (rule, source guard, app with/without VERCEL, process-level hosted seed). `t111-tester-hosted-pepper.test.ts`: only the anchor string changed to `checkPepper(process.env.HASH_PEPPER,`; assertions not weakened.
- README pepper line updated. No ci.yml, playwright.config.ts, e2e-mock, migration, deploy.
- Builder choices: `VERCEL` any non-empty value counts; Vercel refusal applies under NODE_ENV=test too; a bad length on Vercel under NODE_ENV=test still passes (unchanged).
