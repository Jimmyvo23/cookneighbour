"use client";
// Pickup times for a chef's-home booking (T-045, D-29, contract section 7A "Booking changes").
// The customer picks up the finished meals at the chef's home. After a day is cooked the customer
// proposes a pickup time, the chef accepts or declines, and the customer may propose again until
// the end of `pickupDeadlineDate` (the earliest eat-by date of that day's meals, Toronto time).
// When that window is over the chef can mark "pickup missed", which counts as a no-show by the
// customer for the whole booking.
//
// Times are Toronto wall-clock time (the rule the server uses), whatever zone the browser is in.
// Every failure moves focus to the alert or the field (lessons-learned section 3); a successful
// change is announced by the page (`onChange(booking, message)`), which owns focus after it.
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { BookingDayView, BookingDetail } from "@/lib/api/types";
import {
  canMarkPickupMissed,
  canPropose,
  changeErrorText,
  liveProposal,
  pickupWindowPassed,
  proposalErrorText,
  torontoLocalToIso,
  torontoNowLocal,
} from "@/lib/booking/changes";
import { formatWhen } from "@/lib/booking/form";
import { shortDayLabel } from "@/lib/search/detail";
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
  Input,
  infoBoxCls,
  warnBoxCls,
} from "@/components/booking/parts";

type OnChange = (b: BookingDetail, message?: string) => void;

const PROPOSAL_WORDS: Record<
  BookingDayView["pickups"][number]["status"],
  { customer: string; chef: string }
> = {
  proposed: {
    customer: "waiting for the chef to answer",
    chef: "waiting for your answer",
  },
  accepted: { customer: "the chef agreed", chef: "you agreed" },
  declined: { customer: "the chef declined", chef: "you declined" },
  void: {
    customer: "no answer before the booking ended",
    chef: "no answer before the booking ended",
  },
};

function History({
  day,
  viewer,
}: {
  day: BookingDayView;
  viewer: "customer" | "chef";
}) {
  if (day.pickups.length === 0) return null;
  return (
    <ul
      aria-label={`Pickup times for day ${day.dayNumber}`}
      className="flex flex-col gap-1 text-sm"
      data-testid="pickup-history"
    >
      {day.pickups.map((p) => (
        <li key={p.id}>
          {viewer === "customer" ? "You proposed " : "Proposed: "}
          <span className="font-medium">{formatWhen(p.proposedAt)}</span>
          {" (Toronto time): "}
          {PROPOSAL_WORDS[p.status][viewer]}.
        </li>
      ))}
    </ul>
  );
}

