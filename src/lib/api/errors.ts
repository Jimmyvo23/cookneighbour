// API error type and response helpers (contract section 1). No secrets, hashes or stack traces
// ever reach a response body.
import type { ApiError, ApiErrorCode } from "./types";

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_IN_USE: 409,
  PHONE_IN_USE: 409,
  PHONE_NOT_SUBMITTED: 409,
  PHONE_NOT_VERIFIED: 409,
  INVALID_STATE: 409,
  APPLICATION_INCOMPLETE: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly extra: Omit<ApiError["error"], "code" | "message">;
  constructor(
    code: ApiErrorCode,
    message: string,
    extra: Omit<ApiError["error"], "code" | "message"> = {},
  ) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function errorResponse(e: ApiFailure): Response {
  const body: ApiError = {
    error: { code: e.code, message: e.message, ...e.extra },
  };
  const headers: Record<string, string> = { ...NO_STORE };
  if (e.code === "RATE_LIMITED" && e.extra.retryAfterSeconds !== undefined)
    headers["Retry-After"] = String(e.extra.retryAfterSeconds);
  return Response.json(body, { status: e.status, headers });
}

export function validationFailed(fields: Record<string, string>): ApiFailure {
  return new ApiFailure("VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });
}

/** Runs a handler; converts ApiFailure to its JSON error and anything else to a generic 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFailure) return errorResponse(e);
    // Details go to the server log only (never the body). Log the message, not the object,
    // so request data cannot leak by accident.
    console.error(
      "api: unhandled error:",
      e instanceof Error ? e.message : "unknown",
    );
    return errorResponse(
      new ApiFailure("INTERNAL", "Something went wrong. Please try again."),
    );
  }
}
