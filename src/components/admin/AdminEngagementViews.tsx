"use client";
// Admin lists for T-049 (contract 7D): bookings, problem reports, free-trial blocks, and a
// read-only chat. They call the real admin routes; only when MOCK mode is on (isMockEnabled())
// do they run on the made-up in-tab adapter, and then the MOCK badge and "made-up" lines show.
// Reports and the admin's notes are for admins only: nothing on these pages is shown to the
// customer or the chef.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { isMockEnabled } from "@/lib/api/client";
import { MockBadge } from "@/components/MockBadge";
import { Alert, secondaryButtonCls } from "@/components/chef/parts";
import { DecisionForm } from "@/components/admin/DecisionForm";
import { useAdminList } from "@/components/admin/useAdminList";
import { infoBoxCls } from "@/components/booking/parts";
import type { BookingStatus } from "@/lib/api/types";
import { formatWhen } from "@/lib/admin/queue";
import {
  FLAG_REASON_TEXT,
  blockReasonText,
  categoryLabel,
  decisionErrorText,
  finalStatusLabel,
  formatDate,
  freeTrialResultText,
  reportStatusText,
  type DecisionKind,
} from "@/lib/engagement/rules";
import type {
  AdminBookingItem,
  AdminDecisionResponse,
  AdminFreeTrialBlock,
  AdminMessageView,
  AdminReportItem,
} from "@/lib/api/types";

const BOOKING_STATUS_TEXT: Record<BookingStatus, string> = {
  requested: "Requested",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show_customer: "Customer no-show",
  no_show_chef: "Chef no-show",
  expired: "Expired",
};
const statusText = (s: string) => BOOKING_STATUS_TEXT[s as BookingStatus] ?? s;
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );

const selectCls = "control";
const itemCls = "card flex flex-col gap-2 p-4";

export const DEFAULT_MOCK_LINE = "Made-up data in this prototype.";

function Shell({
  title,
  intro,
  mockLine = DEFAULT_MOCK_LINE,
  children,
}: {
  title: string;
  /** A true sentence, always shown (privacy rules). */
  intro?: string;
  /** Shown with the MOCK badge only in MOCK mode. */
  mockLine?: string;
  children: React.ReactNode;
}) {
  const mock = isMockEnabled();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 [overflow-wrap:anywhere]">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {mock && (
        <p data-testid="admin-mock-line" className="hint">
          <MockBadge>MOCK</MockBadge> {mockLine}
        </p>
      )}
      {intro && <p className="hint">{intro}</p>}
      {children}
    </main>
  );
}

