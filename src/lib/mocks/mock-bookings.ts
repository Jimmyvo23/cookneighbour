// MOCK BOOKING ROUTES (T-043). Stand in for docs/api-contract.md section 7A (estimate, create,
// list, detail) and the customer's cancel route of "Booking changes" until the browser talks to
// the real ones. Nothing here is real: the chefs are made up (mock-search.ts), nothing is stored
// outside this browser tab, and no money moves (the payment is MOCK, as in the real API).
//
// The rules are the real pure functions: request parsing (bookingRequest.ts), validation
// (bookingValidation.ts), pricing (pricing.ts), expiry and cancellation timing, contact-detail
// check. Differences from the real API, on purpose:
//   - a customer's booking stays `requested` until it expires (D-19) or the customer cancels it:
//     no chef answers it. The chef's side (T-045: accept, decline, cooked, complete, pickups,
//     groceries) is mock-booking-changes.ts, with made-up requests for a signed-in chef;
//   - test hooks in the saved state (set from a test with sessionStorage, never by the UI):
//       hooks.otherBooked[chefId] = [dates]  another customer holds those dates, so create answers
//                                            409 DOUBLE_BOOKED (the page may still list them);
//       hooks.trialRaceOnce = true           the next create that asks for the free first booking
//                                            answers 409 FREE_TRIAL_USED (a lost race).
//       hooks.frozenSeeded = [ids]           those made-up bookings start frozen (D-53, T-064):
//                                            `frozen: true`, every change answers 409 `frozen`.
//       hooks.pickedUpSeeded = [ids]         the first cooked day of those made-up bookings starts
//                                            as picked up (T-071, D-55): `pickedUpAt` is set. A
//                                            one-day booking also gets an open, uncooked day 2,
//                                            because the server completes a booking once every day
//                                            is picked up (T-081, D-81).
//       hooks.messagesRateLimited = true     the next chat send answers 429 (T-046, mock-messages.ts).
//       hooks.messagesFailNext = true        the next chat send answers 500 once (T-047).
//   - the chat routes (T-046) are mock-messages.ts.
//   - a row whose status is edited to `accepted` shows the cookingPlace and contact like the real
//     view does (hidden before acceptance, CLAUDE.md 6.8).
import type {
  ApiError,
  ApiErrorCode,
  BookingDetail,
  BookingEstimate,
  BookingEstimateResponse,
  BookingIssue,
  BookingListResponse,
  BookingStatus,
  BookingSummary,
  FreeTrialBlocker,
  MeProfile,
  ReceiptView,
  PublicChefDetail,
} from "@/lib/api/types";
import { addDays, isRealDate, torontoToday } from "@/lib/domain/dishes";
import {
  BOOKING_KEYS,
  classifyIssues,
  issuesToFields,
  parseBookingBody,
  requestExpiry,
  type ParsedBooking,
} from "@/lib/domain/bookingRequest";
import {
  validateBooking,
  type BookableDish,
  type BookingChef,
} from "@/lib/domain/bookingValidation";
import {
  cancellationTiming,
  torontoStartOfDay,
} from "@/lib/domain/cancellation";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { MAX_OPEN_REQUESTS } from "@/lib/domain/config";
import { findContactDetails } from "@/lib/domain/contactDetails";
import { failureForFields } from "@/lib/domain/contactText";
import { estimateBooking, type Estimate } from "@/lib/domain/pricing";
import { weekday } from "@/lib/chef/calendar";
import { messageRoute, type MockMessage } from "@/lib/mocks/mock-messages";
import {
  changeRoute,
  seedChefBookings,
  seedCustomerBookings,
} from "@/lib/mocks/mock-booking-changes";
import { AVAILABILITY_HORIZON_DAYS } from "@/lib/domain/dishes";
import { hasUnsafeText } from "@/lib/domain/text-safety";
import {
  MOCK_CHEFS,
  MOCK_PREFIXES,
  type MockChef,
} from "@/lib/mocks/mock-search";

