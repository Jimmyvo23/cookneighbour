// MOCK BOOKING CHANGES AND GROCERY ROUTES (T-045). Stand in for docs/api-contract.md section 7A
// (accept, decline, cooked marker, visit done, pickup proposals, missed pickup) and section 7B
// (shopping list, receipts) until the browser talks to the real routes. Nothing here is real:
// the customers are made up, nothing leaves this browser tab, no money moves and no file is
// stored (a receipt "upload" only invents a path; `fileUrl` is always null, so no storage URL is
// ever built in mock mode).
//
// The checks run in the contract's order: role, booking is the caller's own (404), body (422),
// then state (409 with the same `reason` codes as the real routes). The pure rules are the real
// ones where they exist: contact-detail filter, text safety, pickup deadline and time parsing
// (bookingChanges.ts), receipt body and answer parsing and the mismatch check (groceries.ts,
// receipt.ts), the shopping list and plan (groceries.ts), pricing (pricing.ts).
//
// Made-up requests for the signed-in chef are seeded on first use (`seedChefBookings`). Dates are
// relative to today, so the screens always have something to do:
//   a01 requested, customer's home, allergy conflict (Satay vs peanuts), free first booking
//   a02 requested, chef's home, chef shops (kitchen address is shared only after accepting)
//   a03 accepted, chef's home, day 1 cooked, a pickup time waiting for the chef's answer
//   a04 accepted, customer's home, chef shops, day 1 is today: shop, upload a receipt, cook
//   a05 accepted, chef's home, day 1 cooked, pickup window over: "pickup missed" is possible
//   a06 accepted, customer's home, chef shops, cooked, a flagged receipt waits for the customer
// Test hook (saved state, set from a test only): hooks.chefHomeOff = true makes accepting a
// chef's-home request answer 409 `chef_home_not_enabled`.
import type {
  BookingDetail,
  MeProfile,
  ReceiptList,
  ReceiptView,
  ShoppingListResponse,
} from "@/lib/api/types";
import {
  CHANGE_REFUSALS,
  PICKUP_RANGE_MESSAGES,
  parseDayNumber,
  parsePickupAccept,
  parseProposedAt,
  pickupDeadline,
} from "@/lib/domain/bookingChanges";
import { findContactDetails } from "@/lib/domain/contactDetails";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { estimateBooking } from "@/lib/domain/pricing";
import { hasUnsafeText } from "@/lib/domain/text-safety";
import {
  RECEIPT_REFUSALS,
  buildShoppingList,
  groceryPlan,
  parseReceiptAnswer,
  parseReceiptBody,
} from "@/lib/domain/groceries";
import { checkReceipt } from "@/lib/domain/receipt";
import {
  fail,
  json,
  mapEstimate,
  notFound,
  viewOf,
  UUID,
  type BookingMockState,
  type BookingRouteResult,
  type MockBookingRow,
  type MockReceipt,
} from "@/lib/mocks/mock-bookings";

type Role = "customer" | "chef";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHEF_PHONE = "+14165550100";
const KITCHEN = {
  line: "12 Kitchen Rd (MOCK)",
  city: "Mississauga",
  postalCode: "L5B1A1",
};

// ---------------------------------------------------------------------------
// Seed data (MOCK)
// ---------------------------------------------------------------------------
interface SeedDish {
  id: string;
  name: string;
  cookMinutes: number;
  ingredientCostCents: number;
  servings: number;
  allergens: string[];
  shelfLifeDays: number;
}
const D = {
  pho: {
    id: uid(9001),
    name: "Pho bo",
    cookMinutes: 120,
    ingredientCostCents: 2500,
    servings: 4,
    allergens: ["soy"],
    shelfLifeDays: 2,
  },
  satay: {
    id: uid(9002),
    name: "Chicken satay",
    cookMinutes: 60,
    ingredientCostCents: 1800,
    servings: 4,
    allergens: ["peanuts"],
    shelfLifeDays: 2,
  },
  buncha: {
    id: uid(9003),
    name: "Bun cha",
    cookMinutes: 90,
    ingredientCostCents: 2200,
    servings: 4,
    allergens: [],
    shelfLifeDays: 2,
  },
} satisfies Record<string, SeedDish>;

