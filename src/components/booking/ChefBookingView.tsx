"use client";
// One request to the chef (T-045): what the customer asked for, their allergy and dietary answers
// and any dish that matches them BEFORE the chef answers, then accept / decline (a reason is
// required, D-34), the cooked marker per day, "visit done", pickups and groceries.
// Reads GET /api/bookings/:id and calls the routes of contract sections 7A and 7B.
//
// Privacy (CLAUDE.md 6.8): the server sends the customer's cooking address and phone only once
// the booking is accepted. This page shows exactly what it receives and says when something is
// shared later. For a chef's-home booking the chef's own kitchen address is shared with the
// customer once the chef accepts, and it is locked while that booking is accepted (409
// `kitchen_in_use`). The payment is MOCK; nothing is charged or paid.
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type {
  BookingDayView,
  BookingDetail,
  BookingStatus,
} from "@/lib/api/types";
import {
  CHEF_STATUS_TEXT,
  allDaysCooked,
  changeErrorText,
  dayIsDue,
} from "@/lib/booking/changes";
import { formatWhen } from "@/lib/booking/form";
import { freeTrialEffect } from "@/lib/domain/cancellation";
import { formatMinutes } from "@/lib/chef/dishes";
import { torontoToday } from "@/lib/domain/dishes";
import { allergenText, shortDayLabel } from "@/lib/search/detail";
import { NOTICE_BOX_CLS, useAnnounce } from "@/components/booking/useAnnounce";
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
  EstimateLines,
  FieldScopeProvider,
  TextArea,
  infoBoxCls,
  warnBoxCls,
} from "@/components/booking/parts";
import { GroceriesSection } from "@/components/booking/GroceriesSection";
import { ChefPickups } from "@/components/booking/PickupSections";
import { ChefEndSections } from "@/components/booking/ChefEndSections";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

type State =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "ready"; booking: BookingDetail };

export function ChefBookingView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
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

  useEffect(() => {
    document.title =
      state.kind === "ready"
        ? `Booking from ${state.booking.customer.displayName} — CookNeighbour`
        : "Booking — CookNeighbour";
  }, [state]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
      <p>
        <Link href="/chef/bookings" className={linkCls}>
          All bookings
        </Link>
      </p>
      {state.kind === "loading" && (
        <p role="status" data-testid="loading">
          Loading the booking...
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
      {state.kind === "ready" && (
        <Ready
          booking={state.booking}
          onChange={(b) => setState({ kind: "ready", booking: b })}
        />
      )}
    </main>
  );
}

function Ready({
  booking: b,
  onChange,
}: {
  booking: BookingDetail;
  onChange: (b: BookingDetail) => void;
}) {
  const hid = useId();
  // One owner moves focus after a successful change: the notice below (lessons-learned section 3).
  const { announce, notice } = useAnnounce();
  const changed = (next: BookingDetail, message?: string) => {
    onChange(next);
    if (message) announce(message);
  };
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          Booking from {b.customer.displayName}
        </h1>
        <p data-testid="status" className="text-lg font-semibold">
          <span className="sr-only">Status: </span>
          {CHEF_STATUS_TEXT[b.status]}
        </p>
        {notice("notice", NOTICE_BOX_CLS)}
        {b.isFreeTrial && (
          <p data-testid="trial-label">
            <span className="rounded-md border-2 border-emerald-800 px-2 py-0.5 text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Free first booking
            </span>{" "}
            <span className={hintCls}>
              Labour is free for the customer on this booking (prototype, MOCK).{" "}
              <MockBadge>MOCK</MockBadge>
            </span>
          </p>
        )}
        {b.status === "requested" && b.expiresAt && (
          <p data-testid="expires" className={infoBoxCls}>
            Answer by{" "}
            <span className="font-medium">{formatWhen(b.expiresAt)}</span>{" "}
            (Toronto time). After that the request expires on its own and the
            days are freed. Read the allergy and dietary answers below before
            you decide.
          </p>
        )}
        <StatusNotes b={b} />
      </header>

      <Intake b={b} />

      <Days b={b} onChange={changed} />

      <Where b={b} />

      {b.status === "requested" && <Answer b={b} onChange={changed} />}

      <ChefPickups booking={b} onChange={changed} />

      <GroceriesSection booking={b} viewer="chef" />

      <section aria-labelledby={`${hid}-est-h`} className={cardCls}>
        <h2 id={`${hid}-est-h`} className="text-lg font-semibold">
          Estimate for the customer
        </h2>
        <EstimateLines
          e={b.estimate}
          locationType={b.locationType}
          freeTrial={b.isFreeTrial}
          visits={b.days.length}
          viewer="chef"
        />
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <MockBadge>MOCK</MockBadge> Payment: no money moves in this prototype.
          The customer is not charged and you are not paid.
        </p>
      </section>

      {b.status === "accepted" && <Finish b={b} onChange={changed} />}

      {b.status === "accepted" && (
        <ChefEndSections booking={b} onChange={changed} />
      )}
    </>
  );
}

