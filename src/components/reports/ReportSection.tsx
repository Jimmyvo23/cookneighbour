"use client";
// "Report a problem" on a booking page (T-049, contract 7D). Shown on EVERY booking, in any
// status, to both the customer and the chef (CLAUDE.md 6.7).
//
// Privacy (Jimmy, 2026-10-20): a report is read only by its reporter and an admin. This section
// shows the caller's OWN reports (the server returns nothing else) and never says that the other
// person has or has not reported. One open report per person per booking: while one is open (or
// being reviewed) its status is shown instead of the form. If the server still answers 409
// `report_open`, its text is shown inside the form (focus on it) and the typed text is kept.
//
// Focus has ONE owner, this section: after an error it goes to the first invalid field, else to the
// message; after a sent report it goes to the confirmation; opening the form moves it to the
// heading of the form.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch, isMockEnabled } from "@/lib/api/client";
import { MockBadge } from "@/components/MockBadge";
import {
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
} from "@/components/chef/parts";
import {
  dangerBoxCls,
  errCls,
  infoBoxCls,
  inputCls,
} from "@/components/booking/parts";
import { NOTICE_BOX_CLS } from "@/components/booking/useAnnounce";
import { formatWhen } from "@/lib/booking/form";
import {
  DESCRIPTION_MAX,
  REPORT_CATEGORIES,
  REPORT_PRIVACY_TEXT,
  categoryLabel,
  isReportActive,
  parseReportForm,
  reportErrorText,
  reportStatusText,
  type Fields,
} from "@/lib/engagement/rules";
import type { ReportView } from "@/lib/api/types";

type View =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: ReportView[] };

