import type { NextConfig } from "next";
import { mockBlockedFlag, mockBuildProblem } from "./src/lib/mock-guard";
import { cspOptionsFromEnv, securityHeaders } from "./src/lib/security-headers";

// T-118: stop the build before mock mode can reach a Vercel deployment.
const mockProblem = mockBuildProblem(process.env, {
  production: process.env.NODE_ENV === "production",
});
if (mockProblem) throw new Error(`T-118 mock guard: ${mockProblem}`);

const nextConfig: NextConfig = {
  // Inlined into the browser bundle: "1" on Vercel, so client code turns the mock off there too.
  env: { NEXT_PUBLIC_MOCK_BLOCKED: mockBlockedFlag(process.env) },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(cspOptionsFromEnv(process.env)),
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