interface SeedOptions {
  n: number;
  customer: string;
  status: BookingDetail["status"];
  locationType: BookingDetail["locationType"];
  groceryOption: BookingDetail["groceryOption"];
  /** Day offsets from today, with the dishes for each day. */
  days: { offset: number; dishes: SeedDish[]; cooked?: boolean }[];
  allergies?: string;
  dietary?: string;
  free?: boolean;
  pickups?: Record<number, BookingDetail["days"][number]["pickups"]>;
  expiresInHours?: number;
  chef: MeProfile;
  now: Date;
}

function seedRow(o: SeedOptions): MockBookingRow {
  const today = torontoToday(o.now);
  const dates = o.days.map((d) => addDays(today, d.offset));
  const est = estimateBooking({
    hourlyRateCents: 2400,
    locationType: o.locationType,
    isFreeTrial: o.free ?? false,
    distanceMetres: o.locationType === "customer_home" ? 8000 : null,
    days: o.days.map((d) => ({
      dishes: d.dishes.map((x) => ({
        cookMinutes: x.cookMinutes,
        ingredientCostCents: x.ingredientCostCents,
        quantity: 1,
      })),
    })),
  });
  const full = mapEstimate(
    est,
    dates,
    o.locationType === "customer_home" ? 8000 : null,
  );
  const {
    labourBeforeWaiverCents: _a,
    freeTrialWaivedCents: _b,
    exceedsSoftLimit: _c,
    days: _d,
    ...estimate
  } = full;
  void [_a, _b, _c, _d];
  const allergies = o.allergies ?? "None";
  const conflicts = o.days
    .flatMap((d) => d.dishes)
    .filter((x) => x.allergens.some((a) => allergies.toLowerCase().includes(a)))
    .map((x) => ({ dishId: x.id, dishName: x.name, allergens: x.allergens }));
  const created = new Date(o.now.getTime() - 6 * 3600 * 1000);
  const status = o.status;
  const detail: BookingDetail = {
    id: uid(o.n),
    status,
    viewerRole: "chef",
    locationType: o.locationType,
    groceryOption: o.groceryOption,
    isFreeTrial: o.free ?? false,
    createdAt: created.toISOString(),
    expiresAt:
      status === "requested"
        ? new Date(
            o.now.getTime() + (o.expiresInHours ?? 48) * 3600 * 1000,
          ).toISOString()
        : null,
    respondedAt: status === "requested" ? null : created.toISOString(),
    declineReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationTiming: null,
    cancelReason: null,
    completedAt: null,
    noShow: null,
    chef: { id: o.chef.id, displayName: o.chef.displayName, photoPath: null },
    customer: { id: uid(o.n + 500), displayName: o.customer },
    days: o.days.map((d, i) => {
      const date = dates[i];
      const earliest = Math.min(...d.dishes.map((x) => x.shelfLifeDays));
      return {
        dayNumber: i + 1,
        date,
        cookMinutes: est.days[i].cookMinutes,
        cookedAt: d.cooked
          ? new Date(`${date}T16:00:00.000Z`).toISOString()
          : null,
        pickupDeadlineDate:
          o.locationType === "chef_home" ? addDays(date, earliest) : null,
        pickups: o.pickups?.[i + 1] ?? [],
        dishes: d.dishes.map((x) => ({
          dishId: x.id,
          name: x.name,
          quantity: 1,
          cookMinutes: x.cookMinutes,
          ingredientCostCents: x.ingredientCostCents,
          servings: x.servings,
          allergens: [...x.allergens],
          eatByDate: addDays(date, x.shelfLifeDays),
        })),
      };
    }),
    estimate,
    intake: {
      allergies,
      dietaryNotes: o.dietary ?? "None",
      allergyConflictAcknowledged: conflicts.length > 0,
    },
    allergyConflicts: conflicts,
    cookingPlace: null,
    contact: null,
    payment: { mock: true, collected: false },
  };
  return {
    detail,
    chefId: o.chef.id,
    place:
      o.locationType === "customer_home"
        ? {
            line: `${o.n} Maple Ave (MOCK)`,
            city: "Mississauga",
            postalCode: "L5B1M2",
          }
        : KITCHEN,
    chefPhone: CHEF_PHONE,
    customerPhone: `+1416555${String(100 + (o.n % 100)).padStart(4, "0")}`,
  };
}

