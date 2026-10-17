"use client";
// A customer's booking (T-043): the confirmation after sending a request, and the detail page.
// Reads GET /api/bookings/:id and calls POST /api/bookings/:id/cancel (contract section 7A).
//
// Privacy (CLAUDE.md 6.8): the server sends `cookingPlace` and `contact` only when the booking is
// accepted (or, for the customer's own cooking address, always). This page shows exactly what it
// receives and says when something is shared later. Nothing here ever shows a phone number or the
// chef's kitchen address before acceptance. The payment is MOCK and nothing is charged.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import {
  RefusalProvider,
  isStateRefusal,
  useReportRefusal,
  useBookingRefusals,
} from "@/components/refusal";
import type { BookingDetail, BookingStatus } from "@/lib/api/types";
import {
  formatWhen,
  isInsideLateWindow,
  type FieldErrors,
} from "@/lib/booking/form";
import {
  CONTACT_ENDED_TEXT,
  CONTACT_LOCKED_TEXT,
  canCustomerCancel,
  FROZEN_TEXT,
  chefNoShowTrialText,
  contactOpenText,
  contactWindow,
  isWaitingForCheck,
} from "@/lib/booking/changes";
import { freeTrialEffect } from "@/lib/domain/cancellation";
import { torontoToday } from "@/lib/domain/dishes";
import { formatMinutes } from "@/lib/chef/dishes";
import { allergenText, shortDayLabel } from "@/lib/search/detail";
import { MockBadge } from "@/components/MockBadge";
import {
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
} from "@/components/chef/parts";
import { NOTICE_BOX_CLS, useAnnounce } from "@/components/booking/useAnnounce";
import { GroceriesSection } from "@/components/booking/GroceriesSection";
import { CustomerPickups } from "@/components/booking/PickupSections";
import {
  FieldScopeProvider,
  FrozenNotice,
  EstimateLines,
  MockPayment,
  TextArea,
  dangerBoxCls,
  infoBoxCls,
  warnBoxCls,
} from "@/components/booking/parts";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

type State =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "ready"; booking: BookingDetail };

export const STATUS_TEXT: Record<BookingStatus, string> = {
  requested: "Waiting for the chef to answer",
  accepted: "Accepted by the chef",
  declined: "Declined by the chef",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show_customer: "Marked as a no-show (customer)",
  no_show_chef: "Marked as a no-show (chef)",
  expired: "Expired: the chef did not answer in time",
};

/** Words for a cancel error that needs more than the server message. */
function cancelErrorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "INVALID_STATE") {
      if (err.reason === "wrong_status")
        return "This booking can no longer be cancelled. Reload the page to see its status.";
      if (err.reason === "nothing_left")
        return "There is no visit left to cancel.";
    }
    if (err.reason === "frozen") return FROZEN_TEXT;
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function BookingDetailView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const params = useSearchParams();
  const sent = params.get("sent") === "1";
  // T-067: the booking was sent but saving the answers to the profile failed.
  const profileNotSaved = params.get("profile") === "notsaved";

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState({ kind: "loading" });
    try {
      const booking = await apiFetch<BookingDetail>(
        `/api/bookings/${encodeURIComponent(id)}`,
      );
      if (mine !== seq.current) return;
      setState({ kind: "ready", booking });
    } catch (err) {
      if (mine !== seq.current) return;
      setState(
        err instanceof ApiClientError && err.status === 404
          ? { kind: "notFound" }
          : { kind: "error" },
      );
    }
  }, [id]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [load]);

  // T-080: after a 409 the booking is refetched quietly (the page stays on screen, no "loading").
  // A failed refetch is ignored: the old page and the refusal message stay. A newer load or
  // change wins over an older refetch through `seq`.
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const booking = await apiFetch<BookingDetail>(
        `/api/bookings/${encodeURIComponent(id)}`,
      );
      if (mine !== seq.current) return;
      setState({ kind: "ready", booking });
    } catch {
      /* keep what is on screen */
    }
  }, [id]);
  const { scope, alert, clear } = useBookingRefusals(refresh);

  useEffect(() => {
    document.title =
      state.kind === "ready"
        ? `Booking with ${state.booking.chef.displayName} — CookNeighbour`
        : "Booking — CookNeighbour";
  }, [state]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
      <p>
        <Link href="/bookings" className={linkCls}>
          My bookings
        </Link>
      </p>
      {state.kind === "loading" && (
        <p role="status" data-testid="loading">
          Loading your booking...
        </p>
      )}
      {state.kind === "notFound" && (
        <div data-testid="not-found" className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Booking not found
          </h1>
          <p>We could not find this booking in your account.</p>
        </div>
      )}
      {state.kind === "error" && (
        <div
          role="alert"
          data-testid="load-error"
          className="flex flex-col gap-3"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            The booking did not load
          </h1>
          <p>Something went wrong on our side or the connection dropped.</p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className={secondaryButtonCls}
            >
              Try again
            </button>
          </p>
        </div>
      )}
      {alert}
      {state.kind === "ready" && (
        <RefusalProvider value={scope}>
          <Ready
            booking={state.booking}
            sent={sent}
            profileNotSaved={profileNotSaved}
            onChange={(b) => {
              seq.current++;
              clear(); // a new successful change replaces an old refusal message
              setState({ kind: "ready", booking: b });
            }}
          />
        </RefusalProvider>
      )}
    </main>
  );
}

