// Client-side form checks. They mirror the contract's rules so users get fast feedback; the server
// still validates everything. Each function returns field errors keyed by request field name.
import type {
  AddressRequest,
  LoginRequest,
  PhoneSubmitRequest,
  PhoneVerifyRequest,
  SignUpRequest,
} from "@/lib/api/types";

import { hasUnsafeText } from "@/lib/domain/chef-application";

export type FieldErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

/** Display name rule shared by sign-up and the chef page: 1 to 80 characters, plain text only
 *  (control characters and lone surrogates are refused, same helper the chef routes use).
 *  Returns a message or null. Client-side only; the server check is tracked in T-059. */
export function displayNameProblem(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return "Enter your name.";
  if (name.length > 80) return "Use 80 characters or fewer.";
  if (hasUnsafeText(name))
    return "Use plain text. Control characters are not allowed.";
  return null;
}

export function validateSignUp(
  v: Partial<Record<keyof SignUpRequest, unknown>>,
): FieldErrors {
  const e: FieldErrors = {};
  const email = typeof v.email === "string" ? v.email.trim() : "";
  const password = typeof v.password === "string" ? v.password : "";
  if (!EMAIL.test(email)) e.email = "Enter a valid email address.";
  if (password.length < 8) e.password = "Use at least 8 characters.";
  else if (password.length > 72) e.password = "Use 72 characters or fewer.";
  if (v.role !== "customer" && v.role !== "chef")
    e.role = "Choose customer or chef.";
  const nameProblem = displayNameProblem(v.displayName);
  if (nameProblem) e.displayName = nameProblem;
  return e;
}

export function validateLogin(
  v: Partial<Record<keyof LoginRequest, unknown>>,
): FieldErrors {
  const e: FieldErrors = {};
  if (typeof v.email !== "string" || !EMAIL.test(v.email.trim()))
    e.email = "Enter a valid email address.";
  if (typeof v.password !== "string" || v.password.length === 0)
    e.password = "Enter your password.";
  return e;
}

export function validatePhone(
  v: Partial<Record<keyof PhoneSubmitRequest, unknown>>,
): FieldErrors {
  const digits = typeof v.phone === "string" ? v.phone.replace(/\D/g, "") : "";
  const ok =
    digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  return ok ? {} : { phone: "Enter a 10-digit Canadian phone number." };
}

export function validateCode(
  v: Partial<Record<keyof PhoneVerifyRequest, unknown>>,
): FieldErrors {
  return typeof v.code === "string" && /^\d{6}$/.test(v.code)
    ? {}
    : { code: "Enter exactly 6 digits." };
}

export function validateAddress(
  v: Partial<Record<keyof AddressRequest, unknown>>,
): FieldErrors {
  const e: FieldErrors = {};
  const line = typeof v.line === "string" ? v.line.trim() : "";
  const city = typeof v.city === "string" ? v.city.trim() : "";
  const postal = typeof v.postalCode === "string" ? v.postalCode.trim() : "";
  if (!line) e.line = "Enter your street address.";
  else if (line.length > 120) e.line = "Use 120 characters or fewer.";
  if (!city) e.city = "Enter your city.";
  else if (city.length > 80) e.city = "Use 80 characters or fewer.";
  if (!POSTAL.test(postal)) e.postalCode = "Enter a postal code like L5B 1M2.";
  return e;
}