export interface MockBookingRow {
  detail: BookingDetail;
  chefId: string;
  /** The customer's cooking address (customer_home) or the chef's made-up kitchen (chef_home). */
  place: { line: string; city: string; postalCode: string };
  chefPhone: string;
  /** Made-up phone of the customer, shown to the chef once accepted (T-045). */
  customerPhone?: string;
}

export interface MockHooks {
  otherBooked?: Record<string, string[]>;
  trialRaceOnce?: boolean;
  /** T-045: the chef's kitchen was switched off, so accepting a chef's-home request answers 409. */
  chefHomeOff?: boolean;
  /** T-073 (D-59): chef's home is on but no kitchen address is saved, so accepting answers 409. */
  kitchenAddressMissing?: boolean;
  /** T-045: a signed-in customer gets the same made-up bookings, seen from their side (once). */
  seedCustomer?: boolean;
  /**
   * T-064 (D-53): ids of made-up bookings (SEEDED in e2e-mock/helpers.ts) that start frozen, as if
   * an admin flag were open. Read when the made-up bookings are brought in, so set it first.
   */
  frozenSeeded?: string[];
  /**
   * T-071 (D-55): ids of made-up bookings whose cooked days start as picked up (the customer
   * already confirmed). Read when the made-up bookings are brought in, so set it first.
   */
  pickedUpSeeded?: string[];
  /** T-046: the next message send answers 429 RATE_LIMITED (retry in 30 seconds). */
  messagesRateLimited?: boolean;
  /** T-047: the next message send answers a generic 500 INTERNAL, once (to try the retry button). */
  messagesFailNext?: boolean;
}

/** A MOCK receipt as saved: the API view plus the path the chef "uploaded" (never returned). */
export type MockReceipt = ReceiptView & { filePath: string };

/** The slice of the adapter's saved state these routes read. */
export interface BookingMockState {
  profile: MeProfile | null;
  phone: string | null;
  phoneVerified: boolean;
  address: { line: string; city: string; postalCode: string } | null;
  bookings: MockBookingRow[];
  hooks: MockHooks;
  /** T-045: made-up requests to the signed-in chef; seeded on first use. */
  chefBookings?: MockBookingRow[];
  chefSeeded?: boolean;
  customerSeeded?: boolean;
  /** T-045: receipts by booking id (both sides read them). */
  receipts?: Record<string, MockReceipt[]>;
  /** T-046: chat messages by booking id (MOCK, kept in this browser tab only). */
  messages?: Record<string, MockMessage[]>;
}

export interface BookingRouteResult {
  res: Response;
  /** New values for the saved state, when the route changed anything. */
  next?: Partial<
    Pick<
      BookingMockState,
      | "bookings"
      | "hooks"
      | "chefBookings"
      | "chefSeeded"
      | "customerSeeded"
      | "receipts"
      | "messages"
    >
  >;
}

const KITCHEN = {
  line: "12 Kitchen Rd (MOCK)",
  city: "Mississauga",
  postalCode: "L5B1A1",
};
const CHEF_PHONE = "+14165550100";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CENTRES = new Map(
  MOCK_PREFIXES.map((p) => [p.prefix, { lat: p.lat, lng: p.lng }]),
);
const ACTIVE: readonly BookingStatus[] = [
  "requested",
  "accepted",
  "completed",
  "no_show_customer",
  "no_show_chef",
];
/** Statuses that show the other party's address and phone (contract 7A, "Who sees what"). */
export const SHOWS_CONTACT: readonly BookingStatus[] = [
  "accepted",
  "completed",
  "no_show_customer",
  "no_show_chef",
];

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Partial<ApiError["error"]> = {},
): BookingRouteResult {
  return { res: json(status, { error: { code, message, ...extra } }) };
}
export const notFound = (what = "Booking") =>
  fail(404, "NOT_FOUND", `${what} not found.`);

// ---------------------------------------------------------------------------
// Lazy expiry (D-19): a requested booking past expiresAt becomes expired
// ---------------------------------------------------------------------------
export function sweepMock(
  rows: MockBookingRow[],
  now: Date,
): MockBookingRow[] | null {
  let changed = false;
  const out = rows.map((r) => {
    const d = r.detail;
    if (
      d.status === "requested" &&
      d.expiresAt &&
      new Date(d.expiresAt).getTime() <= now.getTime()
    ) {
      changed = true;
      return { ...r, detail: { ...d, status: "expired" as const } };
    }
    return r;
  });
  return changed ? out : null;
}

