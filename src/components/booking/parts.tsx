"use client";
// Small building blocks for the booking screens (T-043).
import { useEffect, useId, useRef } from "react";
import type { BookingEstimate } from "@/lib/api/types";
import { MockBadge } from "@/components/MockBadge";
import { formatDollars, formatMinutes } from "@/lib/chef/dishes";
import {
  fieldDomId,
  orderedErrors,
  type FieldErrors,
} from "@/lib/booking/form";

export const inputCls =
  "min-h-11 w-full rounded-md border border-zinc-400 bg-white px-3 text-base text-zinc-900 aria-[invalid=true]:border-red-700 aria-[invalid=true]:border-2 dark:bg-zinc-900 dark:text-zinc-100";
export const errCls = "text-sm font-medium text-red-700 dark:text-red-400";
export const warnBoxCls =
  "rounded-md border-2 border-amber-700 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50";
export const dangerBoxCls =
  "rounded-md border-2 border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100";
export const infoBoxCls =
  "rounded-md border border-zinc-400 bg-zinc-50 p-3 text-sm dark:border-zinc-600 dark:bg-zinc-900";

/** A labelled text input with its error text tied to it. `errorKey` is the contract's dotted key. */
export function Input({
  label,
  errorKey,
  error,
  hint,
  ...rest
}: {
  label: string;
  errorKey: string;
  error?: string;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">) {
  const id = fieldDomId(errorKey);
  const described =
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
          className="text-sm text-zinc-700 dark:text-zinc-300"
        >
          {hint}
        </p>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={inputCls}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className={errCls}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  errorKey,
  error,
  hint,
  ...rest
}: {
  label: string;
  errorKey: string;
  error?: string;
  hint?: string;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id">) {
  const id = fieldDomId(errorKey) + "-notes";
  const described =
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
          className="text-sm text-zinc-700 dark:text-zinc-300"
        >
          {hint}
        </p>
      )}
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className={`${inputCls} py-2`}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className={errCls}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A question answered by radios or a group of checkboxes. The fieldset itself can take focus (the
 * error summary links to it) and carries its error text in its description.
 */
