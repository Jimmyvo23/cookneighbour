import path from "node:path";
import { defineConfig } from "vitest/config";

// API route tests (T-028): call the Route Handlers directly against a LOCAL Supabase.
// `server-only` is stubbed (it only exists to fail browser builds) and next/headers is mocked in
// tests/api/harness.ts with an in-memory cookie jar.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/api/server-only-stub.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    setupFiles: ["tests/api/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
