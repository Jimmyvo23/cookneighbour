import { defineConfig, devices } from "@playwright/test";

// MOCK-mode UI tests: the app runs with NEXT_PUBLIC_API_MOCK=1, so no Supabase is needed.
const PORT = 3101;

export default defineConfig({
  testDir: "./e2e-mock",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results-mock",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_MOCK: "1" },
  },
});
