"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { nextOnboardingStep } from "@/lib/auth/route-guard";
import type {
  AddressRequest,
  AddressResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PhoneSubmitRequest,
  PhoneSubmitResponse,
  PhoneVerifyRequest,
  PhoneVerifyResponse,
  SignUpRequest,
  SignUpResponse,
  SignUpRole,
} from "@/lib/api/types";
import {
  validateAddress,
  validateCode,
  validateLogin,
  validatePhone,
  validateSignUp,
} from "@/lib/validation/auth";
import {
  FormAlert,
  Page,
  SubmitButton,
  TextField,
  useApiForm,
} from "@/components/forms";
import { MockBadge } from "@/components/MockBadge";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

export function SignUpForm() {
  const router = useRouter();
  const [role, setRole] = useState<SignUpRole>("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const f = useApiForm<SignUpRequest, SignUpResponse>({
    validate: validateSignUp,
    send: (body) => apiFetch("/api/auth/signup", { method: "POST", body }),
    onSuccess: (r) =>
      r.signedIn ? router.push("/verify-phone") : setCheckEmail(true),
  });
  if (checkEmail)
    return (
      <Page title="Check your email">
        <p role="status">
          We sent you a link to confirm your email. Then{" "}
          <Link className={linkCls} href="/login">
            log in
          </Link>
          .
        </p>
      </Page>
    );
  return (
    <Page title="Create your account">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => f.submit(e, { email, password, displayName, role })}
      >
        <FormAlert message={f.formError} id={f.alertId} />
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={f.errors.role ? "field-role-error" : undefined}
        >
          <legend className="text-sm font-medium">I want to</legend>
          {(
            [
              ["customer", "Hire a home cook (customer)"],
              ["chef", "Cook for others (chef)"],
            ] as const
          ).map(([v, l]) => (
            <label
              key={v}
              className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-400 px-3"
            >
              <input
                type="radio"
                name="role"
                value={v}
                checked={role === v}
                onChange={() => setRole(v)}
              />
              {l}
            </label>
          ))}
          {f.errors.role && (
            <p
              id="field-role-error"
              className="text-sm font-medium text-red-700"
            >
              {f.errors.role}
            </p>
          )}
        </fieldset>
        <TextField
          label="Your name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={f.errors.displayName}
          hint={
            role === "chef" ? "Shown publicly on your chef profile." : undefined
          }
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={f.errors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={f.errors.password}
          hint="8 to 72 characters."
        />
        <SubmitButton busy={f.busy}>Sign up</SubmitButton>
      </form>
      <p>
        Already have an account?{" "}
        <Link className={linkCls} href="/login">
          Log in
        </Link>
      </p>
    </Page>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const f = useApiForm<LoginRequest, LoginResponse & { next: string }>({
    validate: validateLogin,
    send: async (body) => {
      const r = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body,
      });
      // Logged in. Work out the next onboarding step from GET /api/me; if that read fails,
      // go home (the account bar re-checks the session anyway).
      let next = "/";
      try {
        const me = await apiFetch<MeResponse>("/api/me");
        next = nextOnboardingStep(me) ?? "/";
      } catch {
        // keep "/"
      }
      return { ...r, next };
    },
    onSuccess: (r) => router.push(r.next),
  });
  return (
    <Page title="Log in">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => f.submit(e, { email, password })}
      >
        <FormAlert message={f.formError} id={f.alertId} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={f.errors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={f.errors.password}
        />
        <SubmitButton busy={f.busy}>Log in</SubmitButton>
      </form>
      <p>
        New here?{" "}
        <Link className={linkCls} href="/signup">
          Create an account
        </Link>
      </p>
    </Page>
  );
}

export function PhoneVerifyForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<PhoneSubmitResponse | null>(null);
  const submitForm = useApiForm<PhoneSubmitRequest, PhoneSubmitResponse>({
    validate: validatePhone,
    send: (body) => apiFetch("/api/me/phone", { method: "POST", body }),
    onSuccess: setSent,
  });
  const verifyForm = useApiForm<PhoneVerifyRequest, PhoneVerifyResponse>({
    validate: validateCode,
    send: (body) => apiFetch("/api/me/phone/verify", { method: "POST", body }),
    onSuccess: () => router.push("/address"),
  });
  return (
    <Page title="Verify your phone">
      <MockBadge>
        MOCK — no real SMS is sent; any 6-digit code works in demo mode
      </MockBadge>
      {!sent ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => submitForm.submit(e, { phone })}
        >
          <FormAlert message={submitForm.formError} id={submitForm.alertId} />
          <TextField
            label="Mobile phone number"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={submitForm.errors.phone}
            hint="Canadian number, for example 416 555 0123. Chefs see it only after they accept your booking."
          />
          <SubmitButton busy={submitForm.busy}>Send code</SubmitButton>
        </form>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => verifyForm.submit(e, { code })}
        >
          <p role="status">
            {sent.mockHint} Number: {sent.phoneMasked}
          </p>
          <FormAlert message={verifyForm.formError} id={verifyForm.alertId} />
          <TextField
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={verifyForm.errors.code}
            autoFocus
          />
          <SubmitButton busy={verifyForm.busy}>Verify</SubmitButton>
          <button
            type="button"
            className={`${linkCls} min-h-11 text-left`}
            onClick={() => {
              setSent(null);
              setCode("");
            }}
          >
            Use a different number
          </button>
        </form>
      )}
    </Page>
  );
}

export function AddressForm() {
  const router = useRouter();
  const [line, setLine] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const f = useApiForm<AddressRequest, AddressResponse>({
    validate: validateAddress,
    send: (body) => apiFetch("/api/me/address", { method: "PUT", body }),
    onSuccess: () => router.push("/"),
  });
  return (
    <Page title="Your home address">
      <p className="text-zinc-700 dark:text-zinc-300">
        This address is private. It is used only for the free-trial rule (one
        free booking per home) and for your bookings. A chef sees it only after
        they accept a booking at your home.
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => f.submit(e, { line, city, postalCode })}
      >
        <FormAlert message={f.formError} id={f.alertId} />
        <TextField
          label="Street address"
          name="line"
          autoComplete="address-line1"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          error={f.errors.line}
        />
        <TextField
          label="City"
          name="city"
          autoComplete="address-level2"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          error={f.errors.city}
        />
        <TextField
          label="Postal code"
          name="postalCode"
          autoComplete="postal-code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          error={f.errors.postalCode}
          hint="Greater Toronto Area only, e.g. L5B 1M2."
        />
        <SubmitButton busy={f.busy}>Save address</SubmitButton>
      </form>
    </Page>
  );
}