/**
 * What the viewer sees of a stored row: contact details only once accepted (CLAUDE.md 6.8).
 * Customer: always their own cooking address (customer_home); the chef's kitchen and phone after
 * acceptance. Chef (T-045): the customer's cooking address and phone after acceptance; never a
 * kitchen address (it is their own).
 */
export function viewOf(
  r: MockBookingRow,
  role: "customer" | "chef" = "customer",
  now: Date = new Date(),
): BookingDetail {
  const d = r.detail;
  // D-52 (T-065): contact is hidden again at 00:00 Toronto on the last visit day + 8 (this mirrors
  // `booking_contact_ends_at`). `contactVisibleUntil` is null whenever contact is hidden.
  const last = d.days.map((x) => x.date).sort()[d.days.length - 1];
  const endsAt = last ? torontoStartOfDay(addDays(last, 8)) : null;
  const shows =
    SHOWS_CONTACT.includes(d.status) &&
    (!endsAt || now.getTime() < endsAt.getTime());
  const contactVisibleUntil = shows && endsAt ? endsAt.toISOString() : null;
  if (role === "chef")
    return {
      ...d,
      viewerRole: "chef",
      contactVisibleUntil,
      cookingPlace:
        shows && d.locationType === "customer_home" ? r.place : null,
      contact: shows
        ? {
            displayName: d.customer.displayName,
            phone: r.customerPhone ?? "+14165550111",
          }
        : null,
    };
  const own = d.locationType === "customer_home"; // the customer's own cooking address
  return {
    ...d,
    contactVisibleUntil,
    cookingPlace: own || shows ? r.place : null,
    contact: shows
      ? { displayName: d.chef.displayName, phone: r.chefPhone }
      : null,
  };
}

function chefById(id: string): MockChef | undefined {
  return UUID.test(id) ? MOCK_CHEFS.find((c) => c.id === id) : undefined;
}

function bookableChef(c: MockChef, today: string): BookingChef {
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  const dates: string[] = [];
  for (let d = addDays(today, 1); d <= last; d = addDays(d, 1))
    if (c.weekdays.includes(weekday(d))) dates.push(d);
  const centre = MOCK_PREFIXES.find((p) => p.prefix === c.servicePrefix);
  return {
    id: c.id,
    status: "approved",
    locationOptions: c.locationOptions,
    chefHomeEnabled: c.chefHomeEnabled,
    serviceRadiusKm: c.serviceRadiusKm,
    serviceCentre: centre ? { lat: centre.lat, lng: centre.lng } : null,
    availableDates: dates,
    dishes: c.dishes.map((d): BookableDish => ({
      id: d.id,
      chefId: c.id,
      name: d.name,
      isActive: true,
      cookMinutes: d.cookMinutes,
      ingredientCostCents: d.ingredientCostCents,
      allergens: d.allergens,
      shelfLifeDays: d.shelfLifeDays,
    })),
  };
}

/** Dates a chef is held on: this customer's active bookings plus other customers (hook). */
export function bookedDatesOf(s: BookingMockState, chefId: string): string[] {
  const own = s.bookings
    .filter((r) => r.chefId === chefId && ACTIVE.includes(r.detail.status))
    .flatMap((r) => r.detail.days.map((d) => d.date));
  return [...own, ...(s.hooks.otherBooked?.[chefId] ?? [])];
}