function StatusNotes({ b }: { b: BookingDetail }) {
  return (
    <div className="flex flex-col gap-2">
      {b.status === "declined" && (
        <p data-testid="declined" className={infoBoxCls}>
          You declined this request
          {b.declineReason ? `: ${b.declineReason}` : "."} The customer was
          told.
        </p>
      )}
      {b.status === "cancelled" && (
        <p data-testid="cancelled" className={warnBoxCls}>
          {b.cancelledBy === "system"
            ? "This booking was cancelled automatically."
            : b.cancelledBy === "chef"
              ? "You cancelled this booking."
              : "The customer cancelled this booking."}
          {b.cancelReason ? ` Reason: ${b.cancelReason}` : ""}
          {b.cancellationTiming === "late"
            ? " It was less than 48 hours before the first day."
            : ""}
          {b.isFreeTrial && b.cancelledBy !== "system"
            ? freeTrialEffect("cancelled", {
                anyDayCooked: b.days.some((d) => d.cookedAt !== null),
              }) === "consume"
              ? " A day had been cooked, so the customer's free first booking counts as used."
              : " No day had been cooked, so the customer keeps their free first booking."
            : ""}
        </p>
      )}
      {b.status === "expired" && (
        <p data-testid="expired" className={infoBoxCls}>
          Nobody answered in time, so this request expired. The days are free
          again.
        </p>
      )}
      {b.noShow && (
        <p data-testid="no-show" className={warnBoxCls}>
          {b.status === "no_show_customer"
            ? b.noShow.pickupMissed
              ? "You marked the pickup as missed. This is a customer no-show for the whole booking."
              : `You reported a customer no-show${b.isFreeTrial ? ". The customer's free first booking counts as used" : ""}.`
            : "A chef no-show was reported."}
        </p>
      )}
      {b.status === "completed" && b.completedAt && (
        <p className={infoBoxCls}>Completed on {formatWhen(b.completedAt)}.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the chef must read before answering
// ---------------------------------------------------------------------------
function Intake({ b }: { b: BookingDetail }) {
  const hid = useId();
  return (
    <section
      aria-labelledby={`${hid}-h`}
      className={cardCls}
      data-testid="intake"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Allergies and dietary needs
      </h2>
      <p>The customer filled this in. Read it before you accept.</p>
      <p className="[overflow-wrap:anywhere]">
        <span className="font-medium">Allergies:</span> {b.intake.allergies}
      </p>
      <p className="[overflow-wrap:anywhere]">
        <span className="font-medium">Dietary needs:</span>{" "}
        {b.intake.dietaryNotes}
      </p>
      {b.allergyConflicts.length > 0 ? (
        <div data-testid="conflicts" className={warnBoxCls}>
          <p className="font-semibold">
            Check this: some dishes contain what the customer is allergic to
            {b.intake.allergyConflictAcknowledged
              ? ". The customer said they understand."
              : "."}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {b.allergyConflicts.map((c) => (
              <li key={c.dishId} className="[overflow-wrap:anywhere]">
                {c.dishName} ({c.allergens.join(", ")})
              </li>
            ))}
          </ul>
          <p className="mt-1">
            You can still accept. Decline if you cannot cook it safely.
          </p>
        </div>
      ) : (
        <p data-testid="no-conflicts" className={hintCls}>
          No dish matches the allergies the customer listed.
        </p>
      )}
    </section>
  );
}

function Days({
  b,
  onChange,
}: {
  b: BookingDetail;
  onChange: (b: BookingDetail, message?: string) => void;
}) {
  const hid = useId();
  const today = torontoToday();
  return (
    <section
      aria-labelledby={`${hid}-h`}
      className={cardCls}
      data-testid="days"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Days and dishes
      </h2>
      <ol
        aria-label="Days"
        className="flex flex-col divide-y divide-zinc-300 dark:divide-zinc-700"
      >
        {b.days.map((d) => (
          <li
            key={d.dayNumber}
            data-testid="day"
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
          >
            <p className="font-semibold">
              Day {d.dayNumber}:{" "}
              <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time> (
              {formatMinutes(d.cookMinutes)})
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {d.dishes.map((x, i) => (
                <li key={`${x.dishId ?? "gone"}-${i}`} data-testid="dish">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {x.name}
                    {x.quantity > 1 ? ` x ${x.quantity}` : ""}
                  </span>
                  <br />
                  {allergenText(x.allergens)}
                  <br />
                  <span data-testid="eat-by">
                    Eat by{" "}
                    <time dateTime={x.eatByDate}>
                      {shortDayLabel(x.eatByDate, true)}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
            {b.status === "accepted" && (
              <Cooked
                b={b}
                day={d}
                due={dayIsDue(d, today)}
                onChange={onChange}
              />
            )}
            {b.status !== "accepted" && d.cookedAt && (
              <p className={hintCls}>Cooked on {formatWhen(d.cookedAt)}.</p>
            )}
          </li>
        ))}
      </ol>
      <p className={hintCls}>
        Meals are best eaten by their &quot;eat by&quot; date. Tell the customer
        these dates when you hand over the food. They are a prototype default:
        the real window must be confirmed with Ontario public-health guidance
        before any launch.
      </p>
    </section>
  );
}

function Cooked({
  b,
  day,
  due,
  onChange,
}: {
  b: BookingDetail;
  day: BookingDayView;
  due: boolean;
  onChange: (b: BookingDetail, message?: string) => void;
}) {
  const sec = useSection();
  if (day.cookedAt)
    return (
      <p
        data-testid="cooked"
        className="font-medium text-emerald-900 dark:text-emerald-300"
      >
        Cooked on {formatWhen(day.cookedAt)}.
      </p>
    );
  if (!due)
    return (
      <p className={hintCls} data-testid="cooked-later">
        You can mark this day as cooked on{" "}
        <time dateTime={day.date}>{shortDayLabel(day.date, true)}</time>.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <Alert id={sec.alertId} message={sec.error} />
      <p>
        <button
          type="button"
          disabled={sec.busy}
          className={buttonCls}
          onClick={() => {
            if (sec.busy) return;
            void sec.run(
              async () => {
                const next = await apiFetch<BookingDetail>(
                  `/api/bookings/${encodeURIComponent(b.id)}/days/${day.dayNumber}/cooked`,
                  { method: "POST" },
                );
                onChange(next, `Day ${day.dayNumber} is marked as cooked.`);
              },
              "",
              { describe: changeErrorText },
            );
          }}
        >
          {sec.busy ? "Saving..." : `Mark day ${day.dayNumber} as cooked`}
        </button>
      </p>
    </div>
  );
}

function Where({ b }: { b: BookingDetail }) {
  const hid = useId();
  return (
    <section
      aria-labelledby={`${hid}-h`}
      className={cardCls}
      data-testid="where"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Where and who
      </h2>
      <p>
        {b.locationType === "customer_home"
          ? "You cook at the customer's home."
          : "You cook at your home, and the customer picks up the meals."}
      </p>
      {b.cookingPlace ? (
        <p data-testid="cooking-place" className="[overflow-wrap:anywhere]">
          <span className="font-medium">Customer&apos;s address: </span>
          {b.cookingPlace.line}, {b.cookingPlace.city}{" "}
          {b.cookingPlace.postalCode}
        </p>
      ) : b.locationType === "customer_home" ? (
        <p data-testid="address-later" className={infoBoxCls}>
          {b.status === "requested"
            ? "The customer's address is shown once you accept this booking."
            : "The customer's address is not shown for this booking."}
        </p>
      ) : null}
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
            ? "The customer's phone number is shown once you accept."
            : "The customer's phone number is not shown for this booking."}
        </p>
      )}
      {b.locationType === "chef_home" && <KitchenNote status={b.status} />}
    </section>
  );
}

/** What the chef is told about their kitchen address (T-033, contract N3 and `kitchen_in_use`). */
function KitchenNote({ status }: { status: BookingStatus }) {
  if (status === "requested")
    return (
      <p data-testid="kitchen-note" className={infoBoxCls}>
        Your kitchen address is shared with the customer once you accept this
        booking. While you have an accepted booking at your home, your kitchen
        address is locked and cannot be changed on your application page.
      </p>
    );
  if (status === "accepted")
    return (
      <p data-testid="kitchen-note" className={infoBoxCls}>
        The customer can now see your kitchen address. While you have an
        accepted booking at your home, your kitchen address is locked and cannot
        be changed on your application page.
      </p>
    );
  if (
    status === "completed" ||
    status === "no_show_customer" ||
    status === "no_show_chef"
  )
    return (
      <p data-testid="kitchen-note" className={hintCls}>
        This booking is finished. The customer can still see your kitchen
        address for it. This booking no longer locks your kitchen address.
        Another accepted booking at your home can still lock it.
      </p>
    );
  if (status === "cancelled")
    return (
      <p data-testid="kitchen-note" className={hintCls}>
        This booking was cancelled. The customer cannot see your kitchen address
        for it. This booking no longer locks your kitchen address. Another
        accepted booking at your home can still lock it.
      </p>
    );
  return (
    <p data-testid="kitchen-note" className={hintCls}>
      Your kitchen address was not shared with the customer for this booking.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Accept or decline
// ---------------------------------------------------------------------------
function Answer({
  b,
  onChange,
}: {
  b: BookingDetail;
  onChange: (b: BookingDetail, message?: string) => void;
}) {
  const hid = useId();
  const scope = useId();
  const sec = useSection();
  const [declining, setDeclining] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const goingBack = useRef(false);
  useEffect(() => {
    // "Go back" removes the button that has focus: return focus to the button that opened the form.
    if (!declining && goingBack.current) {
      goingBack.current = false;
      opener.current?.focus();
    }
  }, [declining]);
  const [reason, setReason] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (declining) formRef.current?.querySelector("textarea")?.focus();
  }, [declining]);
  const base = `/api/bookings/${encodeURIComponent(b.id)}`;
  const home = b.locationType === "chef_home";

  function accept() {
    if (sec.busy) return;
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(`${base}/accept`, {
          method: "POST",
        });
        onChange(
          next,
          home
            ? "You accepted this booking. The customer can now see your kitchen address, and you can see their phone number."
            : "You accepted this booking. You can now see the customer's address and phone number.",
        );
      },
      "",
      { describe: changeErrorText },
    );
  }
  function decline() {
    if (sec.busy) return;
    const text = reason.trim();
    if (text.length < 3 || text.length > 500) {
      sec.fail("Check the highlighted fields.", {
        reason: "Tell the customer why, in 3 to 500 characters.",
      });
      return;
    }
    void sec.run(
      async () => {
        const next = await apiFetch<BookingDetail>(`${base}/decline`, {
          method: "POST",
          body: { reason: text },
        });
        onChange(next, "You declined this request. The customer was told.");
      },
      "",
      {
        describe: (err) =>
          err instanceof ApiClientError &&
          (err.code === "CONTACT_DETAILS_NOT_ALLOWED" ||
            (err.status === 422 && err.fields.reason))
            ? err.code === "CONTACT_DETAILS_NOT_ALLOWED"
              ? "Please leave phone numbers, emails and links out of the reason. They are shared only after a booking is accepted."
              : err.fields.reason
            : changeErrorText(err),
        fields: (f): Record<string, string> =>
          f.reason ? { reason: f.reason } : {},
      },
    );
  }

  return (
    <FieldScopeProvider value={`an${scope}-`}>
      <section
        aria-labelledby={`${hid}-h`}
        className={cardCls}
        data-testid="answer"
      >
        <h2 id={`${hid}-h`} className="text-lg font-semibold">
          Your answer
        </h2>
        <div ref={formRef} className="flex flex-col gap-3">
          <Alert id={sec.alertId} message={sec.error} />
          {!declining && (
            <p>
              If you accept,{" "}
              {home
                ? "the customer sees your kitchen address and you see their phone number."
                : "you see the customer's address and phone number."}{" "}
              The days are held for them.
            </p>
          )}
          {declining && (
            <TextArea
              label="Why are you declining?"
              errorKey="decline-reason"
              error={sec.fieldErrors.reason}
              hint="Required, 3 to 500 characters. The customer reads this. Do not include phone numbers, emails or links."
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <div className="flex flex-wrap gap-3">
            {!declining ? (
              <>
                <button
                  type="button"
                  disabled={sec.busy}
                  onClick={accept}
                  className={buttonCls}
                >
                  {sec.busy ? "Sending..." : "Accept this request"}
                </button>
                <button
                  type="button"
                  disabled={sec.busy}
                  ref={opener}
                  onClick={() => setDeclining(true)}
                  className={secondaryButtonCls}
                >
                  Decline this request
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={sec.busy}
                  onClick={decline}
                  className={buttonCls}
                >
                  {sec.busy ? "Sending..." : "Send decline"}
                </button>
                <button
                  type="button"
                  disabled={sec.busy}
                  onClick={() => {
                    goingBack.current = true;
                    setDeclining(false);
                    setReason("");
                  }}
                  className={secondaryButtonCls}
                >
                  Go back
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </FieldScopeProvider>
  );
}

// ---------------------------------------------------------------------------
// Visit done
// ---------------------------------------------------------------------------
function Finish({
  b,
  onChange,
}: {
  b: BookingDetail;
  onChange: (b: BookingDetail, message?: string) => void;
}) {
  const hid = useId();
  const sec = useSection();
  const ready = allDaysCooked(b);
  const home = b.locationType === "chef_home";
  return (
    <section
      aria-labelledby={`${hid}-h`}
      className={cardCls}
      data-testid="finish"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Finish the booking
      </h2>
      {!ready ? (
        <p>Mark every day as cooked first. Then you can close the booking.</p>
      ) : (
        <>
          <p>
            Every day is cooked.{" "}
            {home
              ? "Wait until the customer has picked up the meals. Or wait until the pickup times have passed. Then press Visit done. After that you cannot mark a missed pickup."
              : "Press Visit done when you have finished and left."}
          </p>
          <Alert id={sec.alertId} message={sec.error} />
          <p>
            <button
              type="button"
              disabled={sec.busy}
              className={buttonCls}
              onClick={() => {
                if (sec.busy) return;
                void sec.run(
                  async () => {
                    const next = await apiFetch<BookingDetail>(
                      `/api/bookings/${encodeURIComponent(b.id)}/complete`,
                      { method: "POST" },
                    );
                    onChange(next, "The booking is completed. Thank you.");
                  },
                  "",
                  { describe: changeErrorText },
                );
              }}
            >
              {sec.busy ? "Saving..." : "Visit done"}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