function receipt(
  booking: BookingDetail,
  n: number,
  amountCents: number,
  over: Partial<ReceiptView> = {},
): MockReceipt {
  const c = checkReceipt(booking.estimate.ingredientsCents, amountCents);
  return {
    id: uid(n),
    bookingId: booking.id,
    amountCents,
    currency: booking.estimate.currency,
    estimatedIngredientsCents: booking.estimate.ingredientsCents,
    differenceCents: c.differenceCents,
    toleranceCents: c.toleranceCents,
    mismatchFlagged: c.mismatch,
    status: "waiting",
    customerConfirmedAt: null,
    customerDisputedAt: null,
    disputeNote: null,
    createdAt: new Date().toISOString(),
    fileUrl: null,
    reimbursement: { mock: true, collected: false, amountCents: null },
    filePath: `${booking.id}/seed-${n}.pdf`,
    ...over,
  };
}

export type SeededReceipts = Record<string, MockReceipt[]>;

/** The made-up requests for a signed-in chef (MOCK). Dates are relative to today. */
export function seedChefBookings(
  chef: MeProfile,
  now: Date,
): { rows: MockBookingRow[]; receipts: SeededReceipts } {
  const today = torontoToday(now);
  const base = { chef, now };
  const a03Date = addDays(today, -1);
  const rows: MockBookingRow[] = [
    seedRow({
      ...base,
      n: 9101,
      customer: "Priya Patel",
      status: "requested",
      locationType: "customer_home",
      groceryOption: "customer_buys",
      days: [{ offset: 3, dishes: [D.pho, D.satay] }],
      allergies: "peanuts, carries an EpiPen",
      dietary: "No beef for the children",
      free: true,
    }),
    seedRow({
      ...base,
      n: 9102,
      customer: "Daniel Okafor",
      status: "requested",
      locationType: "chef_home",
      groceryOption: "chef_shops",
      days: [{ offset: 4, dishes: [D.buncha] }],
      dietary: "Halal only",
      expiresInHours: 60,
    }),
    seedRow({
      ...base,
      n: 9103,
      customer: "Mei Lin",
      status: "accepted",
      locationType: "chef_home",
      groceryOption: "customer_buys",
      days: [{ offset: -1, dishes: [D.buncha], cooked: true }],
      pickups: {
        1: [
          {
            id: uid(9603),
            proposedAt: new Date(`${a03Date}T14:00:00.000Z`).toISOString(),
            status: "declined",
            createdAt: new Date(now.getTime() - 20 * 3600 * 1000).toISOString(),
            respondedAt: new Date(
              now.getTime() - 19 * 3600 * 1000,
            ).toISOString(),
          },
          {
            id: uid(9604),
            proposedAt: new Date(
              now.getTime() + 20 * 3600 * 1000,
            ).toISOString(),
            status: "proposed",
            createdAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
            respondedAt: null,
          },
        ],
      },
    }),
    seedRow({
      ...base,
      n: 9104,
      customer: "Omar Haddad",
      status: "accepted",
      locationType: "customer_home",
      groceryOption: "chef_shops",
      days: [
        { offset: 0, dishes: [D.pho, D.buncha] },
        { offset: 1, dishes: [D.buncha] },
      ],
      dietary: "Low salt",
    }),
    seedRow({
      ...base,
      n: 9105,
      customer: "Grace Kim",
      status: "accepted",
      locationType: "chef_home",
      groceryOption: "customer_buys",
      days: [{ offset: -4, dishes: [D.pho], cooked: true }],
    }),
    seedRow({
      ...base,
      n: 9106,
      customer: "Tom Reid",
      status: "accepted",
      locationType: "customer_home",
      groceryOption: "chef_shops",
      days: [{ offset: -1, dishes: [D.satay, D.buncha], cooked: true }],
    }),
  ];
  const a06 = rows[5].detail;
  return {
    rows,
    // A flagged receipt: $62.00 against about $40.00 estimated.
    receipts: { [a06.id]: [receipt(a06, 9701, 6200)] },
  };
}

