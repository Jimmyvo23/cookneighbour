"use client";
// Small building blocks for the chef application page (T-033).
import { useEffect, useId, useState } from "react";
import { ApiClientError } from "@/lib/api/client";
import { describeError, type FieldErrors } from "@/lib/chef/form";

export const cardCls =
  "flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700";
export const hintCls = "text-sm text-zinc-700 dark:text-zinc-300";
export const buttonCls =
  "min-h-11 rounded-md bg-emerald-800 px-4 font-semibold text-white hover:bg-emerald-900 disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
export const secondaryButtonCls =
  "min-h-11 rounded-md border-2 border-emerald-800 px-4 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:text-emerald-200 dark:hover:bg-emerald-950";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cardCls}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * State for one section's action: busy flag, error and success messages, field errors, and focus.
 * After ANY error focus moves to the first invalid field in the section's root element, else to
 * the error message (lessons-learned section 3).
 */
export function useSection() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const alertId = useId();

  useEffect(() => {
    if (!tick) return;
    // The alert is a direct child of the section's form, so its parent is the scope to search.
    const alert = document.getElementById(alertId);
    const bad = alert?.parentElement?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    (bad ?? alert)?.focus();
  }, [tick, alertId]);

  function fail(message: string, fields: FieldErrors = {}) {
    setNotice(null);
    setError(message);
    setFieldErrors(fields);
    setTick((t) => t + 1);
  }

  /** Runs `action`; shows `success` afterwards. Any thrown error becomes a clear message
   *  (`describe` and `fields` let a page word its own errors, for example dollars instead of cents). */
  async function run(
    action: () => Promise<void>,
    success: string,
    opts: {
      describe?: (err: unknown) => string;
      fields?: (f: FieldErrors) => FieldErrors;
    } = {},
  ) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await action();
      setNotice(success);
    } catch (err) {
      const raw = err instanceof ApiClientError ? err.fields : {};
      fail(
        (opts.describe ?? describeError)(err),
        opts.fields ? opts.fields(raw) : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  return { error, notice, fieldErrors, busy, alertId, run, fail };
}

export function Alert({ id, message }: { id: string; message: string | null }) {
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

export function Notice({ message }: { message: string | null }) {
  return (
    <p
      role="status"
      className={
        message
          ? "text-sm font-medium text-emerald-900 dark:text-emerald-300"
          : "sr-only"
      }
    >
      {message}
    </p>
  );
}

export function TextAreaField({
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
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
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
        <p id={`${id}-hint`} className={hintCls}>
          {hint}
        </p>
      )}
      <textarea
        id={id}
        name={name}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-base text-zinc-900 aria-[invalid=true]:border-red-700 dark:bg-zinc-900 dark:text-zinc-100"
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

export function CheckboxRow({
  id,
  checked,
  onChange,
  disabled,
  children,
  describedBy,
  invalid,
}: {
  invalid?: boolean;
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  describedBy?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-400 px-3 py-2"
    >
      <input
        id={id}
        type="checkbox"
        className="size-5 shrink-0"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
