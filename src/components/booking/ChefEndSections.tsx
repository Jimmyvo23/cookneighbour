"use client";
// The chef ends an accepted booking early (T-070): cancel it, or report that the customer did not
// show up. Contract section 7A "Booking changes":
//   - POST /api/bookings/:id/cancel { reason? }: chef, `accepted` only. Reason is optional, 3 to 500
//     characters, and may not hold a phone number, email or link (422 CONTACT_DETAILS_NOT_ALLOWED,
//     D-34). Timing is D-20 (late = less than 48 hours before day 1, nothing is charged either
//     way). Free trial (D-26): released when no day was cooked, used up when one was.
//   - POST /api/bookings/:id/no-show: chef, a visit whose date has come and that was not cooked
//     (409 `no_visit_due`). The booking becomes `no_show_customer`; the trial is used up; days that
//     have not happened and were not cooked are freed.
// Both ask first and say what will happen. The server is the judge: these screens only avoid a
// button that cannot work and word every refusal. Payment is MOCK; nothing is charged or paid.
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { BookingDetail } from "@/lib/api/types";
import {
  canChefCancel,
  cancelBookingErrorText,
  noShowDay,
  noShowErrorText,
} from "@/lib/booking/changes";
import { isInsideLateWindow } from "@/lib/booking/form";
import { freeTrialEffect } from "@/lib/domain/cancellation";
import { torontoToday } from "@/lib/domain/dishes";
import { shortDayLabel } from "@/lib/search/detail";
import { MockBadge } from "@/components/MockBadge";
import {
  Alert,
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";
import {
  FieldScopeProvider,
  TextArea,
  warnBoxCls,
} from "@/components/booking/parts";

type OnChange = (b: BookingDetail, message?: string) => void;

/** One confirm step: opens on a button, takes focus on its heading, returns focus on "go back". */
function useConfirm() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const goingBack = useRef(false);
  useEffect(() => {
    if (open) heading.current?.focus();
    else if (goingBack.current) {
      // The button that had focus is gone: give focus back to the one that opened the step.
      goingBack.current = false;
      opener.current?.focus();
    }
  }, [open]);
  return {
    open,
    opener,
    heading,
    show: () => setOpen(true),
    back: () => {
      goingBack.current = true;
      setOpen(false);
    },
  };
}

export function ChefEndSections({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const hid = useId();
  return (
    <section
      aria-labelledby={`${hid}-h`}
      className={cardCls}
      data-testid="end-booking"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        If the plan changes
      </h2>
      <CancelBooking booking={b} onChange={onChange} />
      <ReportNoShow booking={b} onChange={onChange} />
    </section>
  );
}

function CancelBooking({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const sec = useSection();
  const scope = useId();
  const { open, opener, heading, show, back } = useConfirm();
  const [reason, setReason] = useState("");
  const today = torontoToday();
  const possible = canChefCancel(b, today);
  const firstDay = [...b.days.map((d) => d.date)].sort()[0];
  const late = firstDay ? isInsideLateWindow(firstDay, new Date()) : false;
  const anyCooked = b.days.some((d) => d.cookedAt !== null);
  const trial = b.isFreeTrial
    ? freeTrialEffect("cancelled", { anyDayCooked: anyCooked })
    : null;
  const home = b.locationType === "chef_home";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sec.busy) return;
    const text = reason.trim();
    if (text && (text.length < 3 || text.length > 500)) {
      sec.fail("Check the highlighted fields.", {
        reason: "Use 3 to 500 characters, or leave it empty.",
      });
      return;
    }
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(
          `/api/bookings/${encodeURIComponent(b.id)}/cancel`,
          { method: "POST", body: text ? { reason: text } : {} },
        );
        onChange(
          next,
          "You cancelled this booking. The customer was told and the days are free again.",
        );
      },
      "",
      {
        describe: cancelBookingErrorText,
        fields: (f): Record<string, string> =>
          f.reason ? { reason: f.reason } : {},
      },
    );
  }

  return (
    <div
      data-testid="cancel-booking"
      className="flex flex-col gap-3 border-t border-zinc-300 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-700"
    >
      <h3 className="text-base font-semibold">Cancel this booking</h3>
      {!possible ? (
        <p data-testid="cancel-unavailable" className={hintCls}>
          There is nothing left to cancel: every visit is either cooked or in
          the past. When you have finished, press Visit done.
        </p>
      ) : !open ? (
        <>
          <p>
            Cancel only if you can no longer cook. The customer is told at once
            and the days are freed.
          </p>
          <p>
            <button
              type="button"
              ref={opener}
              onClick={show}
              className={secondaryButtonCls}
            >
              Cancel this booking
            </button>
          </p>
        </>
      ) : (
        <FieldScopeProvider value={`cc${scope}-`}>
          <form
            onSubmit={submit}
            noValidate
            className={`${warnBoxCls} flex flex-col gap-3`}
          >
            <h4 ref={heading} tabIndex={-1} className="text-base font-semibold">
              Cancel this booking?
            </h4>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li data-testid="cancel-timing-note">
                {late
                  ? "Your first day is less than 48 hours away (or has begun), so this is recorded as a late cancellation. The customer can see that."
                  : "Your first day is more than 48 hours away, so this is recorded as an on-time cancellation."}{" "}
                Nothing is charged either way.
              </li>
              <li>
                The customer is told, and the days are free for other bookings.
                {home
                  ? " They can no longer see your kitchen address for this booking."
                  : " You can no longer see their address and phone number."}
              </li>
              {trial && (
                <li data-testid="cancel-trial-note">
                  {trial === "consume"
                    ? "A day was already cooked, so the customer's free first booking counts as used."
                    : "No day was cooked, so the customer keeps their free first booking."}
                </li>
              )}
              <li>You cannot undo it.</li>
            </ul>
            <div className="flex flex-col gap-3">
              <Alert id={sec.alertId} message={sec.error} />
              <TextArea
                label="Reason (optional)"
                errorKey="chef-cancel-reason"
                error={sec.fieldErrors.reason}
                hint="The customer reads this. 3 to 500 characters. Do not include phone numbers, emails or links."
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={sec.busy} className={buttonCls}>
                {sec.busy ? "Cancelling..." : "Yes, cancel this booking"}
              </button>
              <button
                type="button"
                disabled={sec.busy}
                onClick={back}
                className={secondaryButtonCls}
              >
                Keep the booking
              </button>
            </div>
            <p className={hintCls}>
              <MockBadge>MOCK</MockBadge> Nothing was charged and you are not
              paid, so there is nothing to refund.
            </p>
          </form>
        </FieldScopeProvider>
      )}
    </div>
  );
}

