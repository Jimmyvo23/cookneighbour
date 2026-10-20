// MOCK REVIEWS, PROBLEM REPORTS AND ADMIN LISTS (T-049). Stand in for docs/api-contract.md
// section 7D (v1.18) so the screens can be built before the browser talks to the real routes.
// Nothing here is real: every review, report, flag, free-trial block and chat message is made up
// and lives in this browser tab only (sessionStorage); nobody else ever sees it, and no
// notification is sent.
//
// The rules follow the contract (order of checks: session 401, role 403, id 404, unknown keys 422,
// field rules 422, then state 409). The field limits reuse src/lib/engagement/rules.ts.
// Differences from the real API, on purpose:
//   - the list cursor is an index ("m<n>"), as in the other mocks;
//   - the first admin call brings in a made-up set of bookings, reports, blocks and chats;
//   - a customer's review of a chef is added to that chef's public list in this tab, with the
//     first word of the customer's name (the real server snapshots the first name);
//   - test hooks, set from a test inside `engagement.hooks`:
//       failNext = true            the next write answers a generic 500, once;
//       alreadyDecidedOnce = true  the next admin decision answers 409 `already_decided`, once.
// Frontend owns this file (T-049); Backend does not edit it.
import type { BookingDetail, BookingStatus, MeProfile } from "@/lib/api/types";
import { findContactDetails } from "@/lib/domain/contactDetails";
import { freeTrialEffect } from "@/lib/domain/cancellation";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import {
  REVIEW_WINDOW_DAYS,
  parseDecisionForm,
  parseReportForm,
  parseReviewForm,
} from "@/lib/engagement/rules";
import type {
  AdminBookingItem,
  AdminDecision,
  AdminDecisionResponse,
  AdminFreeTrialBlock,
  AdminMessageView,
  AdminReportItem,
  BookingReviews,
  FinalBookingStatus,
  PublicReview,
  ReportView,
  ReviewAllowance,
  ReviewView,
} from "@/lib/api/types";
import {
  UUID,
  fail,
  json,
  type MockBookingRow,
} from "@/lib/mocks/mock-bookings";
import { MOCK_CHEFS } from "@/lib/mocks/mock-search";

const DAY_MS = 86_400_000;

interface MockReview extends Omit<ReviewView, "mine"> {
  /** Who wrote it: the signed-in role in this tab. */
  chefId: string;
}
interface MockReport extends ReportView {
  reporterRole: "customer" | "chef";
  clientId: string;
}

export interface EngagementHooks {
  failNext?: boolean;
  alreadyDecidedOnce?: boolean;
}

export interface EngagementState {
  reviews: MockReview[];
  reports: MockReport[];
  /** Extra public reviews written in this tab, by chef id (newest first). */
  postedPublic: Record<string, PublicReview[]>;
  hooks: EngagementHooks;
  admin: null | {
    bookings: AdminBookingItem[];
    reports: AdminReportItem[];
    blocks: AdminFreeTrialBlock[];
    messages: Record<string, AdminMessageView[]>;
  };
}

export const EMPTY_ENGAGEMENT: EngagementState = {
  reviews: [],
  reports: [],
  postedPublic: {},
  hooks: {},
  admin: null,
};

/** The slice of the adapter's saved state these routes read. */
export interface EngagementMockState {
  profile: MeProfile | null;
  bookings: MockBookingRow[];
  chefBookings?: MockBookingRow[];
  engagement?: EngagementState | null;
}

export interface EngagementResult {
  res: Response;
  /** `bookings` / `chefBookings`: the party's own copies, when an admin decision changed one. */
  next?: {
    engagement: EngagementState;
    bookings?: MockBookingRow[];
    chefBookings?: MockBookingRow[];
  };
}

const rawFail = (
  status: number,
  code: Parameters<typeof fail>[1],
  message: string,
  extra: Parameters<typeof fail>[3] = {},
): EngagementResult => ({ res: fail(status, code, message, extra).res });

const notFound = (what = "Booking") =>
  rawFail(404, "NOT_FOUND", `${what} not found.`);

const INTERNAL = () =>
  rawFail(
    500,
    "INTERNAL",
    "Something went wrong on our side. Please try again.",
  );