// ---------------------------------------------------------------------------
// Free trial (advisory, section 11A)
// ---------------------------------------------------------------------------
function trialAdvice(s: BookingMockState): {
  eligible: boolean;
  blocker: FreeTrialBlocker | null;
} {
  if (!s.phone) return { eligible: false, blocker: "PHONE_NOT_SUBMITTED" };
  if (!s.phoneVerified)
    return { eligible: false, blocker: "PHONE_NOT_VERIFIED" };
  if (!s.address) return { eligible: false, blocker: "ADDRESS_NOT_SET" };
  const holds = s.bookings.some(
    (r) =>
      r.detail.isFreeTrial &&
      (r.detail.status === "requested" ||
        r.detail.status === "accepted" ||
        r.detail.status === "completed" ||
        r.detail.status === "no_show_customer"),
  );
  return holds
    ? { eligible: false, blocker: "USED" }
    : { eligible: true, blocker: null };
}

// ---------------------------------------------------------------------------
// Evaluation shared by estimate and create
// ---------------------------------------------------------------------------
interface Evaluation {
  issues: BookingIssue[];
  priced: {
    estimate: Estimate;
    dates: string[];
    distance: number | null;
  } | null;
  allergyConflicts: BookingEstimateResponse["allergyConflicts"];
  chef: MockChef | null;
  resolved: ReturnType<typeof validateBooking>["days"];
  today: string;
}

