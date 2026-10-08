"use client";
import { useEffect, useId, useState } from "react";
import { ApiClientError, formatRetry } from "@/lib/api/client";
import type { FieldErrors } from "@/lib/validation/auth";

export function TextField({
  label,
  name,
  error,
  hint,
  ...input
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = `field-${name}`;
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-sm text-zinc-600 dark:text-zinc-400"
        >
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 rounded-md border border-zinc-400 bg-white px-3 text-base text-zinc-900 aria-[invalid=true]:border-red-700 dark:bg-zinc-900 dark:text-zinc-100"
        {...input}
      />
      {error && (
        <p
          id={`${id}-error`}
          className="text-sm font-medium text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function FormAlert({
  message,
  id,
}: {
  message: string | null;
  id: string;
}) {
  return (
    <div
      id={id}
      tabIndex={-1}
      role="alert"
      className={
        message
          ? "rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
          : "sr-only"
      }
    >
      {message}
    </div>
  );
}

export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="min-h-11 rounded-md bg-emerald-800 px-4 font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
    >
      {busy ? "Please wait..." : children}
    </button>
  );
}

export function Page({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

/** Shared submit logic: client validation, API call, field errors, focus management. */
export function useApiForm<V, R>(opts: {
  validate: (v: V) => FieldErrors;
  send: (v: V) => Promise<R>;
  onSuccess: (r: R) => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alertId = useId();
  // The submitted form element. Focus lookups are scoped to it, because hidden earlier pages stay
  // mounted (cacheComponents) and a document-wide query could focus the wrong page.
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  // Move focus after errors render: first invalid field, else the alert.
  useEffect(() => {
    if (!focusTick) return;
    const bad = formEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (bad ?? formEl?.querySelector<HTMLElement>(`[id="${alertId}"]`))?.focus();
  }, [focusTick, formEl, alertId]);

  async function submit(e: React.FormEvent, values: V) {
    e.preventDefault();
    if (busy) return;
    setFormEl(e.currentTarget as HTMLFormElement);
    setFormError(null);
    const local = opts.validate(values);
    setErrors(local);
    if (Object.keys(local).length) {
      setFocusTick((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      opts.onSuccess(await opts.send(values));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setFormError(
          err.status === 429 && err.retryAfterSeconds
            ? `${err.message} Try again in ${formatRetry(err.retryAfterSeconds)}.`
            : err.message,
        );
      } else setFormError("Something went wrong. Please try again.");
      setFocusTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }
  return { errors, formError, busy, alertId, submit };
}
