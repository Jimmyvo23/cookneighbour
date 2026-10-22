// Request parsing: CSRF content-type check (contract section 1) and JSON bodies.
import { ApiFailure, validationFailed } from "./errors";

/** State-changing requests must say they are exactly application/json (optionally with charset). */
export function requireJson(request: Request): void {
  const raw = request.headers.get("content-type");
  if (!raw)
    throw new ApiFailure(
      "BAD_REQUEST",
      "Content-Type must be application/json.",
    );
  const [type, ...params] = raw.split(";").map((p) => p.trim());
  const paramsOk = params.every((p) => /^charset=("?)utf-8\1$/i.test(p));
  if (type.toLowerCase() !== "application/json" || !paramsOk)
    throw new ApiFailure(
      "BAD_REQUEST",
      "Content-Type must be application/json.",
    );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  requireJson(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiFailure("BAD_REQUEST", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiFailure(
      "BAD_REQUEST",
      "The request body must be a JSON object.",
    );
  return body as Record<string, unknown>;
}

/**
 * Like readJsonObject, but an empty body means `{}` (for actions whose body is optional, such as
 * cancel). The content type must still be application/json; a non-empty body must be a JSON object.
 */
export async function readOptionalJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  requireJson(request);
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ApiFailure("BAD_REQUEST", "The request body could not be read.");
  }
  if (text.trim() === "") return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiFailure("BAD_REQUEST", "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiFailure(
      "BAD_REQUEST",
      "The request body must be a JSON object.",
    );
  return body as Record<string, unknown>;
}

/** Rejects keys outside the whitelist (never spread a body into an update). */
export function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: string[],
): void {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body))
    if (!allowed.includes(k)) fields[k] = "Unknown field.";
  if (Object.keys(fields).length) throw validationFailed(fields);
}

/**
 * The caller's IP for rate limits (T-102, LOW-4).
 * On Vercel (`VERCEL=1`) only the platform's own headers are trusted: `x-vercel-forwarded-for`,
 * then `x-real-ip`. Vercel sets both itself, so a client cannot choose them. A client-sent
 * `x-forwarded-for` is never read there, because a new value per request would reset the limit.
 * Anywhere else (local dev, CI, tests) there is no trusted proxy, so the first `x-forwarded-for`
 * value is used; that keeps tests able to act as separate clients and is NOT safe on the internet.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  if (process.env.VERCEL) {
    return (
      h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip")?.trim() ||
      "unknown"
    );
  }
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
