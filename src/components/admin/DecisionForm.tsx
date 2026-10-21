"use client";
// Admin decision form (T-049): resolve or dismiss a report, or resolve a booking flag. The note is
// stored for the admin only; the people on the booking never read it. A decision is final.
import { useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { buttonCls, secondaryButtonCls } from "@/components/chef/parts";
import { dangerBoxCls, errCls, inputCls } from "@/components/booking/parts";
import {
  NOTE_MAX,
  decisionEffectText,
  decisionErrorText,
  finalStatusChoices,
  parseDecisionForm,
  type DecisionKind,
  type Fields,
} from "@/lib/engagement/rules";
import type {
  AdminDecisionResponse,
  FinalBookingStatus,
} from "@/lib/api/types";

export function DecisionForm({
  kind,
  path,
  bookingStatus,
  anyDayCooked,
  isFreeTrial,
  onDone,
  onCancel,
}: {
  kind: DecisionKind;
  path: string;
  bookingStatus: string;
  anyDayCooked: boolean;
  /** null when the list does not say (reports). */
  isFreeTrial: boolean | null;
  onDone: (r: AdminDecisionResponse) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [finalStatus, setFinalStatus] = useState("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  const needsStatus =
    kind === "flag" || (kind === "resolve" && bookingStatus === "accepted");
  const optionalStatus = kind === "resolve" && bookingStatus === "completed";
  const showStatus = needsStatus || optionalStatus;
  const heading =
    kind === "dismiss"
      ? "Dismiss this report"
      : kind === "resolve"
        ? "Resolve this report"
        : "Resolve this flag";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = parseDecisionForm({
      kind,
      bookingStatus,
      finalStatus,
      note,
    });
    if (!parsed.ok) {
      setFields(parsed.fields);
      setError(null);
      (parsed.fields.finalStatus ? statusRef : noteRef).current?.focus();
      return;
    }
    setFields({});
    setError(null);
    setBusy(true);
    try {
      const r = await apiFetch<AdminDecisionResponse>(path, {
        method: "POST",
        body: parsed.request,
      });
      onDone(r);
    } catch (err) {
      setError(decisionErrorText(err));
      setBusy(false);
      queueMicrotask(() => errRef.current?.focus());
    }
  }

  const chosen = finalStatusChoices().some((c) => c.value === finalStatus)
    ? (finalStatus as FinalBookingStatus)
    : null;

  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid="decision-form"
      aria-labelledby={`${uid}-h`}
      className="flex flex-col gap-3 rounded-md border-2 border-zinc-500 p-3"
    >
      <h3 id={`${uid}-h`} className="font-semibold">
        {heading}
      </h3>
      <p className="text-sm">
        This is final. The note is kept for admins only; the customer and the
        chef never see it.
        {kind === "dismiss" && " Dismissing does not change the booking."}
      </p>
      {showStatus && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-s`} className="text-sm font-medium">
            {optionalStatus
              ? "Change the booking status (optional)"
              : "Status the booking gets"}
          </label>
          <select
            id={`${uid}-s`}
            ref={statusRef}
            value={finalStatus}
            onChange={(e) => setFinalStatus(e.target.value)}
            aria-invalid={fields.finalStatus ? true : undefined}
            aria-describedby={fields.finalStatus ? `${uid}-se` : undefined}
            className={inputCls}
          >
            <option value="">
              {optionalStatus ? "Keep it completed" : "Choose a status"}
            </option>
            {finalStatusChoices()
              .filter((c) => !optionalStatus || c.value !== "completed")
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </select>
          {fields.finalStatus && (
            <p id={`${uid}-se`} className={errCls}>
              {fields.finalStatus}
            </p>
          )}
          {chosen && (
            <p data-testid="decision-effect" className="text-sm">
              {decisionEffectText(
                chosen,
                anyDayCooked,
                isFreeTrial,
                optionalStatus,
              )}
            </p>
          )}
        </div>
      )}
      {kind === "resolve" && !showStatus && (
        <p className="text-sm">
          This booking is already finished, so resolving only closes the report.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-n`} className="text-sm font-medium">
          Note (3 to {NOTE_MAX} characters, required)
        </label>
        <textarea
          id={`${uid}-n`}
          ref={noteRef}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={fields.note ? true : undefined}
          aria-describedby={fields.note ? `${uid}-ne` : undefined}
          className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-base text-zinc-900 aria-[invalid=true]:border-2 aria-[invalid=true]:border-red-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {fields.note && (
          <p id={`${uid}-ne`} className={errCls}>
            {fields.note}
          </p>
        )}
      </div>
      <div
        ref={errRef}
        tabIndex={-1}
        role="alert"
        data-testid="decision-error"
        className={error ? dangerBoxCls : "sr-only"}
      >
        {error}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" aria-disabled={busy} className={buttonCls}>
          {busy ? "Saving..." : "Confirm decision"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonCls}>
          Cancel
        </button>
      </div>
    </form>
  );
}