function ReportNoShow({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const sec = useSection();
  const { open, opener, heading, show, back } = useConfirm();
  const today = torontoToday();
  const due = noShowDay(b, today);
  const next = [...b.days]
    .sort((x, y) => x.dayNumber - y.dayNumber)
    .find((d) => d.cookedAt === null && d.date > today);
  const home = b.locationType === "chef_home";

  function report() {
    if (sec.busy) return;
    void sec.run(
      async () => {
        const res = await apiFetch<BookingDetail>(
          `/api/bookings/${encodeURIComponent(b.id)}/no-show`,
          { method: "POST" },
        );
        onChange(
          res,
          "You reported a customer no-show. The booking is closed and the customer was told.",
        );
      },
      "",
      { describe: noShowErrorText },
    );
  }

  return (
    <div
      data-testid="report-no-show"
      className="flex flex-col gap-3 border-t border-zinc-300 pt-4 dark:border-zinc-700"
    >
      <h3 className="text-base font-semibold">The customer did not show up</h3>
      {!due ? (
        <p data-testid="no-show-unavailable" className={hintCls}>
          You can report a no-show from the day of a visit that you have not
          marked as cooked.
          {next ? (
            <>
              {" "}
              The next visit is on{" "}
              <time dateTime={next.date}>{shortDayLabel(next.date, true)}</time>
              .
            </>
          ) : null}
        </p>
      ) : !open ? (
        <>
          <p>
            Day {due.dayNumber} (
            <time dateTime={due.date}>{shortDayLabel(due.date, true)}</time>) is
            due and not marked as cooked. If the customer did not show up, you
            can report it.
            {home
              ? " For meals that were cooked but not collected, use Mark pickup missed instead."
              : ""}
          </p>
          <p>
            <button
              type="button"
              ref={opener}
              onClick={show}
              className={secondaryButtonCls}
            >
              Report a customer no-show
            </button>
          </p>
        </>
      ) : (
        <div className={`${warnBoxCls} flex flex-col gap-3`}>
          <h4 ref={heading} tabIndex={-1} className="text-base font-semibold">
            Report that the customer did not show up for day {due.dayNumber}?
          </h4>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              The whole booking is closed as a customer no-show. The customer is
              told.
            </li>
            <li>
              Days that have not happened and were not cooked are freed. Days
              you already cooked stay as they are.
            </li>
            {b.isFreeTrial && (
              <li data-testid="no-show-trial-note">
                The customer&apos;s free first booking counts as used.
              </li>
            )}
            <li>You cannot undo it.</li>
          </ul>
          <Alert id={sec.alertId} message={sec.error} />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={sec.busy}
              onClick={report}
              className={buttonCls}
            >
              {sec.busy ? "Sending..." : "Yes, report a no-show"}
            </button>
            <button
              type="button"
              disabled={sec.busy}
              onClick={back}
              className={secondaryButtonCls}
            >
              Keep the booking
            </button>
          </div>
          <p className={hintCls}>
            <MockBadge>MOCK</MockBadge> Nothing is charged to the customer and
            you are not paid.
          </p>
        </div>
      )}
    </div>
  );
}
