// Reads of bookings for the two parties (T-042, contract section 7A).
//
// Authorization: every read here uses the CALLER's user-scoped client, so row-level security is
// the first line of defence (a booking is visible to its customer, its chef and admins only; the
// cooking address table is customer-only; the other party's phone and address come only from
// get_booking_contact(), which returns nothing before the booking is accepted). The route has
// already refused admins and visitors. A booking the caller cannot see is a 404 (the same answer
// as a missing one).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import type {
  BookingDetail,
  BookingListResponse,
  BookingListStatus,
  BookingStatus,
  BookingSummary,
} from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import { findAllergyConflicts } from "@/lib/domain/allergy";

type Row = Record<string, unknown>;

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  "requested",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "no_show_customer",
  "no_show_chef",
  "expired",
];

const BOOKING_COLUMNS =
  "id, customer_id, chef_id, status, location_type, grocery_option, is_free_trial, hourly_rate_cents, est_cook_minutes, est_labour_cents, est_ingredients_cents, est_travel_cents, est_platform_fee_cents, est_total_cents, platform_fee_percent, travel_rate_cents_per_km, distance_km, decline_reason, responded_at, expires_at, currency, created_at";

const iso = (v: unknown) => new Date(v as string).toISOString();
const notFound = () => new ApiFailure("NOT_FOUND", "Booking not found.");

function fail(what: string): Error {
  // Message only, never row data.
  return new Error(`bookings read failed: ${what}`);
}

/** The statuses whose contact details stay visible (get_booking_contact, booking_contact_unlocked). */
const UNLOCKED: readonly string[] = [
  "accepted",
  "completed",
  "no_show_customer",
  "no_show_chef",
];