function evaluate(
  req: ParsedBooking,
  s: BookingMockState,
  now: Date,
  isFreeTrial: boolean,
): Evaluation {
  const today = torontoToday(now);
  const chef = chefById(req.chefId);
  if (!chef)
    return {
      issues: [
        {
          code: "CHEF_NOT_BOOKABLE",
          message: "This chef is not available for booking.",
        },
      ],
      priced: null,
      allergyConflicts: [],
      chef: null,
      resolved: [],
      today,
    };
  const v = validateBooking(
    {
      locationType: req.locationType,
      customerPostal: req.address?.postalCode,
      days: req.days,
      intake: req.intake,
      allergyConflictAcknowledged: req.allergyConflictAcknowledged,
    },
    bookableChef(chef, today),
    { today, chefBookedDates: bookedDatesOf(s, chef.id), centres: CENTRES },
  );
  const days = [...v.days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const complete =
    v.days.length >= 1 &&
    v.days.length === req.days.length &&
    v.days.every(
      (d, i) =>
        d.dishes.length === req.days[i].dishes.length && d.dishes.length > 0,
    ) &&
    (req.locationType === "chef_home" || v.distanceMetres !== null);
  let priced: Evaluation["priced"] = null;
  if (complete) {
    try {
      priced = {
        dates: days.map((d) => d.date),
        distance: v.distanceMetres,
        estimate: estimateBooking({
          hourlyRateCents: chef.hourlyRateCents ?? 0,
          locationType: req.locationType,
          isFreeTrial,
          distanceMetres: v.distanceMetres,
          days: days.map((d) => ({
            dishes: d.dishes.map((x) => ({
              cookMinutes: x.cookMinutes,
              ingredientCostCents: x.ingredientCostCents,
              quantity: x.quantity,
            })),
          })),
        }),
      };
    } catch {
      priced = null;
    }
  }
  return {
    issues: v.errors,
    priced,
    allergyConflicts: v.allergyConflicts.map((c) => ({
      dishId: c.dishId,
      dishName: c.dishName,
      allergens: c.allergens,
    })),
    chef,
    resolved: days,
    today,
  };
}

export function mapEstimate(
  e: Estimate,
  dates: string[],
  distanceMetres: number | null,
): BookingEstimate {
  return {
    cookMinutes: e.cookMinutes,
    labourCents: e.labourCents,
    labourBeforeWaiverCents: e.labourBeforeWaiverCents,
    freeTrialWaivedCents: e.freeTrialWaivedCents,
    ingredientsCents: e.ingredientsCents,
    travelCents: e.travelCents,
    platformFeeCents: e.platformFeeCents,
    platformFeePercent: e.platformFeePercent,
    platformFeeCollected: false,
    totalCents: e.totalCents,
    currency: e.currency,
    travelRateCentsPerKm: e.travelRateCentsPerKm,
    distanceKm:
      distanceMetres === null ? null : Math.round(distanceMetres / 10) / 100,
    exceedsSoftLimit: e.exceedsSoftLimit,
    days: e.days.map((d, i) => ({
      date: dates[i],
      cookMinutes: d.cookMinutes,
      labourCents: d.labourCents,
      ingredientsCents: d.ingredientsCents,
      travelCents: d.travelCents,
      platformFeeCents: d.platformFeeCents,
    })),
  };
}

function parse(
  body: unknown,
  mode: "estimate" | "create",
): { value?: ParsedBooking; fail?: BookingRouteResult } {
  const obj = (
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? body
      : {}
  ) as Record<string, unknown>;
  const unknown: Record<string, string> = {};
  for (const k of Object.keys(obj))
    if (!(BOOKING_KEYS as readonly string[]).includes(k))
      unknown[k] = "Unknown field.";
  if (Object.keys(unknown).length)
    return {
      fail: fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
        fields: unknown,
      }),
    };
  const p = parseBookingBody(obj, mode);
  if (!p.value) {
    const f = failureForFields(p.errors);
    return { fail: fail(422, f.code, f.message, { fields: p.errors }) };
  }
  return { value: p.value };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function bookingRoutes(
  method: string,
  path: string,
  body: unknown,
  s: BookingMockState,
  now: Date = new Date(),
): BookingRouteResult | null {
  const url = new URL(path, "http://mock.invalid");
  const p = url.pathname;
  const one = /^\/api\/bookings\/([^/]+)$/.exec(p);
  const cancel = /^\/api\/bookings\/([^/]+)\/cancel$/.exec(p);
  const sub = /^\/api\/bookings\/[^/]+\/.+/.exec(p) && !cancel;
  if (
    p !== "/api/bookings" &&
    p !== "/api/bookings/estimate" &&
    !one &&
    !cancel &&
    !sub
  )
    return null;

  // Session and role (the adapter already answered 401 for no session).
  const role = s.profile?.role;
  if (role !== "customer" && role !== "chef")
    return fail(403, "FORBIDDEN", "Only customers and chefs can use this.");

  // The signed-in chef sees made-up requests, seeded on first use (T-045).
  let base = s;
  let seeded: BookingRouteResult["next"];
  if (role === "chef" && !s.chefSeeded) {
    const rows = seedChefBookings(
      s.profile!,
      now,
      s.hooks.frozenSeeded,
      s.hooks.pickedUpSeeded,
    );
    base = {
      ...s,
      chefBookings: rows.rows,
      chefSeeded: true,
      receipts: rows.receipts,
    };
    seeded = {
      chefBookings: rows.rows,
      chefSeeded: true,
      receipts: rows.receipts,
    };
  }

  if (role === "customer" && s.hooks.seedCustomer && !s.customerSeeded) {
    const made = seedCustomerBookings(
      s.profile!,
      now,
      s.hooks.frozenSeeded,
      s.hooks.pickedUpSeeded,
    );
    base = {
      ...s,
      bookings: [...made.rows, ...s.bookings],
      customerSeeded: true,
      receipts: { ...(s.receipts ?? {}), ...made.receipts },
    };
    seeded = {
      bookings: base.bookings,
      customerSeeded: true,
      receipts: base.receipts,
    };
  }

  // Lazy expiry (D-19) before anything reads the list.
  const key = role === "chef" ? "chefBookings" : "bookings";
  const swept = sweepMock(base[key] ?? [], now);
  const state: BookingMockState = swept ? { ...base, [key]: swept } : base;
  const carry = (res: BookingRouteResult): BookingRouteResult => {
    const extra = {
      ...(seeded ?? {}),
      ...(swept && !res.next?.[key] ? { [key]: swept } : {}),
    };
    return Object.keys(extra).length
      ? { ...res, next: { ...extra, ...(res.next ?? {}) } }
      : res;
  };

  if (role === "chef") {
    if (p === "/api/bookings" && method === "GET")
      return carry(listRoute(url, state, "chef"));
    if (one && method === "GET")
      return carry(detailRoute(one[1], state, "chef", now));
    const talked = messageRoute(method, path, body, state, "chef", now);
    if (talked) return carry(talked);
    const changed = changeRoute(method, p, body, state, "chef", now);
    if (changed) return carry(changed);
    return carry(fail(403, "FORBIDDEN", "Only customers can use this."));
  }

  if (p === "/api/bookings/estimate" && method === "POST")
    return carry(estimateRoute(body, state, now));
  if (p === "/api/bookings" && method === "POST")
    return carry(createRoute(body, state, now));
  if (p === "/api/bookings" && method === "GET")
    return carry(listRoute(url, state, "customer"));
  if (one && method === "GET")
    return carry(detailRoute(one[1], state, "customer", now));
  if (cancel && method === "POST")
    return carry(cancelRoute(cancel[1], body, state, now));
  const talked = messageRoute(method, path, body, state, "customer", now);
  if (talked) return carry(talked);
  const changed = changeRoute(method, p, body, state, "customer", now);
  if (changed) return carry(changed);
  return carry(fail(404, "NOT_FOUND", "Not found."));
}

