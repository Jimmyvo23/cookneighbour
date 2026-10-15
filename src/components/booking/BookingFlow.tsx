"use client";
// Booking flow (T-043), step 1: the request form, step 2: review and send. Built against
// docs/api-contract.md section 7A: POST /api/bookings/estimate (review) and POST /api/bookings
// (send). The server decides everything that matters (dates, double booking, service area, 6 hour
// limit, free trial, the 3 open requests); the browser runs the cheap checks first (lib/booking/form.ts)
// so the customer gets help before a round trip, and shows every server answer in words.
//
// Privacy (CLAUDE.md 6.8): no phone number or address of the chef is shown here. A chef's-home
// customer is told the kitchen address is shared only after the chef accepts.
// Everything about money is an estimate and the payment step is MOCK: nothing is charged.
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type {
  SavedIntakeResponse,
  BookingDetail,
  BookingEstimate,
  BookingEstimateResponse,
  GroceryOption,
  LocationType,
  MeResponse,
  PublicChefDetail,
  PublicDish,
} from "@/lib/api/types";
import {
  buildRequest,
  classifyBookingError,
  dayMinutes,
  earliestDate,
  emptyDraft,
  estimateIsSendable,
  formatWhen,
  freeTrialBlockerText,
  isInsideLateWindow,
  issuesToErrors,
  localConflicts,
  localProblems,
  pickedDishes,
  resizeDays,
  visitLimitMessage,
  type BookingDraft,
  type DayDraft,
  type FieldErrors,
} from "@/lib/booking/form";
import {
  draftFromSaved,
  intakeFromDraft,
  intakeIsUntouched,
  sameIntake,
} from "@/lib/booking/savedIntake";
import { eatByText, formatDollars, formatMinutes } from "@/lib/chef/dishes";
import {
  MAX_BOOKING_DAYS,
  MAX_DISH_QUANTITY,
  MAX_OPEN_REQUESTS,
} from "@/lib/domain/config";
import {
  allergenText,
  groupDatesByMonth,
  isChefDetail,
  locationLabels,
  shortDayLabel,
} from "@/lib/search/detail";
import {
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
} from "@/components/chef/parts";
import { IntakeFields } from "@/components/booking/IntakeFields";
import {
  Choice,
  ErrorSummary,
  EstimateLines,
  Input,
  MockPayment,
  Question,
  dangerBoxCls,
  FieldScopeProvider,
  errCls,
  inputCls,
  useDomId,
  warnBoxCls,
} from "@/components/booking/parts";

type ChefState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "ready"; chef: PublicChefDetail };

interface FlowAlert {
  message: string;
  action?: React.ReactNode;
}