export async function loadBookingDetail(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<BookingDetail> {
  if (!isUuid(id)) throw notFound();
  const bRes = await db
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (bRes.error) throw fail("booking");
  const b = bRes.data as Row | null;
  if (!b) throw notFound();
  // RLS shows an admin every booking; the routes refuse admins, but never rely on that alone.
  if (userId !== b.customer_id && userId !== b.chef_id) throw notFound();
  const viewerIsChef = userId === b.chef_id;

  const [daysRes, intakeRes, peopleRes, chefRes, addrRes, contactRes] =
    await Promise.all([
      db
        .from("booking_days")
        .select("id, day_number, visit_date, total_cook_minutes")
        .eq("booking_id", id)
        .order("day_number"),
      db
        .from("intake_forms")
        .select("allergies, dietary_notes, allergy_conflict_acknowledged")
        .eq("booking_id", id)
        .maybeSingle(),
      db
        .from("profiles")
        .select("id, display_name")
        .in("id", [b.customer_id as string, b.chef_id as string]),
      db
        .from("chefs")
        .select("photo_path")
        .eq("profile_id", b.chef_id as string)
        .maybeSingle(),
      // Customer-only table (RLS): empty for the chef, who gets the address from the contact call.
      db
        .from("booking_addresses")
        .select("address_line, city, postal_code")
        .eq("booking_id", id)
        .maybeSingle(),
      db.rpc("get_booking_contact", { p_booking: id }),
    ]);
  if (
    daysRes.error ||
    intakeRes.error ||
    peopleRes.error ||
    chefRes.error ||
    addrRes.error ||
    contactRes.error
  )
    throw fail("detail parts");

  const dayRows = (daysRes.data ?? []) as Row[];
  const dishRes = dayRows.length
    ? await db
        .from("booking_day_dishes")
        .select(
          "booking_day_id, dish_id, dish_name, cook_minutes, ingredient_cost_cents, servings, allergens, quantity, eat_by_date, created_at, id",
        )
        .in(
          "booking_day_id",
          dayRows.map((d) => d.id as string),
        )
        .order("created_at")
        .order("id")
    : { data: [] as Row[], error: null };
  if (dishRes.error) throw fail("dishes");
  const dishRows = (dishRes.data ?? []) as Row[];

  const name = (pid: unknown) =>
    ((peopleRes.data ?? []) as Row[]).find((p) => p.id === pid)
      ?.display_name as string | undefined;

  const days = dayRows.map((d) => ({
    dayNumber: d.day_number as number,
    date: d.visit_date as string,
    cookMinutes: d.total_cook_minutes as number,
    dishes: dishRows
      .filter((x) => x.booking_day_id === d.id)
      .map((x) => ({
        dishId: (x.dish_id as string | null) ?? null,
        name: x.dish_name as string,
        quantity: x.quantity as number,
        cookMinutes: x.cook_minutes as number,
        ingredientCostCents: x.ingredient_cost_cents as number,
        servings: x.servings as number,
        allergens: (x.allergens as string[]) ?? [],
        eatByDate: x.eat_by_date as string,
      })),
  }));

  const intakeRow = intakeRes.data as Row | null;
  const intake = {
    allergies: (intakeRow?.allergies as string | undefined) ?? "",
    dietaryNotes: (intakeRow?.dietary_notes as string | undefined) ?? "",
    allergyConflictAcknowledged:
      intakeRow?.allergy_conflict_acknowledged === true,
  };
  // Recomputed from the snapshot, with the same synonym map as the booking warning.
  const unique = new Map<
    string,
    { id: string; name: string; allergens: string[] }
  >();
  for (const day of days)
    for (const dish of day.dishes) {
      const key = dish.dishId ?? dish.name;
      if (!unique.has(key))
        unique.set(key, {
          id: key,
          name: dish.name,
          allergens: dish.allergens,
        });
    }
  const allergyConflicts = findAllergyConflicts(intake.allergies, [
    ...unique.values(),
  ]).map((c) => ({
    dishId: c.dishId,
    dishName: c.dishName,
    allergens: c.allergens,
  }));

  // Contact: nothing before acceptance. The function itself enforces it; the status check here is
  // a second line so a future change to the function cannot leak by accident.
  const unlocked = UNLOCKED.includes(b.status as string);
  const contactRow = unlocked
    ? ((contactRes.data ?? []) as Row[])[0]
    : undefined;
  const contact = contactRow
    ? {
        displayName: contactRow.display_name as string,
        phone: (contactRow.phone_e164 as string | null) ?? null,
      }
    : null;

  let cookingPlace: BookingDetail["cookingPlace"] = null;
  if (b.location_type === "customer_home") {
    if (!viewerIsChef) {
      const a = addrRes.data as Row | null;
      if (a)
        cookingPlace = {
          line: a.address_line as string,
          city: a.city as string,
          postalCode: a.postal_code as string,
        };
    } else if (contactRow?.address_line) {
      cookingPlace = {
        line: contactRow.address_line as string,
        city: contactRow.city as string,
        postalCode: contactRow.postal_code as string,
      };
    }
  } else if (!viewerIsChef && contactRow?.address_line) {
    // chef_home, customer's view: the kitchen address, only once accepted.
    cookingPlace = {
      line: contactRow.address_line as string,
      city: contactRow.city as string,
      postalCode: contactRow.postal_code as string,
    };
  }

  const distance = b.distance_km == null ? null : Number(b.distance_km);
  return {
    id: b.id as string,
    status: b.status as BookingStatus,
    viewerRole: viewerIsChef ? "chef" : "customer",
    locationType: b.location_type as BookingDetail["locationType"],
    groceryOption: b.grocery_option as BookingDetail["groceryOption"],
    isFreeTrial: b.is_free_trial === true,
    createdAt: iso(b.created_at),
    expiresAt: b.expires_at ? iso(b.expires_at) : null,
    respondedAt: b.responded_at ? iso(b.responded_at) : null,
    declineReason: (b.decline_reason as string | null) ?? null,
    chef: {
      id: b.chef_id as string,
      displayName: name(b.chef_id) ?? "Chef",
      photoPath:
        ((chefRes.data as Row | null)?.photo_path as string | null) ?? null,
    },
    customer: {
      id: b.customer_id as string,
      displayName: name(b.customer_id) ?? "Customer",
    },
    days,
    estimate: {
      cookMinutes: b.est_cook_minutes as number,
      labourCents: b.est_labour_cents as number,
      ingredientsCents: b.est_ingredients_cents as number,
      travelCents: b.est_travel_cents as number,
      platformFeeCents: b.est_platform_fee_cents as number,
      platformFeePercent: Number(b.platform_fee_percent),
      platformFeeCollected: false,
      totalCents: b.est_total_cents as number,
      currency: b.currency as string,
      travelRateCentsPerKm: b.travel_rate_cents_per_km as number,
      distanceKm: distance,
    },
    intake,
    allergyConflicts,
    cookingPlace,
    contact,
    payment: { mock: true, collected: false },
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
const TS_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const CURSOR_MAX = 200;

interface ListCursor {
  c: string;
  i: string;
}

function encodeCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** Strict: only a cursor this module made decodes. */
export function decodeListCursor(raw: string): ListCursor | null {
  if (!raw || raw.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(raw))
    return null;
  try {
    const v: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const { c, i } = v as Record<string, unknown>;
    if (Object.keys(v).length !== 2) return null;
    if (typeof c !== "string" || !TS_RE.test(c)) return null;
    if (typeof i !== "string" || !isUuid(i)) return null;
    return { c, i };
  } catch {
    return null;
  }
}

export interface ListQuery {
  status: BookingListStatus;
  limit: number;
  cursor: ListCursor | null;
}

export function parseBookingListQuery(params: URLSearchParams): ListQuery {
  const errors: Record<string, string> = {};
  const one = (k: string): string => {
    const all = params.getAll(k);
    if (all.length > 1) {
      errors[k] = "Send this only once.";
      return "";
    }
    return (all[0] ?? "").trim();
  };
  let status: BookingListStatus = "all";
  const s = one("status");
  if (s && !errors.status) {
    if (
      s === "all" ||
      s === "open" ||
      (BOOKING_STATUSES as readonly string[]).includes(s)
    )
      status = s as BookingListStatus;
    else errors.status = "Use a booking status, open or all.";
  }
  let limit = 20;
  const l = one("limit");
  if (l && !errors.limit) {
    if (!/^\d{1,3}$/.test(l) || Number(l) < 1 || Number(l) > 50)
      errors.limit = "Use a whole number from 1 to 50.";
    else limit = Number(l);
  }
  let cursor: ListCursor | null = null;
  const c = one("cursor");
  if (c && !errors.cursor) {
    cursor = decodeListCursor(c);
    if (!cursor) errors.cursor = "That page marker is not valid.";
  }
  if (Object.keys(errors).length) throw validationFailed(errors);
  return { status, limit, cursor };
}

export async function listBookings(
  db: SupabaseClient,
  userId: string,
  role: "customer" | "chef",
  q: ListQuery,
): Promise<BookingListResponse> {
  let req = db
    .from("bookings")
    .select(
      "id, customer_id, chef_id, status, location_type, grocery_option, is_free_trial, est_total_cents, currency, expires_at, created_at",
    )
    .eq(role === "chef" ? "chef_id" : "customer_id", userId);
  if (q.status === "open") req = req.in("status", ["requested", "accepted"]);
  else if (q.status !== "all") req = req.eq("status", q.status);
  if (q.cursor) {
    // Both values passed the strict checks above (a timestamp and a uuid); still quoted.
    req = req.or(
      `created_at.lt."${q.cursor.c}",and(created_at.eq."${q.cursor.c}",id.lt.${q.cursor.i})`,
    );
  }
  const res = await req
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (res.error) throw fail("list");
  const rows = (res.data ?? []) as Row[];
  const page = rows.slice(0, q.limit);
  const hasMore = rows.length > q.limit;

  const ids = page.map((r) => r.id as string);
  const otherIds = [
    ...new Set(
      page.map((r) => (role === "chef" ? r.customer_id : r.chef_id) as string),
    ),
  ];
  const [daysRes, peopleRes] = await Promise.all([
    ids.length
      ? db
          .from("booking_days")
          .select("booking_id, visit_date")
          .in("booking_id", ids)
      : Promise.resolve({ data: [] as Row[], error: null }),
    otherIds.length
      ? db.from("profiles").select("id, display_name").in("id", otherIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (daysRes.error || peopleRes.error) throw fail("list parts");
  const days = (daysRes.data ?? []) as Row[];
  const people = (peopleRes.data ?? []) as Row[];

  const items: BookingSummary[] = page.map((r) => {
    const dates = days
      .filter((d) => d.booking_id === r.id)
      .map((d) => d.visit_date as string)
      .sort();
    const other = (role === "chef" ? r.customer_id : r.chef_id) as string;
    return {
      id: r.id as string,
      status: r.status as BookingStatus,
      locationType: r.location_type as BookingSummary["locationType"],
      groceryOption: r.grocery_option as BookingSummary["groceryOption"],
      isFreeTrial: r.is_free_trial === true,
      createdAt: iso(r.created_at),
      expiresAt: r.expires_at ? iso(r.expires_at) : null,
      firstDay: dates[0] ?? "",
      dates,
      totalCents: r.est_total_cents as number,
      currency: r.currency as string,
      counterparty: {
        id: other,
        displayName:
          (people.find((p) => p.id === other)?.display_name as
            string | undefined) ?? (role === "chef" ? "Customer" : "Chef"),
      },
    };
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeListCursor(last.created_at as string, last.id as string)
        : null,
  };
}

function encodeListCursor(createdAt: string, id: string): string {
  return encodeCursor({ c: createdAt, i: id });
}
