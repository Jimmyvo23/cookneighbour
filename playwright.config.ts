import { defineConfig, devices } from "@playwright/test";

// Default e2e run: the app talks to the REAL API routes backed by a local Supabase stack.
// The stack's URL and keys come from `eval "$(supabase status -o env)"` (public local defaults,
// never repo secrets). Without them (no Docker locally) only the smoke test runs.
// NEXT_PUBLIC_API_MOCK is forced blank here, so the mock adapter is never used in this run.
// The mock-mode UI tests live in playwright.mock.config.ts (`npm run test:e2e:mock`).
const PORT = 3100;
const env = process.env;
const anon = env.ANON_KEY ?? env.PUBLISHABLE_KEY ?? "";
const service = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY ?? "";
const hasStack = Boolean(env.API_URL && anon && service);

export default defineConfig({
  testDir: "./e2e",
  testIgnore: hasStack
    ? []
    : [
        "**/auth-real.spec.ts",
        "**/chef-application-real.spec.ts",
        "**/chef-dishes-real.spec.ts",
        "**/admin-real.spec.ts",
        "**/admin-queue-real.spec.ts",
      ],
  forbidOnly: !!env.CI,
  retries: env.CI ? 1 : 0,
  reporter: env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_MOCK: "",
      NEXT_PUBLIC_SUPABASE_URL: env.API_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
      SUPABASE_SECRET_KEY: service,
      // Throwaway test pepper. Only hashes in the throwaway local database use it.
      HASH_PEPPER: "e2e-test-pepper-not-a-secret",
    },
  },
});
