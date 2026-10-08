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

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  return (
    xff?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"
  );
}
