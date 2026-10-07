import { defineConfig } from "vitest/config";

// RLS suite: runs against a LOCAL Supabase (supabase start), never a hosted project.
// Keys come from `supabase status -o env` (see .github/workflows/ci.yml and tests/rls/README.md).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    globalSetup: ["tests/rls/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