function agreed(day: BookingDayView) {
  const p = liveProposal(day);
  return p && p.status === "accepted" ? p : null;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export function CustomerPickups({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const hid = useId();
  const hasHistory = b.days.some((d) => d.pickups.length > 0);
  if (b.locationType !== "chef_home") return null;
  if (b.status !== "accepted" && !hasHistory) return null;
  const now = new Date();
  // T-077 (D-53, D-65): a frozen booking offers no pickup action; `live` is only for the wording.
  const live = b.status === "accepted";
  const open = live && !b.frozen;
  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="pickups"
      className={cardCls}
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Picking up your meals
      </h2>
      <p>
        You pick up the finished meals at the chef&apos;s home.{" "}
        {b.frozen
          ? PICKUPS_PAUSED
          : "Agree a pickup time with the chef here: you propose a time and the chef accepts or declines. If it does not work, you can propose another time until the end of the last pickup day below."}
      </p>
      {open && (
        <p className={warnBoxCls} data-testid="pickup-missed-warning">
          <span className="font-semibold">If the meals are not picked up</span>{" "}
          by the end of that day, the chef can mark the pickup as missed. That
          counts as a no-show by you for the whole booking
          {b.isFreeTrial ? ", and your free first booking counts as used" : ""}.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-zinc-300 dark:divide-zinc-700">
        {b.days.map((d) => (
          <li
            key={d.dayNumber}
            data-testid="pickup-day"
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
          >
            <p className="font-semibold">
              Day {d.dayNumber}:{" "}
              <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time>
            </p>
            {!d.cookedAt ? (
              <p className={hintCls}>
                {b.frozen
                  ? PICKUPS_PAUSED
                  : live
                    ? "The chef has not marked this day as cooked yet. You can propose a pickup time after that."
                    : "This day was not cooked."}
              </p>
            ) : (
              <>
                {d.pickupDeadlineDate && (
                  <p className={hintCls}>
                    Pick these meals up by the end of{" "}
                    <time dateTime={d.pickupDeadlineDate}>
                      {shortDayLabel(d.pickupDeadlineDate, true)}
                    </time>
                    , their earliest eat-by day.
                  </p>
                )}
                <History day={d} viewer="customer" />
                {agreed(d) && (
                  <p className={infoBoxCls} data-testid="pickup-agreed">
                    Pickup agreed for{" "}
                    <span className="font-medium">
                      {formatWhen(agreed(d)!.proposedAt)}
                    </span>{" "}
                    (Toronto time).
                  </p>
                )}
                {open && liveProposal(d)?.status === "proposed" && (
                  <p className={hintCls}>
                    Waiting for the chef. You can propose another time after
                    they answer.
                  </p>
                )}
                {open && canPropose(d, now) && (
                  <ProposeForm booking={b} day={d} onChange={onChange} />
                )}
                {open && !agreed(d) && pickupWindowPassed(d, now) && (
                  <p className={warnBoxCls} data-testid="pickup-window-over">
                    The pickup time for this day has passed and no pickup was
                    agreed. You can no longer propose a time for it.
                  </p>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const PICKUPS_PAUSED = "Pickups are paused while this booking is on hold.";

function ProposeForm({
  booking: b,
  day,
  onChange,
}: {
  booking: BookingDetail;
  day: BookingDayView;
  onChange: OnChange;
}) {
  const scope = useId();
  const sec = useSection();
  const [value, setValue] = useState("");
  const fe = sec.fieldErrors;
  const max = day.pickupDeadlineDate
    ? `${day.pickupDeadlineDate}T23:59`
    : undefined;
  const [min] = useState(() => torontoNowLocal());
  const hadProposal = day.pickups.length > 0;

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (sec.busy) return;
    const iso = torontoLocalToIso(value);
    if (!iso) {
      sec.fail("Check the highlighted fields.", {
        time: "Choose a date and a time.",
      });
      return;
    }
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(
          `/api/bookings/${encodeURIComponent(b.id)}/days/${day.dayNumber}/pickup/propose`,
          { method: "POST", body: { proposedAt: iso } },
        );
        onChange(
          next,
          `Pickup time proposed for day ${day.dayNumber}: ${formatWhen(iso)}. The chef has been told.`,
        );
      },
      "",
      {
        describe: proposalErrorText,
        fields: (f): Record<string, string> =>
          f.proposedAt ? { time: f.proposedAt } : {},
      },
    );
  }

  return (
    <FieldScopeProvider value={`pp${scope}-`}>
      <form
        onSubmit={submit}
        noValidate
        data-testid="propose-form"
        className="flex flex-col gap-3"
      >
        <Alert id={sec.alertId} message={sec.error} />
        <Input
          label={`${hadProposal ? "Propose a new pickup time" : "Propose a pickup time"} for day ${day.dayNumber} (Toronto time)`}
          errorKey="time"
          error={fe.time}
          hint="The chef has to agree to the time you pick."
          type="datetime-local"
          min={min}
          max={max}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p>
          <button type="submit" disabled={sec.busy} className={buttonCls}>
            {sec.busy ? "Sending..." : "Propose this time"}
          </button>
        </p>
      </form>
    </FieldScopeProvider>
  );
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------
export function ChefPickups({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const hid = useId();
  if (b.locationType !== "chef_home") return null;
  const hasHistory = b.days.some((d) => d.pickups.length > 0);
  if (b.status !== "accepted" && !hasHistory) return null;
  const now = new Date();
  // T-077 (D-53, D-65): a frozen booking offers no pickup action; `live` is only for the wording.
  const live = b.status === "accepted";
  const open = live && !b.frozen;
  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="pickups"
      className={cardCls}
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Pickup times
      </h2>
      <p>
        The customer picks up the finished meals at your home.{" "}
        {b.frozen
          ? PICKUPS_PAUSED
          : "After you mark a day as cooked, the customer proposes a pickup time and you accept or decline it. They may propose again until the end of that day's pickup deadline."}
      </p>
      <ul className="flex flex-col divide-y divide-zinc-300 dark:divide-zinc-700">
        {b.days.map((d) => (
          <li
            key={d.dayNumber}
            data-testid="pickup-day"
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
          >
            <p className="font-semibold">
              Day {d.dayNumber}:{" "}
              <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time>
            </p>
            {!d.cookedAt ? (
              <p className={hintCls}>
                {b.frozen
                  ? PICKUPS_PAUSED
                  : live
                    ? "Mark this day as cooked first. Then the customer can propose a pickup time."
                    : "This day was not cooked."}
              </p>
            ) : (
              <>
                {d.pickupDeadlineDate && (
                  <p className={hintCls}>
                    Pickup deadline: the end of{" "}
                    <time dateTime={d.pickupDeadlineDate}>
                      {shortDayLabel(d.pickupDeadlineDate, true)}
                    </time>
                    , the earliest eat-by day of these meals.
                  </p>
                )}
                <History day={d} viewer="chef" />
                {agreed(d) && (
                  <p className={infoBoxCls} data-testid="pickup-agreed">
                    Pickup agreed for{" "}
                    <span className="font-medium">
                      {formatWhen(agreed(d)!.proposedAt)}
                    </span>{" "}
                    (Toronto time).
                  </p>
                )}
                {open && liveProposal(d)?.status === "proposed" && (
                  <RespondButtons booking={b} day={d} onChange={onChange} />
                )}
                {open && !liveProposal(d) && !pickupWindowPassed(d, now) && (
                  <p className={hintCls}>
                    Waiting for the customer to propose a pickup time.
                  </p>
                )}
                {open && !agreed(d) && pickupWindowPassed(d, now) && (
                  <p className={warnBoxCls} data-testid="pickup-window-over">
                    The pickup deadline for this day has passed and no pickup
                    was agreed.
                  </p>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {!b.frozen && canMarkPickupMissed(b, now) && (
        <MissedPickup booking={b} onChange={onChange} />
      )}
    </section>
  );
}

function RespondButtons({
  booking: b,
  day,
  onChange,
}: {
  booking: BookingDetail;
  day: BookingDayView;
  onChange: OnChange;
}) {
  const sec = useSection();
  const proposal = liveProposal(day)!;
  function respond(accept: boolean) {
    if (sec.busy) return;
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(
          `/api/bookings/${encodeURIComponent(b.id)}/days/${day.dayNumber}/pickup/respond`,
          { method: "POST", body: { accept } },
        );
        onChange(
          next,
          accept
            ? `You agreed to the pickup on ${formatWhen(proposal.proposedAt)} for day ${day.dayNumber}.`
            : `You declined that pickup time for day ${day.dayNumber}. The customer can propose another.`,
        );
      },
      "",
      { describe: changeErrorText },
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="pickup-respond">
      <Alert id={sec.alertId} message={sec.error} />
      <p>
        The customer proposes{" "}
        <span className="font-medium">{formatWhen(proposal.proposedAt)}</span>{" "}
        (Toronto time) for day {day.dayNumber}.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={sec.busy}
          onClick={() => respond(true)}
          className={buttonCls}
        >
          {sec.busy ? "Sending..." : "Accept this time"}
        </button>
        <button
          type="button"
          disabled={sec.busy}
          onClick={() => respond(false)}
          className={secondaryButtonCls}
        >
          Decline this time
        </button>
      </div>
    </div>
  );
}

function MissedPickup({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: OnChange;
}) {
  const sec = useSection();
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const goingBack = useRef(false);
  useEffect(() => {
    // "Keep waiting" removes the focused button: return focus to the button that opened the step.
    if (!confirming && goingBack.current) {
      goingBack.current = false;
      opener.current?.focus();
    }
  }, [confirming]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirming) headingRef.current?.focus();
  }, [confirming]);
  function mark() {
    if (sec.busy) return;
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(
          `/api/bookings/${encodeURIComponent(b.id)}/pickup/missed`,
          { method: "POST" },
        );
        onChange(
          next,
          "You marked the pickup as missed. The booking is closed as a customer no-show.",
        );
      },
      "",
      { describe: changeErrorText },
    );
  }
  return (
    <div
      data-testid="missed-pickup"
      className="flex flex-col gap-3 border-t border-zinc-300 pt-4 dark:border-zinc-700"
    >
      <h3 className="text-base font-semibold">The meals were not picked up</h3>
      <p>
        The pickup deadline has passed. If the customer did not collect their
        meals, you can mark the pickup as missed.
      </p>
      <Alert id={sec.alertId} message={sec.error} />
      {!confirming ? (
        <p>
          <button
            type="button"
            ref={opener}
            onClick={() => setConfirming(true)}
            className={secondaryButtonCls}
          >
            Mark pickup missed
          </button>
        </p>
      ) : (
        <div className={warnBoxCls}>
          <h4
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            Mark the pickup as missed?
          </h4>
          <p className="mt-1">
            This counts as a no-show by the customer for the whole booking
            {b.isFreeTrial ? " and uses up their free first booking" : ""}.
            Later days that were not cooked are cancelled. You cannot undo it.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={sec.busy}
              onClick={mark}
              className={buttonCls}
            >
              {sec.busy ? "Sending..." : "Yes, mark pickup missed"}
            </button>
            <button
              type="button"
              disabled={sec.busy}
              onClick={() => {
                goingBack.current = true;
                setConfirming(false);
              }}
              className={secondaryButtonCls}
            >
              Keep waiting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