export function Question({
  legend,
  errorKey,
  error,
  hint,
  children,
}: {
  legend: string;
  errorKey: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = fieldDomId(errorKey);
  const described =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={described}
      className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
    >
      <legend className="px-1 text-base font-semibold">{legend}</legend>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-sm text-zinc-700 dark:text-zinc-300"
        >
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className={errCls}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** A checkbox or radio with a label and an optional description. */
export function Choice({
  type,
  name,
  label,
  description,
  checked,
  onChange,
  disabled,
  value,
  id,
  invalid,
}: {
  type: "checkbox" | "radio";
  name?: string;
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  value?: string;
  id?: string;
  invalid?: boolean;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex items-start gap-3">
      <input
        id={cid}
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={description ? `${cid}-desc` : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-emerald-800"
      />
      <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
        <label htmlFor={cid} className="min-h-6 font-medium">
          {label}
        </label>
        {description && (
          <div
            id={`${cid}-desc`}
            className="text-sm text-zinc-700 dark:text-zinc-300"
          >
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Error summary at the top of a form. It takes focus when it appears or changes (lessons-learned
 * section 3) and each message links to the field it is about.
 */
export function ErrorSummary({
  errors,
  focusTick,
  title = "Please fix these answers",
}: {
  errors: FieldErrors;
  focusTick: number;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = orderedErrors(errors);
  useEffect(() => {
    if (focusTick && items.length) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new attempt moves focus
  }, [focusTick]);
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-testid="error-summary"
      className={dangerBoxCls}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="mt-1 list-disc pl-5">
        {items.map((e) => (
          <li key={e.key}>
            <a
              href={`#${fieldDomId(e.key)}`}
              className="font-medium underline"
              onClick={(ev) => {
                const target = document.getElementById(fieldDomId(e.key));
                if (target) {
                  ev.preventDefault();
                  target.focus();
                  target.scrollIntoView?.({ block: "center" });
                }
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row of the estimate. */
function Line({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: string;
  strong?: boolean;
  note?: string;
}) {
  return (
    <div
      className={`flex flex-wrap justify-between gap-x-4 gap-y-0 py-1 ${strong ? "border-t border-zinc-400 pt-2 font-semibold" : ""}`}
    >
      <dt className="[overflow-wrap:anywhere]">
        {label}
        {note && (
          <span className="block text-sm font-normal text-zinc-700 dark:text-zinc-300">
            {note}
          </span>
        )}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export type EstimateShape = Pick<
  BookingEstimate,
  | "cookMinutes"
  | "labourCents"
  | "ingredientsCents"
  | "travelCents"
  | "platformFeeCents"
  | "platformFeePercent"
  | "totalCents"
  | "currency"
  | "distanceKm"
  | "travelRateCentsPerKm"
> &
  Partial<
    Pick<BookingEstimate, "labourBeforeWaiverCents" | "freeTrialWaivedCents">
  >;

/**
 * The estimate lines (CLAUDE.md 6.4 step 4). Every amount is an estimate; the platform fee is
 * shown and never collected (MOCK).
 */
export function EstimateLines({
  e,
  locationType,
  freeTrial,
  visits,
}: {
  e: EstimateShape;
  locationType: "customer_home" | "chef_home";
  freeTrial: boolean;
  visits: number;
}) {
  const waived = e.freeTrialWaivedCents ?? 0;
  const money = (c: number) => formatDollars(c);
  return (
    <dl data-testid="estimate" className="flex flex-col">
      <Line
        label="Total cooking time"
        value={formatMinutes(e.cookMinutes)}
        note="Added up from the dishes you picked"
      />
      {freeTrial && waived > 0 ? (
        <>
          <Line
            label="Labour before the free first booking"
            value={money(e.labourBeforeWaiverCents ?? e.labourCents + waived)}
          />
          <Line
            label="Free first booking"
            value={`-${money(waived)}`}
            note="Labour is waived once per customer"
          />
          <Line label="Labour you pay" value={money(e.labourCents)} />
        </>
      ) : (
        <Line
          label="Labour"
          value={money(e.labourCents)}
          note={
            freeTrial
              ? "Free first booking"
              : "Cooking time times the chef's hourly rate"
          }
        />
      )}
      <Line
        label="Ingredients (estimated)"
        value={money(e.ingredientsCents)}
        note="Paid at cost, with no markup"
      />
      {locationType === "customer_home" ? (
        <Line
          label="Travel fee"
          value={money(e.travelCents)}
          note={
            e.distanceKm === null
              ? undefined
              : `About ${e.distanceKm} km one way at ${money(e.travelRateCentsPerKm)} per km, for ${visits} ${visits === 1 ? "visit" : "visits"}`
          }
        />
      ) : (
        <Line
          label="Travel fee"
          value={money(0)}
          note="None: you pick up the meals at the chef's home"
        />
      )}
      <Line
        label="Estimated total"
        value={`${money(e.totalCents)} ${e.currency}`}
        strong
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <MockBadge>MOCK</MockBadge>
        <span data-testid="platform-fee">
          Platform fee ({e.platformFeePercent}% of labour):{" "}
          {money(e.platformFeeCents)}. Shown only, not collected, and not
          included in the total.
        </span>
      </div>
    </dl>
  );
}

/** The MOCK payment step (D-18). Nothing is charged and no card is asked for. */
export function MockPayment() {
  return (
    <section
      aria-labelledby="pay-h"
      data-testid="mock-payment"
      className="flex flex-col gap-2 rounded-md border-2 border-amber-600 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50"
    >
      <h2
        id="pay-h"
        className="flex flex-wrap items-center gap-2 text-lg font-semibold"
      >
        Payment <MockBadge>MOCK</MockBadge>
      </h2>
      <p className="text-sm">
        This is a prototype. Sending the request does not charge you and asks
        for no card number. Real payments are not connected, so the amounts
        above are what you would owe in a real booking.
      </p>
    </section>
  );
}