function Ready({
  booking: b,
  sent,
  profileNotSaved,
  onChange,
}: {
  booking: BookingDetail;
  sent: boolean;
  profileNotSaved: boolean;
  onChange: (b: BookingDetail) => void;
}) {
  const hid = useId();
  // After a successful pickup proposal or receipt answer the form that was used goes away, so this
  // page announces the result and takes focus (one owner, lessons-learned section 3).
  const { announce, notice } = useAnnounce();
  const changed = (next: BookingDetail, message?: string) => {
    onChange(next);
    if (message) announce(message);
  };
  const canCancel = !b.frozen && canCustomerCancel(b, torontoToday());
  const win = contactWindow(b);
  const windowText = contactOpenText(win);
  const firstDay = b.days[0]?.date;
  const anyCooked = b.days.some((d) => d.cookedAt !== null);
  return (
    <>
      <header className="flex flex-col gap-2">
        {sent && b.status === "requested" && (
          <p
            role="status"
            data-testid="sent-banner"
            className="rounded-md border-2 border-emerald-800 bg-emerald-50 p-3 font-semibold text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50"
          >
            Your request was sent to {b.chef.displayName}. Nothing was charged.
          </p>
        )}
        {sent && profileNotSaved && (
          <p
            role="status"
            data-testid="profile-not-saved"
            className={warnBoxCls}
          >
            Your request was sent, but your allergy profile could not be saved.
            You can save it later from{" "}
            <Link href="/allergies" className={linkCls}>
              your allergy profile
            </Link>
            .
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">
          Booking with {b.chef.displayName}
        </h1>
        <p data-testid="status" className="text-lg font-semibold">
          <span className="sr-only">Status: </span>
          {STATUS_TEXT[b.status]}
        </p>
        {b.isFreeTrial && (
          <p data-testid="trial-label">
            <span className="rounded-md border-2 border-emerald-800 px-2 py-0.5 text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Free first booking
            </span>{" "}
            <span className={hintCls}>
              Labour is free. <span className="font-medium">MOCK:</span> the
              chef&apos;s pay is simulated.
            </span>
          </p>
        )}
      </header>

      {notice("notice", NOTICE_BOX_CLS)}

      {b.frozen && <FrozenNotice text={FROZEN_TEXT} />}

      <StatusNotes b={b} anyCooked={anyCooked} />

      <section aria-labelledby={`${hid}-days-h`} className={cardCls}>
        <h2 id={`${hid}-days-h`} className="text-lg font-semibold">
          Days and dishes
        </h2>
        <ol className="flex flex-col gap-3" aria-label="Days">
          {b.days.map((d) => (
            <li
              key={d.dayNumber}
              data-testid="day"
              className="rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
            >
              <p className="font-semibold">
                Day {d.dayNumber}:{" "}
                <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time> (
                {formatMinutes(d.cookMinutes)})
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {d.dishes.map((x, i) => (
                  <li key={`${x.dishId ?? "gone"}-${i}`}>
                    <span className="font-medium">
                      {x.name}
                      {x.quantity > 1 ? ` x ${x.quantity}` : ""}
                    </span>
                    <br />
                    {allergenText(x.allergens)}
                    <br />
                    Eat by{" "}
                    <time dateTime={x.eatByDate}>
                      {shortDayLabel(x.eatByDate, true)}
                    </time>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className={hintCls}>
          Meals are best eaten by their &quot;eat by&quot; date. These dates are
          a prototype default: the real window must be confirmed with Ontario
          public-health guidance before any launch.
        </p>
      </section>

      <section aria-labelledby={`${hid}-where-h`} className={cardCls}>
        <h2 id={`${hid}-where-h`} className="text-lg font-semibold">
          Where and who
        </h2>
        <p>
          {b.locationType === "customer_home"
            ? "The chef cooks at your home."
            : "You pick up the meals at the chef's home."}
        </p>
        <p>
          Groceries:{" "}
          {b.groceryOption === "customer_buys"
            ? "you buy the ingredients."
            : "the chef shops and you reimburse the receipt at cost."}
        </p>
        {b.cookingPlace ? (
          <p data-testid="cooking-place">
            <span className="font-medium">
              {b.locationType === "customer_home"
                ? "Cooking address (yours): "
                : "Chef's kitchen: "}
            </span>
            {b.cookingPlace.line}, {b.cookingPlace.city}{" "}
            {b.cookingPlace.postalCode}
          </p>
        ) : (
          <p data-testid="kitchen-later" className={infoBoxCls}>
            {b.locationType === "chef_home"
              ? b.status === "requested"
                ? "The chef's kitchen address is shared with you once the chef accepts this booking."
                : win.kind === "ended"
                  ? "The chef's kitchen address is hidden now."
                  : "The chef's kitchen address is not shown for this booking."
              : "Your cooking address is not available on this page."}
          </p>
        )}
        {b.contact?.phone ? (
          <p data-testid="contact">
            <span className="font-medium">
              {b.contact.displayName}&apos;s phone:{" "}
            </span>
            {b.contact.phone}
          </p>
        ) : (
          <p data-testid="contact-later" className={hintCls}>
            {b.status === "requested"
              ? "Phone numbers are shared only after the chef accepts."
              : win.kind === "ended"
                ? CONTACT_ENDED_TEXT
                : win.kind === "locked"
                  ? `The chef's phone number is not shown for this booking. ${CONTACT_LOCKED_TEXT}`
                  : "The chef's phone number is not shown for this booking."}
          </p>
        )}
        {windowText && (
          <p data-testid="contact-window" className={hintCls}>
            {windowText}
          </p>
        )}
      </section>

      <CustomerPickups booking={b} onChange={changed} />

      <GroceriesSection booking={b} viewer="customer" />

      <section aria-labelledby={`${hid}-intake-h`} className={cardCls}>
        <h2 id={`${hid}-intake-h`} className="text-lg font-semibold">
          Your allergy and dietary answers
        </h2>
        <p>
          <span className="font-medium">Allergies:</span> {b.intake.allergies}
        </p>
        <p>
          <span className="font-medium">Dietary needs:</span>{" "}
          {b.intake.dietaryNotes}
        </p>
        {b.allergyConflicts.length > 0 && (
          <div data-testid="conflicts" className={warnBoxCls}>
            <p className="font-semibold">
              <span aria-hidden="true">&#9888; </span>
              Dishes that match your allergies
              {b.intake.allergyConflictAcknowledged
                ? " (you confirmed you understand)"
                : ""}
              :
            </p>
            <ul className="list-disc pl-5">
              {b.allergyConflicts.map((c) => (
                <li key={c.dishId}>
                  {c.dishName} ({c.allergens.join(", ")})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby={`${hid}-est-h`} className={cardCls}>
        <h2 id={`${hid}-est-h`} className="text-lg font-semibold">
          Estimate
        </h2>
        <EstimateLines
          e={b.estimate}
          locationType={b.locationType}
          freeTrial={b.isFreeTrial}
          visits={b.days.length}
        />
        <MockPayment />
      </section>

      {canCancel && firstDay && (
        <CancelSection booking={b} firstDay={firstDay} onChange={onChange} />
      )}
    </>
  );
}

function StatusNotes({
  b,
  anyCooked,
}: {
  b: BookingDetail;
  anyCooked: boolean;
}) {
  const trialAfterCancel =
    b.isFreeTrial && b.status === "cancelled"
      ? freeTrialEffect("cancelled", { anyDayCooked: anyCooked })
      : null;
  const trialAfterNoShow =
    b.status === "no_show_chef"
      ? chefNoShowTrialText(b.isFreeTrial, anyCooked)
      : null;
  return (
    <div className="flex flex-col gap-2">
      {b.status === "requested" && b.expiresAt && (
        <p data-testid="expires" className={infoBoxCls}>
          The chef has until{" "}
          <span className="font-medium">{formatWhen(b.expiresAt)}</span> to
          answer. After that the request expires on its own, the days are freed
          {b.isFreeTrial ? " and your free first booking is kept" : ""}.
        </p>
      )}
      {isWaitingForCheck(b, torontoToday()) && (
        <p data-testid="waiting-check" className={infoBoxCls}>
          All visit days have passed and none is marked as cooked. This booking
          is waiting for a check. This page will show what happens next.
        </p>
      )}
      {b.status === "accepted" && (
        <p className={infoBoxCls}>
          The chef accepted. Their phone number and, for a chef&apos;s-home
          booking, their kitchen address are shown below.
        </p>
      )}
      {b.status === "declined" && (
        <p data-testid="declined" className={warnBoxCls}>
          The chef declined this request
          {b.declineReason ? `: ${b.declineReason}` : "."} Nothing was charged
          {b.isFreeTrial ? " and your free first booking is kept" : ""}.
        </p>
      )}
      {b.status === "expired" && (
        <p data-testid="expired" className={warnBoxCls}>
          The chef did not answer in time. Nothing was charged
          {b.isFreeTrial ? " and your free first booking is kept" : ""}. You can
          send a new request.
        </p>
      )}
      {b.status === "cancelled" && (
        <div data-testid="cancelled" className={warnBoxCls}>
          {b.cancelledBy === "system" ? (
            <p>
              This booking was cancelled automatically because the chef can no
              longer take bookings on CookNeighbour. You did nothing wrong.
              Nothing was charged.
            </p>
          ) : (
            <p>
              {b.cancelledBy === "chef"
                ? "The chef cancelled this booking."
                : "You cancelled this booking."}
              {b.cancelReason ? ` Reason: ${b.cancelReason}` : ""}
            </p>
          )}
          {b.cancellationTiming && (
            <p data-testid="cancel-timing">
              {b.cancellationTiming === "late"
                ? "This was a late cancellation: it was less than 48 hours before the first day. Nothing was charged."
                : "This was an on-time cancellation (more than 48 hours before the first day). Nothing was charged."}
            </p>
          )}
          {trialAfterCancel && (
            <p data-testid="trial-after-cancel">
              {trialAfterCancel === "release"
                ? "No day had been cooked, so your free first booking is not used up."
                : "A day had already been cooked, so your free first booking counts as used."}
            </p>
          )}
        </div>
      )}
      {b.noShow && (
        <p className={warnBoxCls}>
          A no-show was reported
          {b.noShow.pickupMissed ? " (meals not picked up)" : ""}.
        </p>
      )}
      {trialAfterNoShow && (
        <p data-testid="trial-after-no-show" className={infoBoxCls}>
          {trialAfterNoShow}
        </p>
      )}
    </div>
  );
}

function CancelSection({
  booking: b,
  firstDay,
  onChange,
}: {
  booking: BookingDetail;
  firstDay: string;
  onChange: (b: BookingDetail) => void;
}) {
  const hid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const scope = useId();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const alertId = useId();
  const late = isInsideLateWindow(firstDay, new Date());
  const reportRefusal = useReportRefusal();

  useEffect(() => {
    if (!tick) return;
    const bad = formRef.current?.querySelector<HTMLElement>("textarea");
    (fields.reason && bad ? bad : alertRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new attempt moves focus
  }, [tick]);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = reason.trim() ? { reason: reason.trim() } : {};
      const next = await apiFetch<BookingDetail>(
        `/api/bookings/${encodeURIComponent(b.id)}/cancel`,
        { method: "POST", body },
      );
      onChange(next);
    } catch (err) {
      if (reportRefusal && isStateRefusal(err)) {
        // T-080: the page shows the message, takes focus and refetches the booking.
        reportRefusal(cancelErrorText(err));
        return;
      }
      setFields(err instanceof ApiClientError ? err.fields : {});
      setError(
        err instanceof ApiClientError &&
          err.code === "CONTACT_DETAILS_NOT_ALLOWED"
          ? "Please leave phone numbers, emails and links out of the reason. They are shared only after a booking is accepted."
          : cancelErrorText(err),
      );
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${hid}-cancel-h`} className={cardCls}>
      <h2 id={`${hid}-cancel-h`} className="text-lg font-semibold">
        Cancel this booking
      </h2>
      {!open ? (
        <p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={secondaryButtonCls}
          >
            Cancel this booking
          </button>
        </p>
      ) : (
        <FieldScopeProvider value={`cx${scope}-`}>
          <form
            ref={formRef}
            onSubmit={cancel}
            noValidate
            className="flex flex-col gap-3"
          >
            <h3
              ref={confirmRef}
              tabIndex={-1}
              className="text-base font-semibold"
            >
              Are you sure?
            </h3>
            {late ? (
              <p
                role="note"
                data-testid="late-cancel-warning"
                className={warnBoxCls}
              >
                <span aria-hidden="true">&#9888; </span>
                <span className="font-semibold">
                  This will be a late cancellation.
                </span>{" "}
                Your first day is less than 48 hours away. Nothing is charged
                either way in this prototype, but the late cancellation is
                recorded.
              </p>
            ) : (
              <p data-testid="free-cancel-note" className={infoBoxCls}>
                Your first day is more than 48 hours away, so this is an on-time
                cancellation.
              </p>
            )}
            {b.isFreeTrial && (
              <p className={hintCls}>
                If no day has been cooked yet, your free first booking is not
                used up.
              </p>
            )}
            <div
              id={alertId}
              ref={alertRef}
              tabIndex={-1}
              role="alert"
              className={error ? dangerBoxCls : "sr-only"}
              data-testid="cancel-error"
            >
              {error}
            </div>
            <TextArea
              label="Reason (optional)"
              errorKey="cancel-reason"
              error={fields.reason}
              hint="Do not include phone numbers, emails or links."
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setFields({});
                }}
                disabled={busy}
                className={secondaryButtonCls}
              >
                Keep my booking
              </button>
              <button type="submit" disabled={busy} className={buttonCls}>
                {busy ? "Cancelling..." : "Yes, cancel this booking"}
              </button>
            </div>
            <p className={hintCls}>
              <MockBadge>MOCK</MockBadge> No payment was taken, so there is
              nothing to refund.
            </p>
          </form>
        </FieldScopeProvider>
      )}
    </section>
  );
}