function estimateRoute(
  body: unknown,
  s: BookingMockState,
  now: Date,
): BookingRouteResult {
  const parsed = parse(body, "estimate");
  if (!parsed.value) return parsed.fail!;
  const req = parsed.value;
  const trial = trialAdvice(s);
  const ev = evaluate(req, s, now, req.useFreeTrial && trial.eligible);
  const first = req.days
    .map((d) => d.date)
    .filter((d) => isRealDate(d) && d > ev.today)
    .sort()[0];
  const out: BookingEstimateResponse = {
    ok: ev.issues.length === 0,
    issues: ev.issues,
    estimate: ev.priced
      ? mapEstimate(ev.priced.estimate, ev.priced.dates, ev.priced.distance)
      : null,
    allergyConflicts: ev.allergyConflicts,
    freeTrial: trial,
    today: ev.today,
    firstBookableDay: addDays(ev.today, 1),
    wouldExpireAt: first ? requestExpiry(now, first).toISOString() : null,
  };
  return { res: json(200, out) };
}

function createRoute(
  body: unknown,
  s: BookingMockState,
  now: Date,
): BookingRouteResult {
  const parsed = parse(body, "create");
  if (!parsed.value) return parsed.fail!;
  const req = parsed.value;
  if (!s.phone)
    return fail(
      409,
      "PHONE_NOT_SUBMITTED",
      "Add and verify your phone number before booking.",
    );
  if (!s.phoneVerified)
    return fail(
      409,
      "PHONE_NOT_VERIFIED",
      "Verify your phone number before booking.",
    );

  const trial = trialAdvice(s);
  const ev = evaluate(req, s, now, req.useFreeTrial && trial.eligible);
  const outcome = classifyIssues(ev.issues);
  if (outcome === "hidden") return notFound("Chef");
  if (outcome === "double_booked")
    return fail(
      409,
      "DOUBLE_BOOKED",
      "The chef is already booked on a day you asked for.",
      {
        issues: ev.issues,
      },
    );
  if (outcome === "validation")
    return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: issuesToFields(ev.issues),
      issues: ev.issues,
    });

  const hooks = s.hooks;
  if (req.useFreeTrial) {
    if (
      trial.blocker === "PHONE_NOT_SUBMITTED" ||
      trial.blocker === "PHONE_NOT_VERIFIED"
    )
      return fail(
        409,
        trial.blocker,
        "Verify your phone number to use your free first booking.",
      );
    if (trial.blocker === "ADDRESS_NOT_SET")
      return fail(
        409,
        "ADDRESS_NOT_SET",
        "Save your home address to use your free first booking.",
      );
    if (trial.blocker === "USED" || hooks.trialRaceOnce) {
      return {
        ...fail(
          409,
          "FREE_TRIAL_USED",
          "The free first booking is not available.",
        ),
        next: hooks.trialRaceOnce
          ? { hooks: { ...hooks, trialRaceOnce: false } }
          : undefined,
      };
    }
  }
  if (
    s.bookings.filter((r) => r.detail.status === "requested").length >=
    MAX_OPEN_REQUESTS
  )
    return fail(
      409,
      "TOO_MANY_OPEN_REQUESTS",
      `You already have ${MAX_OPEN_REQUESTS} requests waiting for an answer. Wait for a chef to answer, or cancel one, before asking for another.`,
    );

  const chef = ev.chef!;
  const priced = ev.priced!;
  const e = priced.estimate;
  const first = priced.dates[0];
  const detail: BookingDetail = {
    id: crypto.randomUUID(),
    status: "requested",
    viewerRole: "customer",
    locationType: req.locationType,
    groceryOption: req.groceryOption,
    isFreeTrial: req.useFreeTrial && trial.eligible,
    createdAt: now.toISOString(),
    expiresAt: requestExpiry(now, first).toISOString(),
    respondedAt: null,
    declineReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationTiming: null,
    cancelReason: null,
    completedAt: null,
    noShow: null,
    frozen: false,
    chef: { id: chef.id, displayName: chef.displayName, photoPath: null },
    customer: { id: s.profile!.id, displayName: s.profile!.displayName },
    days: ev.resolved.map((d, i) => ({
      dayNumber: i + 1,
      date: d.date,
      cookMinutes: e.days[i].cookMinutes,
      cookedAt: null,
      pickedUpAt: null,
      pickupDeadlineDate:
        req.locationType === "chef_home"
          ? addDays(d.date, Math.min(...d.dishes.map((x) => x.shelfLifeDays)))
          : null,
      pickups: [],
      dishes: d.dishes.map((x) => {
        const pub = chef.dishes.find((y) => y.id === x.id)!;
        return {
          dishId: x.id,
          name: x.name,
          quantity: x.quantity,
          cookMinutes: x.cookMinutes,
          ingredientCostCents: x.ingredientCostCents,
          servings: pub.servings,
          allergens: [...x.allergens],
          eatByDate: addDays(d.date, x.shelfLifeDays),
        };
      }),
    })),
    estimate: (() => {
      const m = mapEstimate(e, priced.dates, priced.distance);
      const {
        labourBeforeWaiverCents: _a,
        freeTrialWaivedCents: _b,
        exceedsSoftLimit: _c,
        days: _d,
        ...rest
      } = m;
      void [_a, _b, _c, _d];
      return rest;
    })(),
    intake: {
      allergies: req.intake!.allergies,
      dietaryNotes: req.intake!.dietaryNotes,
      allergyConflictAcknowledged:
        ev.allergyConflicts.length > 0 && req.allergyConflictAcknowledged,
    },
    allergyConflicts: ev.allergyConflicts,
    cookingPlace: null,
    contact: null,
    payment: { mock: true, collected: false },
  };
  const row: MockBookingRow = {
    detail,
    chefId: chef.id,
    place: req.address ?? KITCHEN,
    chefPhone: CHEF_PHONE,
  };
  return {
    res: json(201, viewOf(row)),
    next: { bookings: [row, ...s.bookings] },
  };
}