export function ReportSection({
  bookingId,
  mock = isMockEnabled(),
}: {
  bookingId: string;
  mock?: boolean;
}) {
  const hid = useId();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(0);
  const seq = useRef(0);
  // Answers that arrive after the page left (or a newer load) are ignored.
  const cancelRequests = useCallback(() => {
    seq.current++;
  }, []);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      openerRef.current?.focus();
    }
  }, [open]);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) setView({ kind: "loading" });
      try {
        const r = await apiFetch<{ items: ReportView[] }>(
          `/api/bookings/${encodeURIComponent(bookingId)}/reports`,
        );
        if (!Array.isArray(r?.items)) throw new Error("bad shape");
        if (mine === seq.current) setView({ kind: "ready", items: r.items });
      } catch {
        if (mine === seq.current && !quiet) setView({ kind: "error" });
      }
    },
    [bookingId],
  );
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
    return cancelRequests;
  }, [load, cancelRequests]);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  const items = view.kind === "ready" ? view.items : [];
  const active = items.find((r) => isReportActive(r.status));
  const earlier = items.filter((r) => r !== active);

  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="reports"
      className={cardCls}
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Report a problem
      </h2>
      <p className={hintCls}>
        Something wrong with this booking? Tell us and an admin will look at it.{" "}
        {REPORT_PRIVACY_TEXT}
      </p>
      {mock && (
        <p data-testid="reports-mock" className={hintCls}>
          <MockBadge>MOCK</MockBadge> Reports here are simulated. They stay in
          this browser tab only and no admin receives them.
        </p>
      )}
      {sent > 0 && (
        <p
          key={sent}
          ref={sentRef}
          tabIndex={-1}
          role="status"
          data-testid="report-sent"
          className={NOTICE_BOX_CLS}
        >
          Your report was sent. An admin will look at it.
        </p>
      )}

      {view.kind === "loading" && <p role="status">Loading your reports...</p>}
      {view.kind === "error" && (
        <div data-testid="reports-load-error" className="flex flex-col gap-3">
          <p role="status" className={dangerBoxCls}>
            Your reports did not load. Check your connection and try again.
          </p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className={secondaryButtonCls}
            >
              Try loading your reports again
            </button>
          </p>
        </div>
      )}

      {view.kind === "ready" && (
        <>
          {active ? (
            <div data-testid="report-open" className="flex flex-col gap-2">
              <h3 className="font-semibold">Your report</h3>
              <ReportCard r={active} />
              <p className={hintCls}>
                You can send another report after an admin has answered this
                one.
              </p>
            </div>
          ) : open ? (
            <ReportForm
              bookingId={bookingId}
              onSent={(r) => {
                seq.current++;
                setOpen(false);
                setView({ kind: "ready", items: [r, ...items] });
                setSent((n) => n + 1);
              }}
              onCancel={() => {
                returnFocus.current = true;
                setOpen(false);
              }}
            />
          ) : (
            <p>
              <button
                type="button"
                data-testid="report-button"
                ref={openerRef}
                onClick={() => setOpen(true)}
                className={secondaryButtonCls}
              >
                Report a problem
              </button>
            </p>
          )}
          {earlier.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="reports-earlier">
              <h3 className="font-semibold">Your earlier reports</h3>
              <ul className="flex flex-col gap-2">
                {earlier.map((r) => (
                  <li key={r.id}>
                    <ReportCard r={r} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReportCard({ r }: { r: ReportView }) {
  return (
    <div
      data-testid="report-card"
      className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3 [overflow-wrap:anywhere] dark:border-zinc-700"
    >
      <p className="font-semibold" data-testid="report-status">
        <span className="sr-only">Status: </span>
        {reportStatusText(r.status)}
      </p>
      <p className={hintCls}>
        {categoryLabel(r.category)}. Sent{" "}
        <time dateTime={r.createdAt}>{formatWhen(r.createdAt)}</time>
        {r.resolvedAt && (
          <>
            . Closed{" "}
            <time dateTime={r.resolvedAt}>{formatWhen(r.resolvedAt)}</time>
          </>
        )}
        .
      </p>
      <p className="whitespace-pre-line">{r.description}</p>
    </div>
  );
}

function ReportForm({
  bookingId,
  onSent,
  onCancel,
}: {
  bookingId: string;
  onSent: (r: ReportView) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  // One id per report, kept for retries: the server then never files the same report twice.
  const clientId = useRef<string>(crypto.randomUUID());
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const catId = `${uid}-cat`;
  const descId = `${uid}-desc`;
  const countId = `${uid}-count`;
  const used = description.trim().length;
  const over = used > DESCRIPTION_MAX;

  useEffect(() => headRef.current?.focus(), []);
  useEffect(() => {
    if (!tick) return;
    const bad = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    (bad ?? errRef.current)?.focus();
  }, [tick]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const parsed = parseReportForm({
      clientId: clientId.current,
      category,
      description,
    });
    if (!parsed.ok) {
      setFields(parsed.fields);
      setError("Check the highlighted fields.");
      setTick((t) => t + 1);
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const r = await apiFetch<ReportView>(
        `/api/bookings/${encodeURIComponent(bookingId)}/reports`,
        { method: "POST", body: parsed.request },
      );
      onSent(r);
    } catch (err) {
      setFields(err instanceof ApiClientError ? err.fields : {});
      setError(reportErrorText(err));
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      data-testid="report-form"
      aria-labelledby={`${uid}-h`}
      className="flex flex-col gap-4"
    >
      <h3
        id={`${uid}-h`}
        ref={headRef}
        tabIndex={-1}
        className="text-base font-semibold"
      >
        Tell us what went wrong
      </h3>
      <div
        ref={errRef}
        tabIndex={-1}
        role={error ? "alert" : undefined}
        data-testid="report-error"
        className={error ? dangerBoxCls : "sr-only"}
      >
        {error}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={catId} className="text-sm font-medium">
          What is it about?
        </label>
        <select
          id={catId}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-invalid={fields.category ? true : undefined}
          aria-describedby={fields.category ? `${catId}-error` : undefined}
          className={inputCls}
        >
          <option value="">Choose one</option>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {fields.category && (
          <p id={`${catId}-error`} className={errCls}>
            {fields.category}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={descId} className="text-sm font-medium">
          What happened?
        </label>
        <textarea
          id={descId}
          data-testid="report-description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={fields.description ? true : undefined}
          aria-describedby={`${countId}${fields.description ? ` ${descId}-error` : ""}`}
          className={`${inputCls} py-2`}
        />
        <p
          id={countId}
          className={
            over
              ? "text-sm font-semibold text-red-800 dark:text-red-300"
              : hintCls
          }
        >
          {used} of {DESCRIPTION_MAX} characters
          {over ? ` (${used - DESCRIPTION_MAX} too many)` : ""}
        </p>
        {fields.description && (
          <p id={`${descId}-error`} className={errCls}>
            {fields.description}
          </p>
        )}
      </div>
      <p className={infoBoxCls}>{REPORT_PRIVACY_TEXT}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onCancel} className={secondaryButtonCls}>
          Close without sending
        </button>
        <button type="submit" aria-disabled={busy} className={buttonCls}>
          {busy ? "Sending..." : "Send report"}
        </button>
      </div>
    </form>
  );
}
