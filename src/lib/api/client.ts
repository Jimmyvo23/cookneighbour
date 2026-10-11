import type { ApiError, ApiErrorCode } from "@/lib/api/types";

/** MOCK switch. The mock adapter runs only when NEXT_PUBLIC_API_MOCK is exactly "1".
 *  Unset, blank or anything else means the real routes (also in development). */
export function isMockEnabled(): boolean {
  return process.env.NEXT_PUBLIC_API_MOCK === "1";
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK" | "UNKNOWN";
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly missing?: string[];
  /** DATE_BOOKED: the dates (YYYY-MM-DD) that have an open booking. */
  readonly dates?: string[];

  constructor(
    status: number,
    code: ApiClientError["code"],
    message: string,
    extra: {
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
      missing?: string[];
      dates?: string[];
    } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? {};
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.missing = extra.missing;
    this.dates = extra.dates;
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to isMockEnabled(). */
  mock?: boolean;
}

/** The single fetch helper. Always sends Content-Type: application/json (the contract's CSRF rule,
 *  including login, logout and body-less calls) and parses the contract's error shape. */
export async function apiFetch<T>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const useMock = opts.mock ?? isMockEnabled();
  let res: Response;
  try {
    if (useMock) {
      // Loaded only in the mock branch, so the adapter is not part of a normal run.
      const { mockFetch } = await import("@/lib/mocks/mock-adapter");
      res = await mockFetch(path, init);
    } else {
      res = await (opts.fetchImpl ?? fetch)(path, init);
    }
  } catch {
    throw new ApiClientError(
      0,
      "NETWORK",
      "Could not reach the server. Check your connection and try again.",
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok) return data as T;

  const err = (data as Partial<ApiError> | null)?.error;
  if (!err || typeof err.message !== "string") {
    throw new ApiClientError(
      res.status,
      "UNKNOWN",
      "Something went wrong. Please try again.",
    );
  }
  let retry = err.retryAfterSeconds;
  if (res.status === 429 && retry === undefined) {
    const header = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(header) && header > 0) retry = header;
  }
  throw new ApiClientError(res.status, err.code, err.message, {
    fields: err.fields,
    retryAfterSeconds: retry,
    missing: err.missing,
    dates: err.dates,
  });
}

/** Human text for a 429 retry time. */
export function formatRetry(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
  const m = Math.ceil(seconds / 60);
  return m === 1 ? "1 minute" : `${m} minutes`;
}