function summaryOf(
  r: MockBookingRow,
  role: "customer" | "chef",
): BookingSummary {
  const d = r.detail;
  const dates = d.days.map((x) => x.date).sort();
  return {
    id: d.id,
    status: d.status,
    locationType: d.locationType,
    groceryOption: d.groceryOption,
    isFreeTrial: d.isFreeTrial,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    firstDay: dates[0],
    dates,
    totalCents: d.estimate.totalCents,
    currency: d.estimate.currency,
    counterparty:
      role === "chef"
        ? { id: d.customer.id, displayName: d.customer.displayName }
        : { id: d.chef.id, displayName: d.chef.displayName },
    // T-082: the list reads the same state as the detail, so they always agree.
    frozen: d.frozen,
  };
}

function listRoute(
  url: URL,
  s: BookingMockState,
  role: "customer" | "chef",
): BookingRouteResult {
  const status = url.searchParams.get("status") ?? "all";
  const known = [
    "requested",
    "accepted",
    "declined",
    "cancelled",
    "completed",
    "no_show_customer",
    "no_show_chef",
    "expired",
    "open",
    "all",
  ];
  if (!known.includes(status))
    return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: { status: "Use a booking status, open or all." },
    });
  const rows = (role === "chef" ? (s.chefBookings ?? []) : s.bookings).filter(
    (r) =>
      status === "all"
        ? true
        : status === "open"
          ? r.detail.status === "requested" || r.detail.status === "accepted"
          : r.detail.status === status,
  );
  const out: BookingListResponse = {
    items: rows.map((r) => summaryOf(r, role)),
    nextCursor: null,
  };
  return { res: json(200, out) };
}

