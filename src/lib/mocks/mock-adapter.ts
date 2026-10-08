// MOCK ADAPTER. Stands in for the auth/phone/address API routes until T-028 lands them.
// Nothing here is real: no accounts, no SMS, no storage beyond this browser tab (sessionStorage).
// Responses follow docs/api-contract.md. Switched by NEXT_PUBLIC_API_MOCK (see client.ts).
// Magic inputs for demos and tests:
//   email taken@example.com        -> 409 EMAIL_IN_USE (sign-up)
//   email limited@example.com      -> 429 RATE_LIMITED, retry 90 s (sign-up, login)
//   password "wrongpass"           -> 401 INVALID_CREDENTIALS (login)
//   phone ending 0000              -> 409 PHONE_IN_USE
//   postal code not starting M or L -> 422 "Not a GTA postal code." (MOCK approximation)
import type {
  AddressRequest,
  AddressResponse,
  ApiError,
  ApiErrorCode,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeProfile,
  MeResponse,
  PhoneSubmitRequest,
  PhoneSubmitResponse,
  PhoneVerifyRequest,
  PhoneVerifyResponse,
  SignUpRequest,
  SignUpResponse,
} from "@/lib/api/types";
import {
  validateAddress,
  validateCode,
  validateLogin,
  validatePhone,
  validateSignUp,
} from "@/lib/validation/auth";

interface MockState {
  profile: MeProfile | null;
  /** Masked only (e.g. "+1******0123"); the full number is never kept. */
  phone: string | null;
  phoneVerified: boolean;
  address: AddressResponse["address"] | null;
}

const KEY = "cookneighbour-mock-api-state";
const EMPTY: MockState = {
  profile: null,
  phone: null,
  phoneVerified: false,
  address: null,
};
let memory: MockState = { ...EMPTY };

function load(): MockState {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* fall through to memory */
  }
  return memory;
}
function save(s: MockState) {
  memory = s;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* memory only */
  }
}
/** Test helper. */
export function resetMockState() {
  memory = { ...EMPTY };
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Partial<ApiError["error"]> = {},
) {
  const body: ApiError = { error: { code, message, ...extra } };
  return json(
    status,
    body,
    extra.retryAfterSeconds
      ? { "Retry-After": String(extra.retryAfterSeconds) }
      : {},
  );
}
function validation(fields: Record<string, string>) {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });
}
function rateLimited() {
  return fail(429, "RATE_LIMITED", "Too many attempts.", {
    retryAfterSeconds: 90,
  });
}
function mask(e164: string) {
  return `+1******${e164.slice(-4)}`;
}
function toE164(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `+1${d.length === 11 ? d.slice(1) : d}`;
}

function me(s: MockState): MeResponse {
  return {
    profile: s.profile!,
    private: {
      phoneMasked: s.phone,
      phoneVerified: s.phoneVerified,
      address: s.address,
    },
    chef: null,
  };
}

export async function mockFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  await new Promise((r) => setTimeout(r, 150)); // feel like a network call
  const method = init.method ?? "GET";
  const hdrs = new Headers(init.headers);
  if (hdrs.get("Content-Type") !== "application/json") {
    return fail(400, "BAD_REQUEST", "Content-Type must be application/json.");
  }
  let body: unknown = {};
  if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      return fail(400, "BAD_REQUEST", "Malformed JSON.");
    }
  }
  const s = load();
  const route = `${method} ${path}`;

  if (route === "POST /api/auth/signup") {
    const b = body as SignUpRequest;
    const fields = validateSignUp(b);
    if (Object.keys(fields).length) return validation(fields);
    if (b.email.toLowerCase() === "limited@example.com") return rateLimited();
    if (b.email.toLowerCase() === "taken@example.com")
      return fail(409, "EMAIL_IN_USE", "That email already has an account.");
    if (s.profile)
      return fail(409, "INVALID_STATE", "You are already signed in.");
    const profile: MeProfile = {
      id: "mock-user-1",
      role: b.role,
      displayName: b.displayName.trim(),
      country: "CA",
      currency: "CAD",
      language: "en",
    };
    save({ ...EMPTY, profile });
    return json(201, {
      user: profile,
      signedIn: true,
    } satisfies SignUpResponse);
  }

  if (route === "POST /api/auth/login") {
    const b = body as LoginRequest;
    const fields = validateLogin(b);
    if (Object.keys(fields).length) return validation(fields);
    if (b.email.toLowerCase() === "limited@example.com") return rateLimited();
    if (b.password === "wrongpass")
      return fail(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const profile: MeProfile = s.profile ?? {
      id: "mock-user-1",
      role: "customer",
      displayName: "Demo customer",
      country: "CA",
      currency: "CAD",
      language: "en",
    };
    save({ ...s, profile });
    return json(200, { user: profile } satisfies LoginResponse);
  }

  if (route === "POST /api/auth/logout") {
    save({ ...EMPTY });
    return json(200, { ok: true } satisfies LogoutResponse);
  }

  // Everything below needs a session.
  if (!s.profile) {
    return fail(401, "UNAUTHENTICATED", "Please log in first.");
  }

  if (route === "GET /api/me") return json(200, me(s));

  if (route === "POST /api/me/phone") {
    const b = body as PhoneSubmitRequest;
    const fields = validatePhone(b);
    if (Object.keys(fields).length) return validation(fields);
    const e164 = toE164(b.phone);
    if (e164.endsWith("0000"))
      return fail(409, "PHONE_IN_USE", "That phone number can't be used.");
    save({ ...s, phone: mask(e164), phoneVerified: false });
    return json(200, {
      phoneMasked: mask(e164),
      mock: true,
      mockHint: "MOCK: no SMS was sent. Enter any 6 digits.",
    } satisfies PhoneSubmitResponse);
  }

  if (route === "POST /api/me/phone/verify") {
    const b = body as PhoneVerifyRequest;
    const fields = validateCode(b);
    if (Object.keys(fields).length) return validation(fields);
    if (!s.phone)
      return fail(409, "PHONE_NOT_SUBMITTED", "Submit a phone number first.");
    save({ ...s, phoneVerified: true });
    return json(200, {
      phoneVerified: true,
      mock: true,
    } satisfies PhoneVerifyResponse);
  }

  if (route === "PUT /api/me/address") {
    const b = body as AddressRequest;
    const fields = validateAddress(b);
    if (!fields.postalCode && !/^[ML]/i.test(b.postalCode.trim()))
      fields.postalCode = "Not a GTA postal code.";
    if (Object.keys(fields).length) return validation(fields);
    const postalCode = b.postalCode.replace(/[\s-]/g, "").toUpperCase();
    const address = {
      line: b.line.trim(),
      city: b.city.trim(),
      postalCode,
      postalPrefix: postalCode.slice(0, 3),
    };
    save({ ...s, address });
    return json(200, { address } satisfies AddressResponse);
  }

  return fail(404, "NOT_FOUND", "Not found.");
}
