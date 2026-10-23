"use client";
// Small building blocks for the chef application page (T-033).
import { useEffect, useId, useState } from "react";
import { ApiClientError } from "@/lib/api/client";
import { isStateRefusal, useReportRefusal } from "@/components/refusal";
import { describeError, type FieldErrors } from "@/lib/chef/form";

export const cardCls = "card flex flex-col gap-4 p-4";
export const hintCls = "hint";
export const buttonCls = "btn";
export const secondaryButtonCls = "btn-secondary";

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
  // T-080: on a booking page a 409 goes to the page (one alert, one focus owner, one reload).
  const reportRefusal = useReportRefusal();

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
      if (reportRefusal && isStateRefusal(err)) {
        reportRefusal((opts.describe ?? describeError)(err));
        return;
      }
      const raw = err instanceof ApiClientError ? err.fields : {};
      fail(
        (opts.describe ?? describeError)(err),
        opts.fields ? opts.fields(raw) : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  /** Forget an old error or notice (for example when a confirm step reopens). */
  function clear() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  return { error, notice, fieldErrors, busy, alertId, run, fail, clear };
}

export function Alert({ id, message }: { id: string; message: string | null }) {
  return (
    <div
      id={id}
      tabIndex={-1}
      role="alert"
      className={message ? "alert-box" : "sr-only"}
    >
      {message}
    </div>
  );
}

export function Notice({ message }: { message: string | null }) {
  return (
    <p
      role="status"
      className={message ? "text-sm font-medium text-success" : "sr-only"}
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
      <label htmlFor={id} className="font-bold">
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
        className="control"
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="error-text">
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
      className="flex min-h-11 items-center gap-3 rounded-md border border-edge px-3 py-2"
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