function ListBody<T extends { id: string }>({
  list,
  noun,
  empty,
  order = "newest first",
  children,
}: {
  list: ReturnType<typeof useAdminList<T>>;
  noun: string;
  empty: string;
  order?: string;
  children: (items: T[]) => React.ReactNode;
}) {
  const alertId = useId();
  const { view } = list;
  const error = view.kind === "error" ? view.message : list.moreError;
  useEffect(() => {
    if (list.tick) document.getElementById(alertId)?.focus();
  }, [list.tick, alertId]);
  return (
    <>
      <Alert id={alertId} message={error} />
      {view.kind === "loading" && <p role="status">Loading {noun}...</p>}
      {view.kind === "ready" && (
        <>
          <p role="status" data-testid="list-count">
            {view.items.length === 0
              ? empty
              : `Showing ${view.items.length} ${noun}, ${order}${view.nextCursor ? " (more available)" : ""}.`}
          </p>
          {view.items.length > 0 && children(view.items)}
          {view.nextCursor && (
            <button
              type="button"
              onClick={list.loadMore}
              aria-disabled={list.moreBusy}
              className={`${secondaryButtonCls} self-start`}
            >
              {list.moreBusy ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </>
  );
}

function ResultNotice({ r }: { r: AdminDecisionResponse | null }) {
  const trial = r ? freeTrialResultText(r.freeTrial) : null;
  return (
    <p
      role="status"
      data-testid="decision-result"
      className={r ? "notice-ok p-3 text-sm" : "sr-only"}
    >
      {r &&
        `Decision saved. The booking is now: ${statusText(r.booking.status)}.${trial ? ` ${trial}` : ""}`}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
const REPORT_FILTERS = [
  { value: "active", label: "Open and in review" },
  { value: "open", label: "Open" },
  { value: "reviewing", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

export function AdminReportsView() {
  const [status, setStatus] = useState("active");
  const list = useAdminList<AdminReportItem>(
    `/api/admin/reports?status=${status}`,
    (e) => decisionErrorText(e),
  );
  const [result, setResult] = useState<AdminDecisionResponse | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const [deciding, setDeciding] = useState<{
    id: string;
    kind: DecisionKind;
  } | null>(null);
  const filterId = useId();
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (deciding === null && returnTo.current) {
      document
        .querySelector<HTMLElement>(`[data-opener="${returnTo.current}"]`)
        ?.focus();
      returnTo.current = null;
    }
  }, [deciding]);

  function done(r: AdminDecisionResponse) {
    setDeciding(null);
    setResult(r);
    list.reload();
    queueMicrotask(() => resultRef.current?.focus());
  }

  return (
    <Shell
      title="Problem reports"
      mockLine="Reports are made-up in this prototype."
      intro="Only the person who sent a report and admins can read it; the other person is never told."
    >
      <div className="flex flex-col gap-1 self-start">
        <label htmlFor={filterId} className="text-sm font-medium">
          Show
        </label>
        <select
          id={filterId}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setResult(null);
            setDeciding(null);
          }}
          className={selectCls}
        >
          {REPORT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={resultRef as never} tabIndex={-1}>
        <ResultNotice r={result} />
      </div>
      <ListBody
        list={list}
        noun="reports"
        empty="No reports match this filter."
      >
        {(items) => (
          <ul aria-label="Problem reports" className="flex flex-col gap-3">
            {items.map((r) => (
              <li key={r.id} data-testid="admin-report" className={itemCls}>
                <h2 className="text-lg font-semibold">
                  {categoryLabel(r.category)} · {reportStatusText(r.status)}
                </h2>
                <p className="whitespace-pre-wrap">{r.description}</p>
                <p className="text-sm">
                  From {r.reporter.displayName} ({r.reporter.role}) on{" "}
                  {formatWhen(r.createdAt)}
                </p>
                <p className="text-sm">
                  Booking: {statusText(r.booking.status)}, first day{" "}
                  {r.booking.firstDay
                    ? formatDate(r.booking.firstDay)
                    : "not set"}
                  . Customer {r.booking.customer.displayName}, chef{" "}
                  {r.booking.chef.displayName}.{" "}
                  {r.booking.anyDayCooked
                    ? "A day was cooked."
                    : "No day cooked yet."}
                </p>
                {r.booking.frozen && (
                  <p className={infoBoxCls}>
                    This booking is on hold until an admin decides.
                  </p>
                )}
                {r.decision && (
                  <p className="text-sm" data-testid="report-decision">
                    <strong>Decision</strong> (
                    {formatWhen(r.decision.decidedAt)}
                    ):{" "}
                    {r.decision.finalStatus
                      ? `booking set to ${finalStatusLabel(r.decision.finalStatus)}. `
                      : "booking unchanged. "}
                    Admin note: {r.decision.note}
                  </p>
                )}
                {(r.status === "open" || r.status === "reviewing") &&
                  (deciding?.id === r.id ? (
                    <DecisionForm
                      key={deciding.kind}
                      kind={deciding.kind}
                      path={`/api/admin/reports/${r.id}/${deciding.kind}`}
                      bookingStatus={r.booking.status}
                      anyDayCooked={r.booking.anyDayCooked}
                      isFreeTrial={null}
                      onDone={done}
                      onCancel={() => {
                        returnTo.current = `${r.id}:${deciding.kind}`;
                        setDeciding(null);
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={secondaryButtonCls}
                        data-opener={`${r.id}:resolve`}
                        onClick={() =>
                          setDeciding({ id: r.id, kind: "resolve" })
                        }
                      >
                        Resolve
                        <span className="sr-only"> this report</span>
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonCls}
                        data-opener={`${r.id}:dismiss`}
                        onClick={() =>
                          setDeciding({ id: r.id, kind: "dismiss" })
                        }
                      >
                        Dismiss
                        <span className="sr-only"> this report</span>
                      </button>
                      <Link
                        href={`/admin/bookings/${r.bookingId}/chat`}
                        className="inline-flex min-h-11 items-center underline"
                      >
                        Read the chat
                      </Link>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </ListBody>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
export function AdminBookingsView() {
  const [status, setStatus] = useState("all");
  const [flagOpen, setFlagOpen] = useState(false);
  const list = useAdminList<AdminBookingItem>(
    `/api/admin/bookings?status=${status}${flagOpen ? "&flag=open" : ""}`,
    (e) => decisionErrorText(e),
  );
  const [result, setResult] = useState<AdminDecisionResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const sid = useId();
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (deciding === null && returnTo.current) {
      document
        .querySelector<HTMLElement>(`[data-opener="${returnTo.current}"]`)
        ?.focus();
      returnTo.current = null;
    }
  }, [deciding]);

  function done(r: AdminDecisionResponse) {
    setDeciding(null);
    setResult(r);
    list.reload();
    queueMicrotask(() => resultRef.current?.focus());
  }

  return (
    <Shell title="Bookings">
      <form
        aria-label="Filter bookings"
        onSubmit={(e) => e.preventDefault()}
        className="card flex flex-wrap items-end gap-4 p-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={sid} className="text-sm font-medium">
            Status
          </label>
          <select
            id={sid}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setResult(null);
              setDeciding(null);
            }}
            className={selectCls}
          >
            <option value="all">All</option>
            {(Object.keys(BOOKING_STATUS_TEXT) as BookingStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusText(s)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-md border border-edge px-3 py-2">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={flagOpen}
            onChange={(e) => {
              setFlagOpen(e.target.checked);
              setResult(null);
              setDeciding(null);
            }}
          />
          <span>Only bookings with an open flag</span>
        </label>
      </form>
      <div ref={resultRef} tabIndex={-1}>
        <ResultNotice r={result} />
      </div>
      <ListBody
        list={list}
        noun="bookings"
        empty="No bookings match these filters."
      >
        {(items) => (
          <ul aria-label="Bookings" className="flex flex-col gap-3">
            {items.map((b) => {
              const flagIsOpen = b.flag !== null && b.flag.resolvedAt === null;
              return (
                <li key={b.id} data-testid="admin-booking" className={itemCls}>
                  <h2 className="text-lg font-semibold">
                    {b.customer.displayName} with {b.chef.displayName}
                  </h2>
                  <p className="text-sm">
                    <span className="font-medium">{statusText(b.status)}</span>
                    {" · "}
                    {b.dates.length} {b.dates.length === 1 ? "day" : "days"}
                    {" from "}
                    {b.firstDay ? formatDate(b.firstDay) : "not set"}
                    {" · "}
                    {b.locationType === "chef_home"
                      ? "At the chef's home"
                      : "At the customer's home"}
                    {" · "}
                    {money(b.totalCents, b.currency)}
                    {b.isFreeTrial ? " · Free first booking" : ""}
                  </p>
                  {b.openReportCount > 0 && (
                    <p className="text-sm">
                      Open reports: {b.openReportCount}{" "}
                      <Link href="/admin/reports" className="underline">
                        Go to reports
                      </Link>
                    </p>
                  )}
                  {b.flag && (
                    <p
                      data-testid="booking-flag"
                      className="notice p-2 text-sm"
                    >
                      <strong>
                        {flagIsOpen ? "Open flag" : "Flag resolved"}:
                      </strong>{" "}
                      {FLAG_REASON_TEXT[b.flag.reason]}
                      {flagIsOpen && b.flag.reason === "chef_rejected"
                        ? " The booking is on hold."
                        : ""}
                    </p>
                  )}
                  {flagIsOpen &&
                    (deciding === b.id ? (
                      <DecisionForm
                        kind="flag"
                        path={`/api/admin/bookings/${b.id}/resolve-flag`}
                        bookingStatus={b.status}
                        anyDayCooked={b.anyDayCooked}
                        isFreeTrial={b.isFreeTrial}
                        onDone={done}
                        onCancel={() => {
                          returnTo.current = b.id;
                          setDeciding(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        data-opener={b.id}
                        className={`${secondaryButtonCls} self-start`}
                        onClick={() => setDeciding(b.id)}
                      >
                        Resolve flag
                        <span className="sr-only">
                          {" "}
                          for {b.customer.displayName} with {b.chef.displayName}
                        </span>
                      </button>
                    ))}
                  <Link
                    href={`/admin/bookings/${b.id}/chat`}
                    className="inline-flex min-h-11 items-center self-start underline"
                  >
                    Read the chat
                    <span className="sr-only">
                      {" "}
                      for {b.customer.displayName} with {b.chef.displayName}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ListBody>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Free-trial blocks
// ---------------------------------------------------------------------------
export function AdminBlocksView() {
  const list = useAdminList<AdminFreeTrialBlock>(
    "/api/admin/free-trial-blocks",
    (e) => decisionErrorText(e),
  );
  return (
    <Shell
      title="Free-trial blocks"
      intro="A block happens when someone tries a second free first booking. The reason is for admins only; customers are never told which rule blocked them."
    >
      <ListBody list={list} noun="blocks" empty="No free-trial blocks yet.">
        {(items) => (
          <ul aria-label="Free-trial blocks" className="flex flex-col gap-3">
            {items.map((b) => (
              <li key={b.id} data-testid="admin-block" className={itemCls}>
                <h2 className="text-lg font-semibold">
                  {b.customer.displayName}
                </h2>
                <p>{blockReasonText(b.reason)}</p>
                <p className="text-sm">
                  {b.attempts} {b.attempts === 1 ? "attempt" : "attempts"},
                  first on {formatWhen(b.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ListBody>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Chat (read only)
// ---------------------------------------------------------------------------
export function AdminChatView({ bookingId }: { bookingId: string }) {
  const list = useAdminList<AdminMessageView>(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/messages`,
    (e) => decisionErrorText(e),
  );
  return (
    <Shell title="Booking chat" mockLine="Made-up messages.">
      <p className={infoBoxCls}>Read only. Admins cannot send messages.</p>
      <Link
        href="/admin/bookings"
        className="inline-flex min-h-11 items-center self-start underline"
      >
        Back to bookings
      </Link>
      <ListBody
        list={list}
        noun="messages"
        empty="No messages in this chat."
        order="oldest first"
      >
        {(items) => (
          <ol
            aria-label="Messages, oldest first"
            className="flex flex-col gap-2"
          >
            {items.map((m) => (
              <li key={m.id} data-testid="admin-message" className={itemCls}>
                <p className="text-sm font-medium">
                  {m.senderName} ({m.senderRole}) · {formatWhen(m.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ol>
        )}
      </ListBody>
    </Shell>
  );
}