// ---------------------------------------------------------------------------
// Query handling shared by the paged routes
// ---------------------------------------------------------------------------
function pageQuery(
  url: URL,
  extra: string[],
  defaultLimit = 20,
): { fields: Record<string, string>; limit: number; from: number } {
  const fields: Record<string, string> = {};
  const allowed = ["limit", "cursor", ...extra];
  for (const k of new Set(url.searchParams.keys()))
    if (!allowed.includes(k)) fields[k] = "Unknown parameter.";
    else if (url.searchParams.getAll(k).length > 1)
      fields[k] = "Send this only once.";
  let limit = defaultLimit;
  const l = url.searchParams.get("limit");
  if (l !== null && !fields.limit) {
    if (!/^\d{1,3}$/.test(l) || +l < 1 || +l > 50)
      fields.limit = "Use a whole number from 1 to 50.";
    else limit = +l;
  }
  let from = 0;
  const c = url.searchParams.get("cursor");
  if (c !== null && !fields.cursor) {
    const m = /^m(\d{1,6})$/.exec(c);
    if (!m) fields.cursor = "That page marker is not valid.";
    else from = +m[1];
  }
  return { fields, limit, from };
}

function paged<T>(items: T[], limit: number, from: number) {
  return {
    items: items.slice(from, from + limit),
    nextCursor: from + limit < items.length ? `m${from + limit}` : null,
  };
}

const invalid = (fields: Record<string, string>) =>
  rawFail(422, "VALIDATION_FAILED", "Check the highlighted fields.", {
    fields,
  });

// ---------------------------------------------------------------------------
// Public chef reviews (no sign-in)
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  "Mina",
  "Carlos",
  "Aisha",
  "Tom",
  "Linh",
  "Priya",
  "Jordan",
];
const COMMENTS = [
  "Warm, tidy and the food tasted like home.",
  null,
  "Everything was ready on time. We ate well all week.",
  "Great flavours. Would book again.",
];