/**
 * The same made-up bookings seen by a signed-in customer (test hook `seedCustomer`, MOCK): the
 * chef is a made-up one, the customer is the signed-in user. Used by the mock e2e tests of the
 * customer's pickup and receipt screens, which need bookings in states a customer cannot reach
 * alone in mock mode (nobody answers their requests).
 */
export function seedCustomerBookings(
  customer: MeProfile,
  now: Date,
): { rows: MockBookingRow[]; receipts: SeededReceipts } {
  const chef: MeProfile = {
    id: uid(1001),
    role: "chef",
    displayName: "Mai Tran (MOCK)",
    country: "CA",
    currency: "CAD",
    language: "en",
  };
  const made = seedChefBookings(chef, now);
  return {
    rows: made.rows.map((r) => ({
      ...r,
      detail: {
        ...r.detail,
        viewerRole: "customer" as const,
        customer: { id: customer.id, displayName: customer.displayName },
      },
    })),
    receipts: made.receipts,
  };
}

// ---------------------------------------------------------------------------
// Router for everything after /api/bookings/:id/
// ---------------------------------------------------------------------------
const CHEF_ONLY = new Set([
  "accept",
  "decline",
  "cooked",
  "complete",
  "pickup-respond",
  "pickup-missed",
  "receipt-add",
]);
const CUSTOMER_ONLY = new Set(["pickup-propose", "receipt-answer"]);

function strip(r: MockReceipt): ReceiptView {
  const { filePath: _p, ...view } = r;
  void _p;
  return view;
}

function badFields(fields: Record<string, string>) {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });
}
function invalid(reason: string, message?: string) {
  return fail(
    409,
    "INVALID_STATE",
    message ??
      CHANGE_REFUSALS[reason] ??
      RECEIPT_REFUSALS[reason] ??
      "Not possible now.",
    { reason },
  );
}
function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  return extra.length
    ? badFields(Object.fromEntries(extra.map((k) => [k, "Unknown field."])))
    : null;
}

/** The decline reason (D-34): required, 3 to 500 characters, text rules, no contact details. */
function declineReason(
  obj: Record<string, unknown>,
): { value: string } | { res: BookingRouteResult } {
  const r = obj.reason;
  const t = typeof r === "string" ? r.trim() : "";
  if (t === "")
    return {
      res: badFields({ reason: "Tell the customer why you are declining." }),
    };
  if (t.length < 3 || t.length > 500)
    return { res: badFields({ reason: "Use 3 to 500 characters." }) };
  if (hasUnsafeText(t, true))
    return {
      res: badFields({ reason: "Remove control or invalid characters." }),
    };
  if (findContactDetails(t))
    return {
      res: fail(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "Do not put phone numbers, emails or links in the reason.",
        { fields: { reason: "Remove the contact details." } },
      ),
    };
  return { value: t };
}

