import type { NextConfig } from "next";
import {
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { mockBlockedFlag, mockBuildProblem } from "./src/lib/mock-guard";
import { cspOptionsFromEnv, securityHeaders } from "./src/lib/security-headers";

// T-118/T-120: stop the build before mock mode can reach a Vercel deployment.
// Production is decided by Next's phase, not NODE_ENV, which a host can set to anything.
const buildConfig = (): NextConfig => ({
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
});

export default function config(phase: string): NextConfig {
  const mockProblem = mockBuildProblem(process.env, {
    production:
      phase === PHASE_PRODUCTION_BUILD || phase === PHASE_PRODUCTION_SERVER,
  });
  if (mockProblem) throw new Error(`T-118 mock guard: ${mockProblem}`);
  return buildConfig();
}
