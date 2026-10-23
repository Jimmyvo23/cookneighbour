// NOT A SECRET. A fixed pepper for LOCAL, THROWAWAY databases only (the CI/Supabase local stack).
// scripts/seed.ts uses it as its `--local` fallback and playwright.config.ts gives it to the e2e
// app, so seeded customers' phone/address hashes match what the app computes. Never use it for
// a hosted project: `--hosted` still requires the real HASH_PEPPER (T-109).
// Pure, no "server-only" import, so scripts and Playwright config can import it.
export const LOCAL_TEST_PEPPER = "local-test-pepper-not-a-secret-0000";