function detailRoute(
  id: string,
  s: BookingMockState,
  role: "customer" | "chef",
  now: Date = new Date(),
): BookingRouteResult {
  const rows = role === "chef" ? (s.chefBookings ?? []) : s.bookings;
  const r = UUID.test(id) ? rows.find((x) => x.detail.id === id) : undefined;
  return r ? { res: json(200, viewOf(r, role, now)) } : notFound();
}

function cancelRoute(
  id: string,
  body: unknown,
  s: BookingMockState,
  now: Date,
): BookingRouteResult {
  const r = UUID.test(id)
    ? s.bookings.find((x) => x.detail.id === id)
    : undefined;
  if (!r) return notFound();
  // Body first (optional reason), then state, as in the contract.
  const obj = (
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? body
      : {}
  ) as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => k !== "reason");
  if (extra.length)
    return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: Object.fromEntries(extra.map((k) => [k, "Unknown field."])),
    });
  let reason: string | null = null;
  if (obj.reason !== undefined && obj.reason !== null) {
    const t = typeof obj.reason === "string" ? obj.reason.trim() : "";
    if (t.length < 3 || t.length > 500)
      return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
        fields: { reason: "Use 3 to 500 characters, or leave it empty." },
      });
    if (hasUnsafeText(t, true))
      return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
        fields: { reason: "Remove control or invalid characters." },
      });
    if (findContactDetails(t))
      return fail(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "Do not put phone numbers, emails or links in the reason.",
        { fields: { reason: "Remove the contact details." } },
      );
    reason = t;
  }
  const d = r.detail;
  // T-064 (D-53, D-65): a frozen booking takes no cancel either, same text as the real route.
  if (d.frozen)
    return fail(409, "INVALID_STATE", CHANGE_REFUSALS.frozen, {
      reason: "frozen",
    });
  if (d.status !== "requested" && d.status !== "accepted")
    return fail(
      409,
      "INVALID_STATE",
      "This booking can no longer be cancelled.",
      {
        reason: "wrong_status",
      },
    );
  const today = torontoToday(now);
  if (d.days.every((x) => x.date < today))
    return fail(409, "INVALID_STATE", "There is no visit left to cancel.", {
      reason: "nothing_left",
    });
  const first = d.days.map((x) => x.date).sort()[0];
  const timing = cancellationTiming({
    now,
    firstVisitDate: first,
    cancelledBy: "customer",
  }).timing;
  const next: BookingDetail = {
    ...d,
    status: "cancelled",
    cancelledBy: "customer",
    cancelledAt: now.toISOString(),
    cancellationTiming: timing,
    cancelReason: reason,
  };
  const bookings = s.bookings.map((x) =>
    x.detail.id === id ? { ...x, detail: next } : x,
  );
  return { res: json(200, viewOf({ ...r, detail: next })), next: { bookings } };
}

/** Removes the dates this customer already holds from a chef-page answer (A-19), as the API does. */
export async function hideHeldDates(
  res: Response,
  path: string,
  s: BookingMockState,
): Promise<Response> {
  const m = /^\/api\/chefs\/([^/?]+)$/.exec(new URL(path, "http://x").pathname);
  if (!m || !res.ok) return res;
  const chef = (await res.clone().json()) as PublicChefDetail;
  // Only this customer's own bookings: dates another customer holds (the test hook) stay listed,
  // like a page that was loaded a moment before someone else booked.
  const held = new Set(
    s.bookings
      .filter((r) => r.chefId === chef.id && ACTIVE.includes(r.detail.status))
      .flatMap((r) => r.detail.days.map((d) => d.date)),
  );
  if (!held.size) return res;
  return json(200, {
    ...chef,
    bookableDates: chef.bookableDates.filter((d) => !held.has(d)),
  });
}
