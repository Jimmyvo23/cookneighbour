import { mockAllowed } from "@/lib/mock-guard";
import type { ApiError, ApiErrorCode, BookingIssue } from "@/lib/api/types";

/** MOCK switch. The mock adapter runs only when NEXT_PUBLIC_API_MOCK is exactly "1" and the code
 *  is not on Vercel (T-118: fails closed, see src/lib/mock-guard.ts). Unset, blank or anything
 *  else means the real routes (also in development).
 *  Each variable is written out in full so Next.js can inline it into the browser bundle. */
export function isMockEnabled(): boolean {
  return mockAllowed({
    NEXT_PUBLIC_API_MOCK: process.env.NEXT_PUBLIC_API_MOCK,
    NEXT_PUBLIC_MOCK_BLOCKED: process.env.NEXT_PUBLIC_MOCK_BLOCKED,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    // Server only (undefined in the browser, where the two NEXT_PUBLIC_ names above apply).
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_REGION: process.env.VERCEL_REGION,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
  });
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK" | "TIMEOUT" | "UNKNOWN";
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly missing?: string[];
  /** DATE_BOOKED: the dates (YYYY-MM-DD) that have an open booking. */
  readonly dates?: string[];
  /** Booking requests (T-042): every domain problem the server found. */
  readonly issues?: BookingIssue[];
  /** INVALID_STATE on a booking change (T-063): a stable reason code. */
  readonly reason?: string;
  /** VALIDATION_FAILED on a pickup time (T-063): the first instant that is too late (ISO). */
  readonly latest?: string;

  constructor(
    status: number,
    code: ApiClientError["code"],
    message: string,
    extra: {
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
      missing?: string[];
      dates?: string[];
      issues?: BookingIssue[];
      reason?: string;
      latest?: string;
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
    this.issues = extra.issues;
    this.reason = extra.reason;
    this.latest = extra.latest;
  }
}

/** One timeout for every call through `apiFetch`: waiting for the answer and reading its body. */
export const API_TIMEOUT_MS = 20_000;

const TIMEOUT_READ = "The server took too long to answer. Please try again.";
/** A write may have reached the server before the wait ran out, so do not promise either way. */
const TIMEOUT_WRITE =
  "The server took too long to answer. Your change may or may not have gone through. Check before you try again.";

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
  const controller = new AbortController();
  init.signal = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ApiClientError(
          0,
          "TIMEOUT",
          method === "GET" ? TIMEOUT_READ : TIMEOUT_WRITE,
        ),
      );
      controller.abort(); // after reject, so the abort's own failure cannot win the race
    }, API_TIMEOUT_MS);
  });
  // The timer covers the whole exchange, body included; the real fetch also aborts through the
  // signal. The race stands in for fetch implementations (tests, mock adapter) that ignore it.
  const exchange = async (): Promise<{ res: Response; data: unknown }> => {
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
    return { res, data };
  };
  let res: Response;
  let data: unknown;
  try {
    const work = exchange();
    work.catch(() => {}); // a late failure after the timeout is already handled
    ({ res, data } = await Promise.race([work, timedOut]));
  } finally {
    clearTimeout(timer);
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
    issues: err.issues,
    reason: err.reason,
    latest: err.latest,
  });
}

/** Human text for a 429 retry time. */
export function formatRetry(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
  const m = Math.ceil(seconds / 60);
  return m === 1 ? "1 minute" : `${m} minutes`;
}