/** Made-up public reviews of one MOCK chef: first name only, as the server will send them. */
function seededPublic(chefId: string, now: Date): PublicReview[] {
  const idx = MOCK_CHEFS.findIndex((c) => c.id === chefId);
  if (idx < 0) return [];
  // The first MOCK chef gets 24 so "Load more" can be tried; the others get 3.
  const n = idx === 0 ? 24 : idx % 4 === 3 ? 0 : 3;
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000c${String(idx).padStart(2, "0")}${String(i).padStart(2, "0")}`,
    authorFirstName: FIRST_NAMES[(idx + i) % FIRST_NAMES.length],
    rating: 5 - ((idx + i) % 3 === 2 ? 2 : (idx + i) % 3),
    comment: COMMENTS[(idx + i) % COMMENTS.length],
    createdAt: new Date(now.getTime() - (i + 1) * 3 * DAY_MS).toISOString(),
  }));
}

function publicList(
  e: EngagementState,
  chefId: string,
  now: Date,
): PublicReview[] {
  return [...(e.postedPublic[chefId] ?? []), ...seededPublic(chefId, now)];
}

// ---------------------------------------------------------------------------
// Rules shared with the contract
// ---------------------------------------------------------------------------
function allowanceOf(
  d: BookingDetail,
  mine: MockReview | undefined,
  now: Date,
): ReviewAllowance {
  const closesAt =
    d.status === "completed"
      ? new Date(
          new Date(d.completedAt ?? d.createdAt).getTime() +
            REVIEW_WINDOW_DAYS * DAY_MS,
        ).toISOString()
      : null;
  if (mine) return { allowed: false, reason: "already_reviewed", closesAt };
  if (d.status !== "completed")
    return { allowed: false, reason: "not_completed", closesAt: null };
  if (new Date(closesAt!).getTime() < now.getTime())
    return { allowed: false, reason: "window_closed", closesAt };
  return { allowed: true, reason: null, closesAt };
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------
export function engagementRoute(
  method: string,
  path: string,
  body: unknown,
  s: EngagementMockState,
  now: Date = new Date(),
): EngagementResult | null {
  const url = new URL(path, "http://mock.invalid");
  const p = url.pathname;
  const e = s.engagement ?? EMPTY_ENGAGEMENT;

  // Public: GET /api/chefs/:id/reviews (no session needed)
  const pub = /^\/api\/chefs\/([^/]+)\/reviews$/.exec(p);
  if (pub) {
    if (method !== "GET") return rawFail(404, "NOT_FOUND", "Not found.");
    const id = pub[1];
    if (!UUID.test(id) || !MOCK_CHEFS.some((c) => c.id === id))
      return rawFail(404, "NOT_FOUND", "Chef not found.");
    const q = pageQuery(url, []);
    if (Object.keys(q.fields).length) return invalid(q.fields);
    return { res: json(200, paged(publicList(e, id, now), q.limit, q.from)) };
  }

  const bookingSub = /^\/api\/bookings\/([^/]+)\/(reviews|reports)$/.exec(p);
  const admin = p.startsWith("/api/admin/") ? p : null;
  const adminOwn =
    admin !== null &&
    /^\/api\/admin\/(bookings|reports|free-trial-blocks|reviews)(\/|$)/.test(
      p,
    ) &&
    !/^\/api\/admin\/chefs/.test(p);
  if (!bookingSub && !adminOwn) return null;

  if (!s.profile)
    return rawFail(401, "UNAUTHENTICATED", "Please log in first.");
  const role = s.profile.role;

  if (bookingSub) {
    if (role !== "customer" && role !== "chef")
      return rawFail(
        403,
        "FORBIDDEN",
        "Only the customer and the chef of a booking can use this.",
      );
    return partyRoute(
      method,
      bookingSub[1],
      bookingSub[2] as "reviews" | "reports",
      body,
      s,
      e,
      role,
      now,
    );
  }

  if (role !== "admin")
    return rawFail(403, "FORBIDDEN", "Only admins can do this.");
  return adminRoute(method, url, body, e, now, s);
}

function partyRoute(
  method: string,
  id: string,
  what: "reviews" | "reports",
  body: unknown,
  s: EngagementMockState,
  e: EngagementState,
  role: "customer" | "chef",
  now: Date,
): EngagementResult {
  if (method !== "GET" && method !== "POST")
    return rawFail(404, "NOT_FOUND", "Not found.");
  const list = (role === "chef" ? s.chefBookings : s.bookings) ?? [];
  const row = UUID.test(id) ? list.find((x) => x.detail.id === id) : undefined;
  if (!row) return notFound();
  const d = row.detail;
  const save = (next: Partial<EngagementState>): EngagementResult["next"] => ({
    engagement: { ...e, ...next },
  });

  if (what === "reviews") {
    const mine = e.reviews.find(
      (r) => r.bookingId === id && r.authorRole === role,
    );
    const otherRole = role === "chef" ? "customer" : "chef";
    const other = e.reviews.find(
      (r) => r.bookingId === id && r.authorRole === otherRole,
    );
    const view = (r: MockReview | undefined): ReviewView | null =>
      r ? { ...r, mine: r.authorRole === role } : null;

    if (method === "GET")
      return {
        res: json(200, {
          bookingId: id,
          allowance: allowanceOf(d, mine, now),
          mine: view(mine),
          other: view(other),
        } satisfies BookingReviews),
      };

    // POST
    if (e.hooks.failNext)
      return {
        ...INTERNAL(),
        next: save({ hooks: { ...e.hooks, failNext: false } }),
      };
    const b = await_(body);
    if (!b) return rawFail(400, "BAD_REQUEST", "Malformed JSON.");
    const fields: Record<string, string> = {};
    for (const k of Object.keys(b))
      if (k !== "rating" && k !== "comment") fields[k] = "Unknown field.";
    if (Object.keys(fields).length) return invalid(fields);
    const parsed = parseReviewForm({
      rating: typeof b.rating === "number" ? b.rating : null,
      comment:
        b.comment === undefined || b.comment === null
          ? ""
          : typeof b.comment === "string"
            ? b.comment
            : "\u0000",
    });
    if (!parsed.ok) return invalid(parsed.fields);
    const comment = parsed.request.comment ?? null;
    // v1.18: a customer's comment is public, so contact details are refused (a chef's is private).
    if (role === "customer" && comment && findContactDetails(comment))
      return rawFail(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "Do not put phone numbers, email addresses or links in a public review.",
        {
          fields: {
            comment: "Remove phone numbers, email addresses and links.",
          },
        },
      );
    if (mine) {
      // A retry with the same content is answered with the first review; anything else is final.
      if (mine.rating === parsed.request.rating && mine.comment === comment)
        return { res: json(200, view(mine)) };
      return rawFail(
        409,
        "INVALID_STATE",
        "You have already reviewed this booking.",
        {
          reason: "already_reviewed",
        },
      );
    }
    const a = allowanceOf(d, undefined, now);
    if (!a.allowed)
      return rawFail(409, "INVALID_STATE", "You cannot review this booking.", {
        reason: a.reason!,
      });
    const review: MockReview = {
      id: `00000000-0000-4000-8000-0000000e${String(e.reviews.length).padStart(4, "0")}`,
      bookingId: id,
      authorRole: role,
      authorDisplayName:
        role === "customer" ? d.customer.displayName : d.chef.displayName,
      rating: parsed.request.rating,
      comment,
      createdAt: now.toISOString(),
      chefId: d.chef.id,
    };
    const next: Partial<EngagementState> = { reviews: [...e.reviews, review] };
    if (role === "customer")
      next.postedPublic = {
        ...e.postedPublic,
        [d.chef.id]: [
          {
            id: review.id,
            // MOCK: the real server snapshots the FIRST name; the mock imitates that.
            authorFirstName:
              s.profile!.displayName.trim().split(/\s+/)[0] || "Customer",
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
          },
          ...(e.postedPublic[d.chef.id] ?? []),
        ],
      };
    return { res: json(201, view(review)), next: save(next) };
  }

  // Reports
  const own = e.reports.filter(
    (r) => r.bookingId === id && r.reporterRole === role,
  );
  const strip = (r: MockReport): ReportView => ({
    id: r.id,
    bookingId: r.bookingId,
    category: r.category,
    description: r.description,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  });
  if (method === "GET")
    return {
      res: json(200, {
        items: [...own].reverse().map(strip),
      }),
    };

  if (e.hooks.failNext)
    return {
      ...INTERNAL(),
      next: save({ hooks: { ...e.hooks, failNext: false } }),
    };
  const b = await_(body);
  if (!b) return rawFail(400, "BAD_REQUEST", "Malformed JSON.");
  const fields: Record<string, string> = {};
  for (const k of Object.keys(b))
    if (!["clientId", "category", "description"].includes(k))
      fields[k] = "Unknown field.";
  if (Object.keys(fields).length) return invalid(fields);
  const clientId = typeof b.clientId === "string" ? b.clientId : "";
  const parsed = parseReportForm({
    clientId,
    category: b.category === undefined ? "other" : String(b.category),
    description: typeof b.description === "string" ? b.description : "",
  });
  const bad: Record<string, string> = parsed.ok ? {} : { ...parsed.fields };
  if (!UUID.test(clientId))
    bad.clientId = "Send a new UUID (lower case) for each report.";
  if (Object.keys(bad).length) return invalid(bad);
  if (!parsed.ok) return invalid(bad);
  const req = parsed.request;
  const same = own.find((r) => r.clientId === clientId);
  if (same) {
    if (same.category === req.category && same.description === req.description)
      return { res: json(200, strip(same)) };
    return rawFail(
      409,
      "INVALID_STATE",
      "That report id was already used for a different report.",
      {
        reason: "client_id_reused",
      },
    );
  }
  if (own.some((r) => r.status === "open" || r.status === "reviewing"))
    return rawFail(
      409,
      "INVALID_STATE",
      "You already have a problem report open for this booking. Wait for an admin to answer it before sending another.",
      { reason: "report_open" },
    );
  const report: MockReport = {
    id: `00000000-0000-4000-8000-0000000f${String(e.reports.length).padStart(4, "0")}`,
    bookingId: id,
    category: req.category!,
    description: req.description,
    status: "open",
    createdAt: now.toISOString(),
    resolvedAt: null,
    reporterRole: role,
    clientId,
  };
  return {
    res: json(201, strip(report)),
    next: save({ reports: [...e.reports, report] }),
  };
}

// The adapter has already parsed the JSON; this only checks it is an object.
function await_(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

// ---------------------------------------------------------------------------
// Admin: made-up data
// ---------------------------------------------------------------------------
const aid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ADMIN_IDS = {
  /** accepted, customer's home, free trial, one open report */
  acceptedWithReport: aid(8001),
  /** accepted, flag no_day_cooked open */
  flaggedNoDay: aid(8002),
  /** accepted, flag chef_rejected open (frozen) */
  flaggedRejected: aid(8003),
  /** completed, one open report (the admin may change the status, v1.18) */
  completedWithReport: aid(8004),
  /** accepted, a report in review */
  reviewing: aid(8005),
  /** cancelled, report already resolved */
  resolved: aid(8006),
  firstReport: aid(8101),
  completedReport: aid(8102),
  reviewingReport: aid(8103),
  resolvedReport: aid(8104),
};

const person = (n: number, name: string) => ({
  id: aid(8500 + n),
  displayName: name,
});
const CUSTOMERS = [
  person(1, "Priya Patel"),
  person(2, "Daniel Okafor"),
  person(3, "Mei Tran"),
];
const CHEFS = [person(11, "Lan Nguyen"), person(12, "Rosa Mendes")];

function bookingItem(
  n: number,
  over: Partial<AdminBookingItem>,
  today: string,
): AdminBookingItem {
  const first = addDays(today, over.status === "completed" ? -6 : -1);
  return {
    id: aid(8000 + n),
    status: "completed",
    locationType: "customer_home",
    groceryOption: "customer_buys",
    isFreeTrial: false,
    createdAt: new Date(
      Date.parse(`${first}T12:00:00Z`) - 5 * DAY_MS,
    ).toISOString(),
    firstDay: first,
    dates: [first],
    totalCents: 9000 + n * 100,
    currency: "CAD",
    customer: CUSTOMERS[n % CUSTOMERS.length],
    chef: CHEFS[n % CHEFS.length],
    anyDayCooked: false,
    flag: null,
    openReportCount: 0,
    ...over,
  };
}

export function seedAdminEngagement(
  now: Date,
): NonNullable<EngagementState["admin"]> {
  const today = torontoToday(now);
  const at = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();
  const special: AdminBookingItem[] = [
    bookingItem(
      1,
      {
        status: "accepted",
        isFreeTrial: true,
        openReportCount: 1,
        customer: CUSTOMERS[0],
        chef: CHEFS[0],
      },
      today,
    ),
    bookingItem(
      2,
      {
        status: "accepted",
        customer: CUSTOMERS[1],
        chef: CHEFS[1],
        flag: { reason: "no_day_cooked", flaggedAt: at(1), resolvedAt: null },
      },
      today,
    ),
    bookingItem(
      3,
      {
        status: "accepted",
        isFreeTrial: true,
        anyDayCooked: true,
        customer: CUSTOMERS[2],
        chef: CHEFS[0],
        flag: { reason: "chef_rejected", flaggedAt: at(2), resolvedAt: null },
      },
      today,
    ),
    bookingItem(
      4,
      {
        status: "completed",
        customer: CUSTOMERS[0],
        chef: CHEFS[1],
        openReportCount: 1,
      },
      today,
    ),
    bookingItem(
      5,
      {
        status: "accepted",
        customer: CUSTOMERS[1],
        chef: CHEFS[0],
        openReportCount: 1,
      },
      today,
    ),
    bookingItem(
      6,
      {
        status: "cancelled",
        customer: CUSTOMERS[2],
        chef: CHEFS[1],
      },
      today,
    ),
  ];
  // Enough more completed bookings to need a second page ("Load more").
  const more = Array.from({ length: 18 }, (_, i) =>
    bookingItem(20 + i, {}, today),
  );
  const bookings = [...special, ...more].map((b, i) => ({
    ...b,
    createdAt: at(i + 1),
  }));
  const item = (n: number) => bookings.find((b) => b.id === aid(8000 + n))!;
  const rb = (n: number): AdminReportItem["booking"] => {
    const b = item(n);
    return {
      status: b.status,
      firstDay: b.firstDay,
      customer: b.customer,
      chef: b.chef,
      anyDayCooked: b.anyDayCooked,
      frozen: b.flag?.reason === "chef_rejected" && !b.flag.resolvedAt,
    };
  };
  const reports: AdminReportItem[] = [
    {
      id: ADMIN_IDS.firstReport,
      bookingId: aid(8001),
      category: "food_quality",
      description:
        "The soup was cold when I got home and one dish was missing.\nPlease check the order.",
      status: "open",
      createdAt: at(0.5),
      resolvedAt: null,
      reporter: { ...CUSTOMERS[0], role: "customer" },
      booking: rb(1),
      decision: null,
    },
    {
      id: ADMIN_IDS.completedReport,
      bookingId: aid(8004),
      category: "payment",
      description: "The receipt total is not what I was told.",
      status: "open",
      createdAt: at(1),
      resolvedAt: null,
      reporter: { ...CHEFS[1], role: "chef" },
      booking: rb(4),
      decision: null,
    },
    {
      id: ADMIN_IDS.reviewingReport,
      bookingId: aid(8005),
      category: "safety",
      description: "The kitchen was not clean when I arrived.",
      status: "reviewing",
      createdAt: at(2),
      resolvedAt: null,
      reporter: { ...CUSTOMERS[1], role: "customer" },
      booking: rb(5),
      decision: null,
    },
    {
      id: ADMIN_IDS.resolvedReport,
      bookingId: aid(8006),
      category: "no_show",
      description: "The chef did not come.",
      status: "resolved",
      createdAt: at(5),
      resolvedAt: at(4),
      reporter: { ...CUSTOMERS[2], role: "customer" },
      booking: rb(6),
      decision: {
        kind: "report_resolved",
        finalStatus: "cancelled",
        note: "MOCK: confirmed with both people.",
        decidedAt: at(4),
      },
    },
  ];
  const blocks: AdminFreeTrialBlock[] = [
    {
      id: aid(8201),
      customer: CUSTOMERS[0],
      reason: "phone",
      createdAt: at(1),
      attempts: 2,
    },
    {
      id: aid(8202),
      customer: CUSTOMERS[1],
      reason: "address",
      createdAt: at(3),
      attempts: 1,
    },
    {
      id: aid(8203),
      customer: CUSTOMERS[2],
      reason: "customer",
      createdAt: at(6),
      attempts: 4,
    },
  ];
  const msg = (
    b: number,
    i: number,
    from: "customer" | "chef",
    body: string,
  ): AdminMessageView => {
    const bk = item(b);
    const p = from === "customer" ? bk.customer : bk.chef;
    return {
      id: aid(8300 + b * 10 + i),
      bookingId: bk.id,
      senderId: p.id,
      senderRole: from,
      senderName: p.displayName,
      clientId: null,
      body,
      createdAt: at(3 - i * 0.1),
    };
  };
  const messages: Record<string, AdminMessageView[]> = {
    [aid(8001)]: [
      msg(1, 0, "customer", "Hello! Can you make the soup mild?"),
      msg(1, 1, "chef", "Of course. See you on the day."),
    ],
    // A hidden chat (a cancelled booking): the admin still reads it (D-95).
    [aid(8006)]: [msg(6, 0, "customer", "Are you still coming?")],
    // 55 messages so "Load more" can be tried.
    [aid(8004)]: Array.from({ length: 55 }, (_, i) =>
      msg(4, i, i % 2 ? "chef" : "customer", `Message number ${i + 1}`),
    ),
  };
  return { bookings, reports, blocks, messages };
}

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------
const BOOKING_STATUSES: BookingStatus[] = [
  "requested",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "no_show_customer",
  "no_show_chef",
  "expired",
];
const REPORT_FILTERS = [
  "active",
  "open",
  "reviewing",
  "resolved",
  "dismissed",
  "all",
];

function adminRoute(
  method: string,
  url: URL,
  body: unknown,
  e0: EngagementState,
  now: Date,
  party?: EngagementMockState,
): EngagementResult {
  const p = url.pathname;
  const a0 = e0.admin ?? seedAdminEngagement(now);
  const seeded = e0.admin === null;
  const e: EngagementState = { ...e0, admin: a0 };
  // Seeding the made-up data is itself a change to save, even for a read.
  const withSeed = (r: EngagementResult): EngagementResult =>
    seeded && !r.next ? { ...r, next: { engagement: e } } : r;
  const a = a0;

  if (method === "GET") {
    if (p === "/api/admin/bookings") {
      const q = pageQuery(url, ["status", "flag"]);
      const status = url.searchParams.get("status") ?? "all";
      const flag = url.searchParams.get("flag");
      if (
        status !== "all" &&
        !BOOKING_STATUSES.includes(status as BookingStatus)
      )
        q.fields.status = "Use a booking status or all.";
      if (flag !== null && flag !== "open") q.fields.flag = "Use open.";
      if (Object.keys(q.fields).length) return invalid(q.fields);
      const list = a.bookings.filter(
        (b) =>
          (status === "all" || b.status === status) &&
          (flag !== "open" || (b.flag !== null && b.flag.resolvedAt === null)),
      );
      return withSeed({ res: json(200, paged(list, q.limit, q.from)) });
    }
    if (p === "/api/admin/reports") {
      const q = pageQuery(url, ["status"]);
      const status = url.searchParams.get("status") ?? "active";
      if (!REPORT_FILTERS.includes(status))
        q.fields.status =
          "Use active, open, reviewing, resolved, dismissed or all.";
      if (Object.keys(q.fields).length) return invalid(q.fields);
      const list = a.reports.filter((r) =>
        status === "all"
          ? true
          : status === "active"
            ? r.status === "open" || r.status === "reviewing"
            : r.status === status,
      );
      return withSeed({ res: json(200, paged(list, q.limit, q.from)) });
    }
    if (p === "/api/admin/free-trial-blocks") {
      const q = pageQuery(url, []);
      if (Object.keys(q.fields).length) return invalid(q.fields);
      return withSeed({ res: json(200, paged(a.blocks, q.limit, q.from)) });
    }
    const chat = /^\/api\/admin\/bookings\/([^/]+)\/messages$/.exec(p);
    if (chat) {
      if (!UUID.test(chat[1]) || !a.bookings.some((b) => b.id === chat[1]))
        return withSeed(notFound());
      const q = pageQuery(url, []);
      if (Object.keys(q.fields).length) return invalid(q.fields);
      return withSeed({
        res: json(200, paged(a.messages[chat[1]] ?? [], q.limit, q.from)),
      });
    }
    return rawFail(404, "NOT_FOUND", "Not found.");
  }

  if (method !== "POST") return rawFail(404, "NOT_FOUND", "Not found.");
  const resolveReport =
    /^\/api\/admin\/reports\/([^/]+)\/(resolve|dismiss)$/.exec(p);
  const resolveFlag = /^\/api\/admin\/bookings\/([^/]+)\/resolve-flag$/.exec(p);
  if (!resolveReport && !resolveFlag)
    return rawFail(404, "NOT_FOUND", "Not found.");
  const id = (resolveReport ?? resolveFlag)![1];
  const report = resolveReport
    ? UUID.test(id)
      ? a.reports.find((r) => r.id === id)
      : undefined
    : undefined;
  const booking = resolveFlag
    ? UUID.test(id)
      ? a.bookings.find((b) => b.id === id)
      : undefined
    : report
      ? a.bookings.find((b) => b.id === report.bookingId)
      : undefined;
  if (!(report ?? (resolveFlag ? booking : undefined)) || !booking)
    return withSeed(notFound(resolveReport ? "Report" : "Booking"));

  const save = (next: Partial<EngagementState>): EngagementResult["next"] => ({
    engagement: { ...e, ...next },
  });
  if (e.hooks.failNext)
    return {
      ...INTERNAL(),
      next: save({ hooks: { ...e.hooks, failNext: false } }),
    };

  const b = await_(body);
  if (!b) return rawFail(400, "BAD_REQUEST", "Malformed JSON.");
  const dismiss = resolveReport?.[2] === "dismiss";
  const allowedKeys = dismiss ? ["note"] : ["finalStatus", "note"];
  const fields: Record<string, string> = {};
  for (const k of Object.keys(b))
    if (!allowedKeys.includes(k)) fields[k] = "Unknown field.";
  if (Object.keys(fields).length) return invalid(fields);
  const note = typeof b.note === "string" ? b.note : "";
  // Field rules for the note (the contract: 3 to 500 safe characters).
  const noteCheck = parseDecisionForm({
    kind: "dismiss",
    bookingStatus: booking.status,
    finalStatus: "",
    note,
  });
  if (!noteCheck.ok) return invalid({ note: noteCheck.fields.note });
  const finalRaw = b.finalStatus;
  const FINALS: FinalBookingStatus[] = [
    "completed",
    "cancelled",
    "no_show_chef",
    "no_show_customer",
  ];
  if (
    finalRaw !== undefined &&
    !FINALS.includes(finalRaw as FinalBookingStatus)
  )
    return invalid({
      finalStatus:
        "Use completed, cancelled, no_show_chef or no_show_customer.",
    });
  const finalStatus = finalRaw as FinalBookingStatus | undefined;

  if (e.hooks.alreadyDecidedOnce)
    return {
      ...rawFail(409, "INVALID_STATE", "Someone has already decided this.", {
        reason: "already_decided",
      }),
      next: save({ hooks: { ...e.hooks, alreadyDecidedOnce: false } }),
    };

  const decidedAt = now.toISOString();
  let newStatus: string = booking.status;
  let kind: AdminDecision["kind"];
  if (resolveFlag) {
    if (!booking.flag || booking.flag.resolvedAt)
      return rawFail(409, "INVALID_STATE", "This booking has no open flag.", {
        reason: "no_open_flag",
      });
    if (booking.status !== "accepted")
      return rawFail(
        409,
        "INVALID_STATE",
        "This booking is not open to a decision.",
        {
          reason: "status_not_open",
        },
      );
    if (!finalStatus)
      return invalid({ finalStatus: "Choose the status the booking gets." });
    newStatus = finalStatus;
    kind = "flag_resolved";
  } else {
    if (report!.status !== "open" && report!.status !== "reviewing")
      return rawFail(409, "INVALID_STATE", "This report was already decided.", {
        reason: "already_decided",
      });
    if (dismiss) kind = "report_dismissed";
    else {
      kind = "report_resolved";
      if (booking.status === "accepted") {
        if (!finalStatus)
          return rawFail(
            409,
            "INVALID_STATE",
            "Choose the final status of this booking.",
            {
              reason: "final_status_required",
            },
          );
        newStatus = finalStatus;
      } else if (booking.status === "completed") {
        // v1.18: optional; "completed" (or none) leaves it as it is.
        if (finalStatus) newStatus = finalStatus;
      } else if (finalStatus)
        return rawFail(
          409,
          "INVALID_STATE",
          "This booking cannot be changed any more.",
          {
            reason: "status_not_open",
          },
        );
    }
  }

  const decision: AdminDecision = {
    kind,
    finalStatus:
      newStatus !== booking.status ? (newStatus as FinalBookingStatus) : null,
    note: noteCheck.request.note,
    decidedAt,
  };
  const changed = newStatus !== booking.status;
  const trial: AdminDecisionResponse["freeTrial"] = !booking.isFreeTrial
    ? "none"
    : ({ hold: "held", consume: "consumed", release: "released" }[
        freeTrialEffect(newStatus as Parameters<typeof freeTrialEffect>[0], {
          anyDayCooked: booking.anyDayCooked,
        })
      ] as AdminDecisionResponse["freeTrial"]);

  const bookings = a.bookings.map((x) =>
    x.id !== booking.id
      ? x
      : {
          ...x,
          status: newStatus,
          flag:
            changed && x.flag && !x.flag.resolvedAt
              ? { ...x.flag, resolvedAt: decidedAt }
              : x.flag,
          openReportCount: report
            ? Math.max(0, x.openReportCount - 1)
            : x.openReportCount,
        },
  );
  const reports = a.reports.map((r) => {
    if (report && r.id === report.id)
      return {
        ...r,
        status: (dismiss
          ? "dismissed"
          : "resolved") as AdminReportItem["status"],
        resolvedAt: decidedAt,
        decision,
        booking: { ...r.booking, status: newStatus, frozen: false },
      };
    return r.bookingId === booking.id
      ? {
          ...r,
          booking: {
            ...r.booking,
            status: newStatus,
            frozen: changed ? false : r.booking.frozen,
          },
        }
      : r;
  });
  const out: AdminDecisionResponse = {
    reportId: report?.id ?? null,
    booking: { id: booking.id, status: newStatus },
    decision,
    freeTrial: trial,
  };
  // When the customer's or chef's own copy of this booking exists in this tab, it gets the new
  // status too, so the booking page shows what the admin decided (reviews already written stay).
  const move = (rows?: MockBookingRow[]) =>
    rows?.some((r) => r.detail.id === booking.id)
      ? rows.map((r) =>
          r.detail.id === booking.id
            ? {
                ...r,
                detail: { ...r.detail, status: newStatus as BookingStatus },
              }
            : r,
        )
      : undefined;
  const mine = changed ? move(party?.bookings) : undefined;
  const theirs = changed ? move(party?.chefBookings) : undefined;
  return {
    res: json(200, out),
    next: {
      engagement: { ...e, admin: { ...a, bookings, reports } },
      ...(mine && { bookings: mine }),
      ...(theirs && { chefBookings: theirs }),
    },
  };
}