export function changeRoute(
  method: string,
  path: string,
  body: unknown,
  s: BookingMockState,
  role: Role,
  now: Date,
): BookingRouteResult | null {
  const m =
    /^\/api\/bookings\/([^/]+)\/(accept|decline|complete|shopping-list|receipts|pickup\/missed)$/.exec(
      path,
    );
  const day =
    /^\/api\/bookings\/([^/]+)\/days\/([^/]+)\/(cooked|pickup\/propose|pickup\/respond)$/.exec(
      path,
    );
  const ans = /^\/api\/bookings\/([^/]+)\/receipts\/([^/]+)\/respond$/.exec(
    path,
  );
  if (!m && !day && !ans) return null;

  let id: string;
  let what: string;
  if (ans) {
    id = ans[1];
    what = "receipt-answer";
  } else if (day) {
    id = day[1];
    what = {
      cooked: "cooked",
      "pickup/propose": "pickup-propose",
      "pickup/respond": "pickup-respond",
    }[day[3]]!;
  } else {
    id = m![1];
    const sub = m![2];
    what =
      sub === "receipts"
        ? method === "POST"
          ? "receipt-add"
          : "receipts"
        : sub === "pickup/missed"
          ? "pickup-missed"
          : sub;
  }
  const wantsPost = !["shopping-list", "receipts"].includes(what);
  if (method !== (wantsPost ? "POST" : "GET"))
    return fail(404, "NOT_FOUND", "Not found.");

  if (CHEF_ONLY.has(what) && role !== "chef")
    return fail(403, "FORBIDDEN", "Only the chef can do this.");
  if (CUSTOMER_ONLY.has(what) && role !== "customer")
    return fail(403, "FORBIDDEN", "Only the customer can do this.");

  const key = role === "chef" ? "chefBookings" : "bookings";
  const rows = s[key] ?? [];
  const row = UUID.test(id) ? rows.find((x) => x.detail.id === id) : undefined;
  if (!row) return notFound();
  const d = row.detail;
  const today = torontoToday(now);
  const save = (next: BookingDetail): BookingRouteResult => ({
    res: json(200, viewOf({ ...row, detail: next }, role)),
    next: {
      [key]: rows.map((x) => (x.detail.id === id ? { ...x, detail: next } : x)),
    },
  });

  switch (what) {
    case "accept": {
      if (d.status !== "requested") return invalid("wrong_status");
      if (d.expiresAt && new Date(d.expiresAt).getTime() <= now.getTime())
        return fail(
          409,
          "REQUEST_EXPIRED",
          "This request expired before it was answered.",
        );
      if (d.locationType === "chef_home" && s.hooks.chefHomeOff)
        return invalid("chef_home_not_enabled");
      return save({ ...d, status: "accepted", respondedAt: now.toISOString() });
    }
    case "decline": {
      const obj = asObject(body);
      const extra = unknownKeys(obj, ["reason"]);
      if (extra) return extra;
      const reason = declineReason(obj);
      if ("res" in reason) return reason.res;
      if (d.status !== "requested") return invalid("wrong_status");
      if (d.expiresAt && new Date(d.expiresAt).getTime() <= now.getTime())
        return fail(
          409,
          "REQUEST_EXPIRED",
          "This request expired before it was answered.",
        );
      return save({
        ...d,
        status: "declined",
        respondedAt: now.toISOString(),
        declineReason: reason.value,
      });
    }
    case "cooked": {
      const n = parseDayNumber(day![2]);
      const target = n ? d.days.find((x) => x.dayNumber === n) : undefined;
      if (!target) return notFound();
      if (d.status !== "accepted") return invalid("wrong_status");
      if (target.date > today) return invalid("too_early");
      if (target.cookedAt) return save(d); // repeating keeps the first time
      return save({
        ...d,
        days: d.days.map((x) =>
          x.dayNumber === n ? { ...x, cookedAt: now.toISOString() } : x,
        ),
      });
    }
    case "complete": {
      if (d.status !== "accepted") return invalid("wrong_status");
      if (!d.days.every((x) => x.cookedAt)) return invalid("days_not_cooked");
      return save({
        ...d,
        status: "completed",
        completedAt: now.toISOString(),
      });
    }
    case "pickup-propose": {
      const obj = asObject(body);
      const extra = unknownKeys(obj, ["proposedAt"]);
      if (extra) return extra;
      const n = parseDayNumber(day![2]);
      const target = n ? d.days.find((x) => x.dayNumber === n) : undefined;
      if (!target) return notFound();
      const t = parseProposedAt(obj.proposedAt);
      if ("error" in t) return badFields({ proposedAt: t.error });
      if (d.locationType !== "chef_home") return invalid("not_chef_home");
      if (d.status !== "accepted") return invalid("wrong_status");
      if (!target.cookedAt) return invalid("day_not_cooked");
      if (target.pickups.some((p) => p.status === "proposed"))
        return invalid("proposal_open");
      if (target.pickups.some((p) => p.status === "accepted"))
        return invalid("pickup_agreed");
      const end = pickupDeadline(target.pickupDeadlineDate!);
      if (now.getTime() >= end.getTime()) return invalid("deadline_passed");
      if (t.value.getTime() <= now.getTime())
        return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
          fields: { proposedAt: PICKUP_RANGE_MESSAGES.not_future },
          latest: end.toISOString(),
        });
      if (t.value.getTime() >= end.getTime())
        return fail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
          fields: { proposedAt: PICKUP_RANGE_MESSAGES.after_deadline },
          latest: end.toISOString(),
        });
      return save({
        ...d,
        days: d.days.map((x) =>
          x.dayNumber === n
            ? {
                ...x,
                pickups: [
                  ...x.pickups,
                  {
                    id: crypto.randomUUID(),
                    proposedAt: t.value.toISOString(),
                    status: "proposed" as const,
                    createdAt: now.toISOString(),
                    respondedAt: null,
                  },
                ],
              }
            : x,
        ),
      });
    }
    case "pickup-respond": {
      const obj = asObject(body);
      const extra = unknownKeys(obj, ["accept"]);
      if (extra) return extra;
      const n = parseDayNumber(day![2]);
      const target = n ? d.days.find((x) => x.dayNumber === n) : undefined;
      if (!target) return notFound();
      const a = parsePickupAccept(obj);
      if ("error" in a) return badFields({ accept: a.error });
      if (d.locationType !== "chef_home") return invalid("not_chef_home");
      if (d.status !== "accepted") return invalid("wrong_status");
      const open = target.pickups.find((p) => p.status === "proposed");
      if (!open) return invalid("no_open_proposal");
      if (a.value && new Date(open.proposedAt).getTime() <= now.getTime())
        return invalid("proposal_past");
      return save({
        ...d,
        days: d.days.map((x) =>
          x.dayNumber === n
            ? {
                ...x,
                pickups: x.pickups.map((p) =>
                  p.id === open.id
                    ? {
                        ...p,
                        status: a.value
                          ? ("accepted" as const)
                          : ("declined" as const),
                        respondedAt: now.toISOString(),
                      }
                    : p,
                ),
              }
            : x,
        ),
      });
    }
    case "pickup-missed": {
      if (d.locationType !== "chef_home") return invalid("not_chef_home");
      if (d.status !== "accepted") return invalid("wrong_status");
      const over = d.days.find(
        (x) =>
          x.cookedAt &&
          x.pickupDeadlineDate &&
          now.getTime() >= pickupDeadline(x.pickupDeadlineDate).getTime(),
      );
      if (!over) return invalid("pickup_window_open");
      return save({
        ...d,
        status: "no_show_customer",
        noShow: {
          reportedAt: now.toISOString(),
          dayNumber: over.dayNumber,
          pickupMissed: true,
        },
        days: d.days.map((x) => ({
          ...x,
          pickups: x.pickups.map((p) =>
            p.status === "proposed"
              ? {
                  ...p,
                  status: "void" as const,
                  respondedAt: now.toISOString(),
                }
              : p,
          ),
        })),
      });
    }
    case "shopping-list": {
      const list = buildShoppingList(
        d.days.map((x) => ({
          dayNumber: x.dayNumber,
          date: x.date,
          dishes: x.dishes.map((y) => ({
            name: y.name,
            quantity: y.quantity,
            servings: y.servings,
            ingredientCostCents: y.ingredientCostCents,
            allergens: y.allergens,
          })),
        })),
      );
      const out: ShoppingListResponse = {
        bookingId: d.id,
        groceryOption: d.groceryOption,
        locationType: d.locationType,
        currency: d.estimate.currency,
        plan: groceryPlan(d.groceryOption, d.locationType),
        days: list.days,
        estimatedCostCents: list.estimatedCostCents,
      };
      return { res: json(200, out) };
    }
    case "receipts": {
      const out: ReceiptList = {
        bookingId: d.id,
        groceryOption: d.groceryOption,
        estimatedIngredientsCents: d.estimate.ingredientsCents,
        currency: d.estimate.currency,
        items: (s.receipts?.[d.id] ?? []).map(strip),
      };
      return { res: json(200, out) };
    }
    case "receipt-add": {
      const obj = asObject(body);
      const extra = unknownKeys(obj, ["filePath", "amountCents"]);
      if (extra) return extra;
      const parsed = parseReceiptBody(d.id, obj);
      if ("fields" in parsed) return badFields(parsed.fields);
      if (d.groceryOption !== "chef_shops") return invalid("not_chef_shops");
      if (d.status !== "accepted" && d.status !== "completed")
        return invalid("wrong_status");
      const all = s.receipts?.[d.id] ?? [];
      const current = all.find((r) => r.status !== "superseded");
      if (current?.status === "waiting") return invalid("receipt_waiting");
      if (current?.status === "confirmed") return invalid("receipt_confirmed");
      if (all.some((r) => r.filePath === parsed.value.filePath))
        return invalid("path_used");
      const fresh = receipt(d, 0, parsed.value.amountCents, {
        id: crypto.randomUUID(),
        createdAt: now.toISOString(),
      });
      fresh.filePath = parsed.value.filePath;
      const next = all.map((r) =>
        r === current
          ? { ...r, status: "superseded" as const, fileUrl: null }
          : r,
      );
      return {
        res: json(201, strip(fresh)),
        next: { receipts: { ...(s.receipts ?? {}), [d.id]: [...next, fresh] } },
      };
    }
    case "receipt-answer": {
      const obj = asObject(body);
      const extra = unknownKeys(obj, ["action", "note"]);
      if (extra) return extra;
      const all = s.receipts?.[d.id] ?? [];
      const target = all.find((r) => r.id === ans![2]);
      if (!target) return notFound("Receipt");
      const a = parseReceiptAnswer(obj);
      if ("fields" in a) return badFields(a.fields);
      if (d.status !== "accepted" && d.status !== "completed")
        return invalid("wrong_status");
      if (target.status === "superseded") return invalid("receipt_superseded");
      if (target.status !== "waiting") return invalid("already_answered");
      const answered: MockReceipt =
        a.value.action === "confirm"
          ? {
              ...target,
              status: "confirmed",
              customerConfirmedAt: now.toISOString(),
              reimbursement: {
                mock: true,
                collected: false,
                amountCents: target.amountCents,
              },
            }
          : {
              ...target,
              status: "disputed",
              customerDisputedAt: now.toISOString(),
              disputeNote: a.value.note,
            };
      return {
        res: json(200, strip(answered)),
        next: {
          receipts: {
            ...(s.receipts ?? {}),
            [d.id]: all.map((r) => (r.id === target.id ? answered : r)),
          },
        },
      };
    }
  }
  return null;
}
