// T-118: MOCK mode (NEXT_PUBLIC_API_MOCK=1) must never run on a hosted deployment.
// Pure functions only, so next.config.ts, client code and tests share one rule. No "server-only":
// the browser bundle uses it too. Fails closed: any sign of Vercel turns the mock off.
//
// Vercel facts (https://vercel.com/docs/environment-variables/system-environment-variables):
// VERCEL=1 is set at build and runtime, but only while "Enable access to System Environment
// Variables" is on; VERCEL_ENV (production | preview | development), VERCEL_URL and VERCEL_REGION
// are system variables under the same switch; for Next.js, Vercel also exposes them as NEXT_PUBLIC_VERCEL_*.
// Because that switch can be turned off, the build also refuses a production build with the mock
// flag unless ALLOW_MOCK_BUILD=1 is set on purpose (see mockBuildProblem).

export type EnvLike = Record<string, string | undefined>;

/** Names only a Vercel build or runtime sets. NEXT_PUBLIC_MOCK_BLOCKED is written by next.config.ts. */
export const VERCEL_SIGNS = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_URL",
  "NEXT_PUBLIC_MOCK_BLOCKED",
] as const;

/** True when any variable that only Vercel sets is present and non-empty. */
export function onVercel(env: EnvLike): boolean {
  return VERCEL_SIGNS.some((k) => (env[k] ?? "").trim() !== "");
}

/** The mock adapter and the skipped page guards run only for exactly "1" and never on Vercel. */
export function mockAllowed(env: EnvLike): boolean {
  return env.NEXT_PUBLIC_API_MOCK === "1" && !onVercel(env);
}

/** Why the build must stop, or null. Called from next.config.ts. */
export function mockBuildProblem(
  env: EnvLike,
  opts: { production: boolean },
): string | null {
  const flag = (env.NEXT_PUBLIC_API_MOCK ?? "").trim();
  if (onVercel(env) && flag !== "")
    return "NEXT_PUBLIC_API_MOCK is set in a Vercel build. Remove it from the Vercel project settings (all environments); mock mode must never be deployed.";
  if (opts.production && flag === "1" && env.ALLOW_MOCK_BUILD !== "1")
    return "NEXT_PUBLIC_API_MOCK=1 in production (build or `next start`) needs ALLOW_MOCK_BUILD=1 (a local check only; never deploy the result).";
  return null;
}

/** Value for NEXT_PUBLIC_MOCK_BLOCKED, inlined into the client bundle so the browser also knows. */
export function mockBlockedFlag(env: EnvLike): string {
  return onVercel(env) ? "1" : "";
}