// D-39: per-day breakdown from the estimate API's `estimate.days` (no browser-side computing).
export function PerDayEstimate({
  days,
  freeTrial,
  location,
}: {
  days: BookingEstimate["days"];
  freeTrial: boolean;
  location: LocationType;
}) {
  if (!days || days.length === 0) return null;
  return (
    <div data-testid="per-day-estimate">
      <h4 className="font-semibold">Day by day</h4>
      <p className={hintCls}>
        {freeTrial
          ? "Labour is free on this first booking, so each day shows $0.00. The full value of the waived labour is in the totals above. "
          : ""}
        {location === "customer_home"
          ? "Travel is charged for each visit."
          : "No travel fee for the chef's home."}
      </p>
      <ol className="mt-1 flex flex-col gap-2" aria-label="Estimate per day">
        {[...days]
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((d, i) => (
            <li
              key={d.date}
              data-testid="per-day-row"
              className="rounded-md border border-zinc-300 p-3 text-sm dark:border-zinc-700"
            >
              <p className="font-semibold">
                Day {i + 1}:{" "}
                <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time>
              </p>
              <dl className="flex flex-col">
                <div className="flex justify-between gap-4">
                  <dt>Cooking time</dt>
                  <dd className="tabular-nums">
                    {formatMinutes(d.cookMinutes)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Labour</dt>
                  <dd className="tabular-nums">
                    {formatDollars(d.labourCents)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Ingredients (estimated)</dt>
                  <dd className="tabular-nums">
                    {formatDollars(d.ingredientsCents)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
      </ol>
    </div>
  );
}

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

export function BookingFlow({ chefId }: { chefId: string }) {
  const router = useRouter();
  const scope = useId();
  const [chefState, setChefState] = useState<ChefState>({ kind: "loading" });
  const [role, setRole] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<"form" | "review" | "sent">("form");
  const [sentId, setSentId] = useState<string | null>(null);
  const [review, setReview] = useState<BookingEstimateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<FlowAlert | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);
  const addressPrefilled = useRef(false);
  // D-40: how many requests wait for an answer, so the customer is warned before filling the form.
  const [openCount, setOpenCount] = useState<number | null>(null);
  // T-067 (D-38): the saved allergy profile. It prefills the intake answers; the customer can
  // still change them for this booking and chooses whether the changes go back to the profile.
  const [saved, setSaved] = useState<SavedIntakeResponse | null>(null);
  const [saveToProfile, setSaveToProfile] = useState(false);
  const savedRef = useRef<SavedIntakeResponse | null>(null);

  // The newest chef request wins.
  const seq = useRef(0);
  const loadChef = useCallback(
    async (silent: boolean) => {
      const mine = ++seq.current;
      if (!silent) setChefState({ kind: "loading" });
      try {
        const chef = await apiFetch<PublicChefDetail>(
          `/api/chefs/${encodeURIComponent(chefId)}`,
        );
        if (mine !== seq.current) return;
        if (!isChefDetail(chef)) {
          if (!silent) setChefState({ kind: "error" });
          return;
        }
        setChefState({ kind: "ready", chef });
        // A date that is no longer offered is cleared, so the customer picks again.
        const open = new Set(chef.bookableDates);
        setDraft((d) => ({
          ...d,
          days: d.days.map((x) =>
            x.date && !open.has(x.date) ? { ...x, date: "" } : x,
          ),
        }));
      } catch (err) {
        if (mine !== seq.current) return;
        if (silent) return;
        setChefState(
          err instanceof ApiClientError && err.status === 404
            ? { kind: "notFound" }
            : { kind: "error" },
        );
      }
    },
    [chefId],
  );

  useEffect(() => {
    void loadChef(false); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [loadChef]);

  // Who is signed in: the role gate, and the home address as a starting point for the cooking address.
  useEffect(() => {
    let current = true;
    apiFetch<MeResponse>("/api/me").then(
      (me) => {
        if (!current) return;
        setRole(me.profile.role);
        const a = me.private.address;
        if (a && !addressPrefilled.current) {
          addressPrefilled.current = true;
          setDraft((d) =>
            d.address.line || d.address.city || d.address.postalCode
              ? d
              : {
                  ...d,
                  address: {
                    line: a.line,
                    city: a.city,
                    postalCode: a.postalCode,
                  },
                },
          );
        }
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "customer" || phase === "review") return;
    let current = true;
    apiFetch<{ items: unknown[] }>(
      "/api/bookings?status=requested&limit=20",
    ).then(
      (r) => {
        if (current && Array.isArray(r?.items)) setOpenCount(r.items.length);
      },
      () => {}, // the server still refuses a fourth request (TOO_MANY_OPEN_REQUESTS)
    );
    return () => {
      current = false;
    };
  }, [role, phase]);

  // T-067: load the saved profile once, and fill the intake answers only if nothing is typed yet.
  useEffect(() => {
    if (role !== "customer") return;
    let current = true;
    apiFetch<SavedIntakeResponse>("/api/me/intake").then(
      (r) => {
        if (!current) return;
        savedRef.current = r;
        setSaved(r);
        const fill = r.intake;
        if (fill)
          setDraft((d) =>
            intakeIsUntouched(d) ? { ...d, ...draftFromSaved(fill) } : d,
          );
      },
      () => {}, // no profile is not an error for the booking: the customer just fills the form
    );
    return () => {
      current = false;
    };
  }, [role]);

  useEffect(() => {
    document.title =
      chefState.kind === "ready"
        ? `Book ${chefState.chef.displayName} — CookNeighbour`
        : "Book a chef — CookNeighbour";
  }, [chefState]);

  // Focus moves after any error (lessons-learned section 3): to the alert when there is one (it
  // explains what happened), else to the error summary.
  useEffect(() => {
    if (focusTick) (alert ? alertRef : summaryRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new attempt moves focus
  }, [focusTick]);
  useEffect(() => {
    // One owner moves focus per attempt: when an alert is showing (for example after "Book at full
    // price instead") the alert effect above already focused it, so the heading must not steal it.
    if (alert) return;
    if (phase === "review") reviewHeadingRef.current?.focus();
    else if (review) formHeadingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a step change moves focus
  }, [phase, review]);

  const chef = chefState.kind === "ready" ? chefState.chef : null;

  const patch = (p: Partial<BookingDraft>, clear: string[] = []) => {
    setDraft((d) => ({ ...d, ...p }));
    if (clear.length)
      setErrors((e) => {
        const n = { ...e };
        for (const k of clear) delete n[k];
        return n;
      });
  };
  const patchDay = (i: number, p: Partial<DayDraft>, clear: string[]) => {
    setDraft((d) => ({
      ...d,
      days: d.days.map((x, j) => (j === i ? { ...x, ...p } : x)),
    }));
    setErrors((e) => {
      const n = { ...e };
      for (const k of clear) delete n[k];
      return n;
    });
  };

  function showAlert(a: FlowAlert) {
    setAlert(a);
    setFocusTick((t) => t + 1);
  }

  /** Goes back to the form with these answers marked. */
  function backToForm(fields: FieldErrors, message?: string) {
    setErrors(fields);
    setPhase("form");
    setReview(null);
    setAlert(message ? { message } : null);
    setFocusTick((t) => t + 1);
  }

  async function runEstimate(d: BookingDraft, c: PublicChefDetail) {
    const body = buildRequest(c.id, d, c.dishes, d.useFreeTrial);
    const r = await apiFetch<BookingEstimateResponse>(
      "/api/bookings/estimate",
      { method: "POST", body },
    );
    return r;
  }

  async function onReview(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !chef) return;
    setAlert(null);
    const local = localProblems(draft, chef.dishes, chef.locationOptions);
    setErrors(local);
    if (Object.keys(local).length) {
      setFocusTick((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      const r = await runEstimate(draft, chef);
      if (r.issues.some((i) => i.code === "CHEF_NOT_BOOKABLE")) {
        setChefState({ kind: "notFound" });
        return;
      }
      if (!estimateIsSendable(r)) {
        const fields = issuesToErrors(r.issues);
        if (Object.keys(fields).length === 0)
          fields.days = "Check your days and dishes and try again.";
        if (Object.keys(fields).some((k) => /^days\.\d+\.date$/.test(k)))
          void loadChef(true);
        setErrors(fields);
        setFocusTick((t) => t + 1);
        return;
      }
      setErrors({});
      setReview(r);
      setPhase("review");
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(false);
    }
  }

  function handleFailure(err: unknown) {
    const f = classifyBookingError(err);
    switch (f.kind) {
      case "not_found":
        setChefState({ kind: "notFound" });
        return;
      case "signed_out":
        showAlert({
          message: "Your session ended. Log in again to send your request.",
          action: (
            <Link href="/login" className={linkCls}>
              Log in
            </Link>
          ),
        });
        return;
      case "too_many_open":
        showAlert({
          message: f.message,
          action: (
            <Link href="/bookings" className={linkCls}>
              See your requests
            </Link>
          ),
        });
        return;
      case "phone":
        showAlert({
          message: f.message,
          action: (
            <Link href="/verify-phone" className={linkCls}>
              Verify your phone number
            </Link>
          ),
        });
        return;
      case "address":
        showAlert({
          message: f.message,
          action: (
            <Link href="/address" className={linkCls}>
              Save your home address
            </Link>
          ),
        });
        return;
      case "trial_used":
        showAlert({
          message:
            "Your free first booking is not available any more, so nothing was sent. You can book at the full price instead: the estimate will update first.",
          action: (
            <button
              type="button"
              className={secondaryButtonCls}
              onClick={() => void bookAtFullPrice()}
            >
              Book at full price instead
            </button>
          ),
        });
        return;
      case "date_conflict":
        void loadChef(true);
        backToForm(f.fields, f.message);
        return;
      case "fields":
        if (Object.keys(f.fields).some((k) => /^days\.\d+\.date$/.test(k)))
          void loadChef(true);
        backToForm(
          Object.keys(f.fields).length
            ? f.fields
            : { days: "Check your answers and try again." },
        );
        return;
      case "other":
        showAlert({ message: f.message });
    }
  }

  async function bookAtFullPrice() {
    if (!chef || busy) return;
    const next = { ...draft, useFreeTrial: false };
    setDraft(next);
    setAlert(null);
    setBusy(true);
    try {
      const r = await runEstimate(next, chef);
      if (!estimateIsSendable(r)) {
        backToForm(issuesToErrors(r.issues));
        return;
      }
      setReview(r);
      setPhase("review");
      setAlert({
        message:
          "The estimate below is at the full price (no free first booking). Check it, then send your request.",
      });
      setFocusTick((t) => t + 1);
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (busy || !chef || !review) return;
    setAlert(null);
    setBusy(true);
    try {
      const sendTrial = draft.useFreeTrial && review.freeTrial.eligible;
      const created = await apiFetch<BookingDetail>("/api/bookings", {
        method: "POST",
        body: buildRequest(chef.id, draft, chef.dishes, sendTrial),
      });
      // The form is closed before leaving, so coming back to this page never shows a request that
      // was already sent (or a review whose dates are now taken).
      setSentId(created.id);
      setPhase("sent");
      setReview(null);
      // T-067: a failed profile save never fails the booking; the next page says so.
      let profileFailed = false;
      if (saveToProfile) {
        try {
          await apiFetch<SavedIntakeResponse>("/api/me/intake", {
            method: "PUT",
            body: intakeFromDraft(draft),
          });
        } catch {
          profileFailed = true;
        }
      }
      router.push(
        `/bookings/${encodeURIComponent(created.id)}?sent=1${profileFailed ? "&profile=notsaved" : ""}`,
      );
    } catch (err) {
      handleFailure(err);
      setBusy(false);
    }
  }

  return (
    <FieldScopeProvider value={`bk${scope}-`}>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
        <p>
          <Link
            href={`/chefs/${encodeURIComponent(chefId)}`}
            className={linkCls}
          >
            Back to the chef page
          </Link>
        </p>

        {chefState.kind === "loading" && (
          <p role="status" data-testid="loading">
            Loading the chef...
          </p>
        )}
        {chefState.kind === "notFound" && (
          <div data-testid="not-found" className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              This chef cannot be booked
            </h1>
            <p>
              We could not find this chef, or the chef is not taking bookings
              right now. Nothing was sent.
            </p>
            <p>
              <Link href="/search" className={linkCls}>
                Search for a home cook
              </Link>
            </p>
          </div>
        )}
        {chefState.kind === "error" && (
          <div
            role="alert"
            data-testid="load-error"
            className="flex flex-col gap-3"
          >
            <h1 className="text-2xl font-semibold tracking-tight">
              The booking page did not load
            </h1>
            <p>Something went wrong on our side or the connection dropped.</p>
            <p>
              <button
                type="button"
                onClick={() => void loadChef(false)}
                className={secondaryButtonCls}
              >
                Try again
              </button>
            </p>
          </div>
        )}

        {chef && role !== null && role !== "customer" && (
          <div role="alert" data-testid="not-customer" className={warnBoxCls}>
            Only customer accounts can book a chef. Log in with a customer
            account to continue.
          </div>
        )}

        {chef && (
          <>
            <header className="flex flex-col gap-1">
              <h1
                ref={formHeadingRef}
                tabIndex={-1}
                className="text-2xl font-semibold tracking-tight"
              >
                Book {chef.displayName}
              </h1>
              {phase !== "sent" && (
                <p className={hintCls}>
                  Step {phase === "form" ? "1" : "2"} of 2:{" "}
                  {phase === "form" ? "your request" : "review and send"}.
                  Nothing is sent, and nothing is charged, until you press
                  &quot;Send booking request&quot; on the second step.
                </p>
              )}
            </header>

            {phase === "sent" && sentId && (
              <div
                role="status"
                data-testid="sent-panel"
                className="flex flex-col gap-3 rounded-md border-2 border-emerald-800 bg-emerald-50 p-3 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50"
              >
                <p className="font-semibold">
                  Your request was sent. Nothing was charged.
                </p>
                <p>
                  <Link
                    href={`/bookings/${encodeURIComponent(sentId)}`}
                    className={linkCls}
                  >
                    View your booking
                  </Link>
                </p>
                <p>
                  <button
                    type="button"
                    className={secondaryButtonCls}
                    onClick={() => {
                      const fill = savedRef.current?.intake;
                      setDraft((d) => ({
                        ...emptyDraft(),
                        address: d.address,
                        ...(fill ? draftFromSaved(fill) : {}),
                      }));
                      setSaveToProfile(false);
                      setPhase("form");
                      setSentId(null);
                      void loadChef(true);
                    }}
                  >
                    Book another visit with this chef
                  </button>
                </p>
              </div>
            )}

            {alert && (
              <div
                ref={alertRef}
                tabIndex={-1}
                role="alert"
                data-testid="flow-alert"
                className={dangerBoxCls}
              >
                <p>{alert.message}</p>
                {alert.action && <p className="mt-2">{alert.action}</p>}
              </div>
            )}

            {phase === "form" &&
              openCount !== null &&
              openCount >= MAX_OPEN_REQUESTS && (
                <div data-testid="open-limit-warning" className={warnBoxCls}>
                  <p className="font-semibold">
                    <span aria-hidden="true">&#9888; </span>
                    You already have {openCount} requests waiting for an answer.
                  </p>
                  <p>
                    You can have up to {MAX_OPEN_REQUESTS} at a time, so a chef
                    is never asked by someone who is waiting on others. A new
                    request will be refused until a chef answers one or you
                    cancel one.{" "}
                    <Link href="/bookings" className={linkCls}>
                      See your requests
                    </Link>
                  </p>
                </div>
              )}

            {phase === "form" && (
              <FormStep
                chef={chef}
                draft={draft}
                errors={errors}
                summaryRef={summaryRef}
                busy={busy}
                onSubmit={onReview}
                patch={patch}
                patchDay={patchDay}
                setDraft={setDraft}
                setErrors={setErrors}
                saved={saved}
                saveToProfile={saveToProfile}
                setSaveToProfile={setSaveToProfile}
              />
            )}
            {phase === "review" && review && (
              <ReviewStep
                chef={chef}
                draft={draft}
                review={review}
                busy={busy}
                headingRef={reviewHeadingRef}
                onEdit={() => {
                  setPhase("form");
                  setAlert(null);
                }}
                onSend={onSend}
              />
            )}
          </>
        )}
      </main>
    </FieldScopeProvider>
  );
}

/** Tells the customer where prefilled answers came from (T-067). */
function SavedProfileNote({ saved }: { saved: SavedIntakeResponse | null }) {
  if (!saved?.intake) return null;
  return (
    <p data-testid="prefilled-note" className={hintCls}>
      Filled in from your saved allergy profile
      {saved.savedAt ? ` (saved ${savedOn(saved.savedAt)})` : ""}. You can
      change anything for this booking. Your saved profile stays as it is unless
      you choose to update it below.{" "}
      <Link href="/allergies" className={linkCls}>
        Open your allergy profile
      </Link>
    </p>
  );
}

/** The choice to save this form's answers back to the profile (T-067). */
function SaveToProfile({
  draft,
  saved,
  checked,
  onChange,
}: {
  draft: BookingDraft;
  saved: SavedIntakeResponse | null;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useDomId("save-to-profile");
  if (saved === null) return null; // still loading, or the profile is unavailable
  const current = intakeFromDraft(draft);
  // Nothing to offer while the answers already equal the saved profile.
  if (saved.intake && sameIntake(saved.intake, current)) return null;
  return (
    <div data-testid="save-to-profile" className="flex flex-col gap-1">
      <Choice
        type="checkbox"
        id={id}
        label={
          saved.intake
            ? "Replace my saved allergy profile with these answers"
            : "Save these answers to my allergy profile for next time"
        }
        description="This is saved after your request is sent. A chef only sees the answers you send with a request, never your profile."
        checked={checked}
        onChange={onChange}
      />
    </div>
  );
}

function savedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
  });
}

// ---------------------------------------------------------------------------
// Step 1: the form
// ---------------------------------------------------------------------------
function FormStep({
  chef,
  draft,
  errors,
  summaryRef,
  busy,
  onSubmit,
  patch,
  patchDay,
  setDraft,
  setErrors,
  saved,
  saveToProfile,
  setSaveToProfile,
}: {
  saved: SavedIntakeResponse | null;
  saveToProfile: boolean;
  setSaveToProfile: (v: boolean) => void;
  chef: PublicChefDetail;
  draft: BookingDraft;
  errors: FieldErrors;
  summaryRef: React.RefObject<HTMLDivElement | null>;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  patch: (p: Partial<BookingDraft>, clear?: string[]) => void;
  patchDay: (i: number, p: Partial<DayDraft>, clear: string[]) => void;
  setDraft: React.Dispatch<React.SetStateAction<BookingDraft>>;
  setErrors: React.Dispatch<React.SetStateAction<FieldErrors>>;
}) {
  const hid = useId();
  const conflicts = useMemo(
    () => localConflicts(draft, chef.dishes),
    [draft, chef.dishes],
  );
  const dayCountId = useDomId("day-count");
  const ackId = useDomId("allergyConflictAcknowledged");
  const offered = chef.locationOptions;
  const labels = Object.fromEntries(
    offered.map((o, i) => [o, locationLabels(offered)[i]]),
  ) as Record<LocationType, string>;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Booking request"
      className="flex flex-col gap-5"
    >
      <ErrorSummary errors={errors} innerRef={summaryRef} />

      <section aria-labelledby={`${hid}-days-h`} className={cardCls}>
        <h2 id={`${hid}-days-h`} className="text-lg font-semibold">
          Days and dishes
        </h2>
        <p className={hintCls}>
          Book 1 to 3 days. Each day is one visit, and the earliest day is
          tomorrow. Pick the dishes for each day: the chef&apos;s cooking time
          for a visit is the sum of its dishes, and one visit can last at most 6
          hours.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={dayCountId} className="text-sm font-medium">
            How many days?
          </label>
          <select
            id={dayCountId}
            value={draft.days.length}
            onChange={(e) =>
              patch({ days: resizeDays(draft.days, Number(e.target.value)) })
            }
            className={`${inputCls} sm:max-w-40`}
          >
            {Array.from({ length: MAX_BOOKING_DAYS }, (_, i) => i + 1).map(
              (n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "day" : "days"}
                </option>
              ),
            )}
          </select>
        </div>
        {draft.days.map((day, i) => (
          <DayFields
            key={i}
            index={i}
            day={day}
            chef={chef}
            taken={draft.days
              .filter((_, j) => j !== i)
              .map((x) => x.date)
              .filter(Boolean)}
            errors={errors}
            patchDay={patchDay}
            // Picking or removing a dish can change the allergy warning.
            onDishChange={() =>
              setErrors((e) => {
                const n = { ...e };
                delete n.allergyConflictAcknowledged;
                return n;
              })
            }
          />
        ))}
      </section>

      <section aria-labelledby={`${hid}-where-h`} className={cardCls}>
        <h2 id={`${hid}-where-h`} className="text-lg font-semibold">
          Where should the chef cook?
        </h2>
        <Question
          legend="Cooking location"
          errorKey="locationType"
          error={errors.locationType}
        >
          {offered.map((o) => (
            <Choice
              key={o}
              type="radio"
              name="locationType"
              value={o}
              label={labels[o]}
              checked={draft.locationType === o}
              onChange={() => patch({ locationType: o }, ["locationType"])}
              description={
                o === "customer_home"
                  ? "The chef comes to you. A travel fee applies."
                  : "You go to the chef's kitchen to pick up the meals. No travel fee."
              }
            />
          ))}
        </Question>
        {draft.locationType === "customer_home" && (
          <div className="flex flex-col gap-3">
            <p className={hintCls}>
              Where will the chef cook? This can be different from your home
              address. The chef sees it only after they accept your request.
            </p>
            <Input
              label="Street address"
              errorKey="address.line"
              error={errors["address.line"]}
              autoComplete="street-address"
              maxLength={120}
              value={draft.address.line}
              onChange={(e) =>
                patch({ address: { ...draft.address, line: e.target.value } }, [
                  "address.line",
                ])
              }
            />
            <Input
              label="City"
              errorKey="address.city"
              error={errors["address.city"]}
              autoComplete="address-level2"
              maxLength={80}
              value={draft.address.city}
              onChange={(e) =>
                patch({ address: { ...draft.address, city: e.target.value } }, [
                  "address.city",
                ])
              }
            />
            <Input
              label="Postal code"
              errorKey="address.postalCode"
              error={errors["address.postalCode"]}
              autoComplete="postal-code"
              hint={`Must be in the Greater Toronto Area and within ${chef.serviceRadiusKm} km of the chef's area.`}
              maxLength={10}
              value={draft.address.postalCode}
              onChange={(e) =>
                patch(
                  { address: { ...draft.address, postalCode: e.target.value } },
                  ["address.postalCode"],
                )
              }
            />
          </div>
        )}
        {draft.locationType === "chef_home" && (
          <p data-testid="chef-home-note" className={hintCls}>
            The chef&apos;s kitchen address is shared with you only once the
            chef accepts your request. You will pick up your meals on the agreed
            day.
          </p>
        )}
      </section>

      <section aria-labelledby={`${hid}-groc-h`} className={cardCls}>
        <h2 id={`${hid}-groc-h`} className="text-lg font-semibold">
          Groceries
        </h2>
        <Question
          legend="Who buys the ingredients?"
          errorKey="groceryOption"
          error={errors.groceryOption}
          hint="Ingredients are always paid at cost: there is no markup. No grocery app is connected."
        >
          <Choice
            type="radio"
            name="groceryOption"
            value="customer_buys"
            label="I buy the ingredients"
            checked={draft.groceryOption === "customer_buys"}
            onChange={() =>
              patch({ groceryOption: "customer_buys" as GroceryOption }, [
                "groceryOption",
              ])
            }
            description={
              draft.locationType === "chef_home"
                ? "Cheaper. You will see the chef's shopping list, and you deliver or send the ingredients to the chef."
                : "Cheaper. You will see the chef's shopping list and have the ingredients ready at the cooking location."
            }
          />
          <Choice
            type="radio"
            name="groceryOption"
            value="chef_shops"
            label="The chef shops"
            checked={draft.groceryOption === "chef_shops"}
            onChange={() =>
              patch({ groceryOption: "chef_shops" as GroceryOption }, [
                "groceryOption",
              ])
            }
            description="The chef buys the groceries (or arranges a grocery delivery) and uploads the receipt. You reimburse the receipt amount, at cost."
          />
        </Question>
      </section>

      <section aria-labelledby={`${hid}-intake-h`} className={cardCls}>
        <h2 id={`${hid}-intake-h`} className="text-lg font-semibold">
          Allergies and dietary needs (required)
        </h2>
        <p className={hintCls}>
          Everyone answers these questions. The chef reads your answers before
          accepting. Your answers are matched against each dish&apos;s
          allergens, but only the chef&apos;s list and your own care make a meal
          safe.
        </p>
        <SavedProfileNote saved={saved} />
        <IntakeFields
          draft={draft}
          errors={errors}
          patch={patch}
          afterAllergies={
            conflicts.length > 0 && (
              <div
                role="alert"
                data-testid="allergy-conflict"
                className={warnBoxCls}
              >
                <p className="font-semibold">
                  <span aria-hidden="true">&#9888; </span>
                  Allergy warning
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {conflicts.map((c) => (
                    <li key={c.dishId}>
                      {c.dishName} contains {c.allergens.join(", ")}, which
                      matches what you wrote.
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  Remove the dish, or confirm that you understand and still want
                  it.
                </p>
                <div className="mt-2">
                  <Choice
                    type="checkbox"
                    id={ackId}
                    label="I understand and want to keep these dishes"
                    checked={draft.conflictAcknowledged}
                    invalid={Boolean(errors.allergyConflictAcknowledged)}
                    onChange={(c) =>
                      patch({ conflictAcknowledged: c }, [
                        "allergyConflictAcknowledged",
                      ])
                    }
                  />
                  {errors.allergyConflictAcknowledged && (
                    <p className={errCls}>
                      {errors.allergyConflictAcknowledged}
                    </p>
                  )}
                </div>
              </div>
            )
          }
        />
        <SaveToProfile
          draft={draft}
          saved={saved}
          checked={saveToProfile}
          onChange={setSaveToProfile}
        />
      </section>

      <section aria-labelledby={`${hid}-trial-h`} className={cardCls}>
        <h2 id={`${hid}-trial-h`} className="text-lg font-semibold">
          Free first booking
        </h2>
        <Choice
          type="checkbox"
          label="Use my free first booking"
          checked={draft.useFreeTrial}
          onChange={(c) => setDraft((d) => ({ ...d, useFreeTrial: c }))}
          description="Each customer gets one booking with free labour. You still pay for ingredients, and the travel fee when the chef comes to your home. We check at the next step whether it is available to you."
        />
        <p className={hintCls}>
          <span className="font-medium">MOCK:</span> in this prototype the
          chef&apos;s pay for the free booking is simulated.
        </p>
      </section>

      <p>
        <button type="submit" disabled={busy} className={buttonCls}>
          {busy ? "Checking..." : "Review my request"}
        </button>
      </p>
    </form>
  );
}

function DayFields({
  index,
  day,
  chef,
  taken,
  errors,
  patchDay,
  onDishChange,
}: {
  index: number;
  day: DayDraft;
  chef: PublicChefDetail;
  taken: string[];
  errors: FieldErrors;
  patchDay: (i: number, p: Partial<DayDraft>, clear: string[]) => void;
  onDishChange: () => void;
}) {
  const n = index + 1;
  const dateKey = `days.${index}.date`;
  const dishKey = `days.${index}.dishes`;
  const minutes = dayMinutes(day, chef.dishes);
  const over = visitLimitMessage(minutes);
  const groups = groupDatesByMonth(
    chef.bookableDates.filter((d) => d >= chef.firstBookableDay),
  );
  const takenSet = new Set(taken);
  const dateId = useDomId(dateKey);
  const dishId = useDomId(dishKey);
  const dishErr = errors[dishKey];
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
      data-testid="day"
    >
      <legend className="px-1 text-base font-semibold">Day {n}</legend>
      <div className="flex flex-col gap-1">
        <label htmlFor={dateId} className="text-sm font-medium">
          Date for day {n}
        </label>
        <select
          id={dateId}
          value={day.date}
          aria-invalid={errors[dateKey] ? true : undefined}
          aria-describedby={errors[dateKey] ? `${dateId}-error` : undefined}
          onChange={(e) => patchDay(index, { date: e.target.value }, [dateKey])}
          className={`${inputCls} sm:max-w-72`}
        >
          <option value="">Choose a date</option>
          {groups.map((g) => (
            <optgroup key={g.month} label={g.label}>
              {g.dates
                .filter((d) => !takenSet.has(d))
                .map((d) => (
                  <option key={d} value={d}>
                    {shortDayLabel(d)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {groups.length === 0 && (
          <p className={hintCls}>
            This chef has no free days to book right now.
          </p>
        )}
        {errors[dateKey] && (
          <p id={`${dateId}-error`} className={errCls}>
            {errors[dateKey]}
          </p>
        )}
      </div>

      <div
        id={dishId}
        tabIndex={-1}
        role="group"
        aria-labelledby={`${dishId}-label`}
        aria-describedby={dishErr ? `${dishId}-error` : undefined}
        className="flex flex-col gap-2"
      >
        <p id={`${dishId}-label`} className="text-sm font-medium">
          Dishes for day {n}
        </p>
        <ul className="flex flex-col gap-2">
          {chef.dishes.map((dish) => (
            <DishPick
              key={dish.id}
              dayNo={n}
              dish={dish}
              currency={chef.currency}
              quantity={day.quantities[dish.id] ?? 0}
              onChange={(q) => {
                const quantities = { ...day.quantities };
                if (q <= 0) delete quantities[dish.id];
                else quantities[dish.id] = q;
                patchDay(index, { quantities }, [dishKey]);
                onDishChange();
              }}
            />
          ))}
        </ul>
        {dishErr && (
          <p id={`${dishId}-error`} className={errCls}>
            {dishErr}
          </p>
        )}
      </div>

      <p className="text-sm" data-testid="day-total">
        Cooking time for day {n}:{" "}
        <span className="font-semibold">
          {minutes === 0 ? "no dishes yet" : formatMinutes(minutes)}
        </span>
      </p>
      {over && (
        <div role="alert" data-testid="visit-limit" className={warnBoxCls}>
          <span aria-hidden="true">&#9888; </span>
          <span className="font-semibold">Too long for one visit. </span>
          {over}
        </div>
      )}
    </fieldset>
  );
}

function DishPick({
  dayNo,
  dish,
  currency,
  quantity,
  onChange,
}: {
  dayNo: number;
  dish: PublicDish;
  currency: string;
  quantity: number;
  onChange: (q: number) => void;
}) {
  const id = useId();
  return (
    <li
      data-testid="dish-pick"
      className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
    >
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={quantity > 0}
          aria-describedby={`${id}-info`}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
          className="mt-1 size-5 shrink-0 accent-emerald-800"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
          <label htmlFor={id} className="font-semibold">
            {dish.name}
            <span className="sr-only"> on day {dayNo}</span>
          </label>
          <div id={`${id}-info`} className="flex flex-col gap-1 text-sm">
            {dish.description && <p>{dish.description}</p>}
            <p>
              <span className="font-medium">Cooking time:</span>{" "}
              {formatMinutes(dish.cookMinutes)}
              {" · "}
              <span className="font-medium">Serves:</span> {dish.servings}
            </p>
            <p>
              <span className="font-medium">Estimated ingredient cost:</span>{" "}
              {formatDollars(dish.ingredientCostCents)}
              {currency === "CAD" ? "" : ` ${currency}`}
              {" · "}
              <span className="font-medium">Eat by:</span>{" "}
              {eatByText(dish.shelfLifeDays)}
            </p>
            <p className="rounded-md border-2 border-amber-700 bg-amber-50 px-2 py-1 font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-50">
              <span aria-hidden="true">&#9888; </span>
              {allergenText(dish.allergens)}
            </p>
          </div>
        </div>
      </div>
      {quantity > 0 && (
        <div className="flex items-center gap-2 pl-8">
          <label htmlFor={`${id}-qty`} className="text-sm font-medium">
            Quantity of {dish.name}, day {dayNo}
          </label>
          <input
            id={`${id}-qty`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DISH_QUANTITY}
            step={1}
            value={quantity}
            onChange={(e) => {
              const v = Math.trunc(Number(e.target.value));
              onChange(Number.isFinite(v) && v >= 1 ? v : 1);
            }}
            className="min-h-11 w-20 rounded-md border border-zinc-400 bg-white px-2 text-base text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Step 2: review and send
// ---------------------------------------------------------------------------
function ReviewStep({
  chef,
  draft,
  review,
  busy,
  headingRef,
  onEdit,
  onSend,
}: {
  chef: PublicChefDetail;
  draft: BookingDraft;
  review: BookingEstimateResponse;
  busy: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onEdit: () => void;
  onSend: () => void;
}) {
  const hid = useId();
  const est = review.estimate!;
  const location = draft.locationType as LocationType;
  const first = earliestDate(draft);
  const late = first ? isInsideLateWindow(first, new Date()) : false;
  const trialApplied = draft.useFreeTrial && review.freeTrial.eligible;
  const blocker = review.freeTrial.blocker;
  const phoneBlocked =
    blocker === "PHONE_NOT_SUBMITTED" || blocker === "PHONE_NOT_VERIFIED";
  const days = [...draft.days].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="flex flex-col gap-5">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold"
        data-testid="review-heading"
      >
        Review your request
      </h2>

      <section aria-labelledby={`${hid}-sum-h`} className={cardCls}>
        <h3 id={`${hid}-sum-h`} className="text-lg font-semibold">
          Your request
        </h3>
        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="font-medium">Chef</dt>
            <dd>{chef.displayName}</dd>
          </div>
          <div>
            <dt className="font-medium">Where</dt>
            <dd>
              {location === "customer_home"
                ? `At this address: ${draft.address.line.trim()}, ${draft.address.city.trim()}`
                : "At the chef's home"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Groceries</dt>
            <dd>
              {draft.groceryOption === "customer_buys"
                ? "You buy the ingredients"
                : "The chef shops and you reimburse the receipt at cost"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Allergies</dt>
            <dd>
              {draft.noAllergies
                ? "None"
                : [...draft.allergens, draft.allergyNotes.trim()]
                    .filter(Boolean)
                    .join(", ")}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Dietary needs</dt>
            <dd>{draft.noDietaryNeeds ? "None" : draft.dietaryNotes.trim()}</dd>
          </div>
        </dl>
        <ol className="flex flex-col gap-2" aria-label="Days">
          {days.map((d, i) => (
            <li
              key={d.date}
              data-testid="review-day"
              className="rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
            >
              <p className="font-semibold">
                Day {i + 1}:{" "}
                <time dateTime={d.date}>
                  {d.date ? shortDayLabel(d.date, true) : "no date chosen"}
                </time>{" "}
                ({formatMinutes(dayMinutes(d, chef.dishes))})
              </p>
              <ul className="list-disc pl-5 text-sm">
                {pickedDishes(d, chef.dishes).map((p) => (
                  <li key={p.dish.id}>
                    {p.dish.name}
                    {p.quantity > 1 ? ` x ${p.quantity}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {review.allergyConflicts.length > 0 && (
          <div data-testid="review-conflicts" className={warnBoxCls}>
            <p className="font-semibold">
              <span aria-hidden="true">&#9888; </span>
              You chose to keep dishes that match your allergies:
            </p>
            <ul className="list-disc pl-5">
              {review.allergyConflicts.map((c) => (
                <li key={c.dishId}>
                  {c.dishName} ({c.allergens.join(", ")})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby={`${hid}-est-h`} className={cardCls}>
        <h3 id={`${hid}-est-h`} className="text-lg font-semibold">
          Estimate
        </h3>
        <p className={hintCls}>
          These are estimates. Ingredient costs come from the chef&apos;s
          dishes, and the final grocery amount may differ.
        </p>
        <EstimateLines
          e={est}
          locationType={location}
          freeTrial={trialApplied}
          visits={days.length}
        />
        <PerDayEstimate
          days={est.days}
          freeTrial={trialApplied}
          location={location}
        />
        {trialApplied && (
          <p
            data-testid="trial-applied"
            className="font-medium text-emerald-900 dark:text-emerald-300"
          >
            Free first booking applied: the chef&apos;s labour is free.
          </p>
        )}
        {draft.useFreeTrial && !review.freeTrial.eligible && blocker && (
          <p data-testid="trial-blocked" className={warnBoxCls}>
            {freeTrialBlockerText(blocker)} This estimate charges labour.{" "}
            {blocker === "PHONE_NOT_SUBMITTED" ||
            blocker === "PHONE_NOT_VERIFIED" ? (
              <Link href="/verify-phone" className={linkCls}>
                Verify your phone number
              </Link>
            ) : blocker === "ADDRESS_NOT_SET" ? (
              <Link href="/address" className={linkCls}>
                Save your home address
              </Link>
            ) : null}
          </p>
        )}
      </section>

      <section aria-labelledby={`${hid}-before-h`} className={cardCls}>
        <h3 id={`${hid}-before-h`} className="text-lg font-semibold">
          Before you send
        </h3>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {review.wouldExpireAt && (
            <li data-testid="expiry-note">
              The chef has until{" "}
              <span className="font-medium">
                {formatWhen(review.wouldExpireAt)}
              </span>{" "}
              to answer. After that the request expires on its own and nothing
              is held.
            </li>
          )}
          {location === "chef_home" ? (
            <li data-testid="address-note">
              The chef&apos;s kitchen address is shared with you only once the
              chef accepts. Your phone number and the chef&apos;s are shared
              only after that too.
            </li>
          ) : (
            <li data-testid="address-note">
              The chef sees your cooking address and phone number only once they
              accept.
            </li>
          )}
          <li>
            Free cancellation ends 48 hours before your first day. A later
            cancellation is recorded as late. Nothing is charged either way in
            this prototype.
          </li>
        </ul>
        {late && (
          <div role="alert" data-testid="late-warning" className={warnBoxCls}>
            <p className="font-semibold">
              <span aria-hidden="true">&#9888; </span>
              Your first day is less than 48 hours away.
            </p>
            <p>
              If you send this request, cancelling it would already count as a
              late cancellation. Go back and pick a later first day if you want
              free cancellation.
            </p>
          </div>
        )}
      </section>

      <MockPayment />

      {phoneBlocked && (
        <p role="alert" data-testid="phone-blocked" className={dangerBoxCls}>
          You need a verified phone number before you can send a booking
          request.{" "}
          <Link href="/verify-phone" className={linkCls}>
            Verify your phone number
          </Link>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className={secondaryButtonCls}
        >
          Edit my request
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={busy || phoneBlocked}
          className={buttonCls}
        >
          {busy ? "Sending..." : "Send booking request"}
        </button>
      </div>
    </div>
  );
}
