// Server side of the booking routes (T-042, contract section 7A).
//
// Authorization (contract section 2): every entry point takes a BookingCaller from one of the
// require* functions below. They take the identity from getUser() and the role from profiles.role
// (requireCaller), answer 403 for the wrong role and only then build the service-role client. The
// customer id is always the session user; the chef id of a booking request is looked up, never
// trusted; a booking id from the client is matched against the caller's own rows (chef_id =
// caller in the database function, RLS on every read).
//
// Races: the booking, its address, days, dish snapshots, intake form, free-trial claim and the
// chef's notification are written by ONE database function (create_booking), so a failed claim
// leaves no booking and a booking never exists with is_free_trial = true and no claim. The unique
// index booking_days_one_per_chef_date decides two requests for the same chef and date; an
// advisory lock per customer decides the open-request limit (D-28).
//
// Free trial: applyFreeTrialEvent is called only after the change is saved. Expiry is lazy (see
// sweepExpired); a crash between a status change and the claim release is repaired by the next
// sweep.
//
// MOCK: nothing here moves money. The platform fee is shown and never collected.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import { rejectUnknownKeys } from "@/lib/api/request";
import type {
  BookingDetail,
  BookingEstimate,
  BookingEstimateResponse,
  BookingIssue,
  FreeTrialBlocker,
  UserRole,
} from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
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
  type BookingValidation,
} from "@/lib/domain/bookingValidation";
import type { FreeTrialEvent } from "@/lib/domain/cancellation";
import { MAX_OPEN_REQUESTS } from "@/lib/domain/config";
import {
  isListable,
  prefixCentres,
  publicLocationOptions,
} from "@/lib/domain/search";
import { addDays, isRealDate, torontoToday } from "@/lib/domain/dishes";
import { eatByDate } from "@/lib/domain/eatBy";
import { estimateBooking, type Estimate } from "@/lib/domain/pricing";
import { findContactDetails } from "@/lib/domain/contactDetails";
import { hasUnsafeText } from "@/lib/domain/text-safety";
import { requireCaller } from "@/lib/server/caller";
import {
  applyFreeTrialEvent,
  prepareFreeTrial,
  recordTrialBlock,
  trialBlockFromMessage,
  trialUsed,
} from "@/lib/server/free-trial";
import { loadBookingDetail } from "@/lib/server/booking-views";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export interface BookingCaller {
  supabase: SupabaseClient;
  /** Service-role client. Created only after the role check. */
  admin: SupabaseClient;
  userId: string;
  role: UserRole;
}

async function callerWithRoles(
  allowed: readonly UserRole[],
  message: string,
): Promise<BookingCaller> {
  const c = await requireCaller();
  if (!allowed.includes(c.role)) throw new ApiFailure("FORBIDDEN", message);
  return { ...c, admin: createAdminClient() };
}

export const requireCustomer = () =>
  callerWithRoles(["customer"], "Only customers can do this.");
export const requireChefParty = () =>
  callerWithRoles(["chef"], "Only chefs can do this.");
/** Customer or chef; admins get 403 (the admin booking list is WO-5). */
export const requireBookingParty = () =>
  callerWithRoles(
    ["customer", "chef"],
    "Only the customer or the chef of a booking can do this.",
  );

// ---------------------------------------------------------------------------
// Lazy expiry (D-19)
// ---------------------------------------------------------------------------
/**
 * Marks the user's stale `requested` bookings `expired` (one conditional UPDATE in the database)
 * and then releases the free-trial claim of every declined / expired booking that still holds
 * one. The release is applyFreeTrialEvent, called after the status is saved. A failure of the
 * release is logged and left for the next sweep: the response of the route that called this must
 * not fail because of it.
 */
export async function sweepExpired(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const r = await admin.rpc("expire_stale_bookings", { p_user: userId });
  if (r.error) throw new Error(`expiry sweep failed: ${r.error.message}`);
  const release = ((r.data as Row | null)?.release ?? []) as {
    booking_id: string;
    status: string;
  }[];
  for (const x of release) {
    try {
      await applyFreeTrialEvent(x.booking_id, x.status as FreeTrialEvent, {
        db: admin,
      });
    } catch (e) {
      console.error(
        "bookings: free-trial release failed:",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Loading the chef for a request
// ---------------------------------------------------------------------------
interface LoadedChef {
  bookingChef: BookingChef;
  hourlyRateCents: number;
  servicePrefix: string | null;
  servings: Map<string, number>;
  bookedDates: Set<string>;
  centres: ReturnType<typeof prefixCentres>;
}

const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? (v as string[]) : [];

/**
 * The chef as the booking rules need them, or null when the chef must look unknown: not found,
 * not approved, hidden by A-20 (no bio, photo or active dish), no bookable location option
 * (D-25) or no hourly rate. Uses the service role (it reads availability and bookings); the
 * caller has been authorized as a customer.
 */
async function loadChef(
  admin: SupabaseClient,
  chefId: string,
  dates: string[],
): Promise<LoadedChef | null> {
  const chefRes = await admin
    .from("chefs")
    .select(
      "profile_id, status, bio, photo_path, hourly_rate_cents, service_postal_prefix, service_radius_km, location_options, chef_home_enabled",
    )
    .eq("profile_id", chefId)
    .maybeSingle();
  if (chefRes.error) throw new Error("chef read failed");
  const c = chefRes.data as Row | null;
  if (!c || c.status !== "approved") return null;

  const real = dates.filter(isRealDate);
  const sorted = [...real].sort();
  const [dishRes, availRes, bookedRes, prefixRes] = await Promise.all([
    admin
      .from("dishes")
      .select(
        "id, chef_id, name, is_active, cook_minutes, ingredient_cost_cents, allergens, shelf_life_days, servings",
      )
      .eq("chef_id", chefId),
    real.length
      ? admin
          .from("availability")
          .select("day")
          .eq("chef_id", chefId)
          .eq("available", true)
          .in("day", real)
      : Promise.resolve({ data: [] as Row[], error: null }),
    real.length
      ? admin.rpc("chef_booked_dates", {
          p_chef: chefId,
          p_from: sorted[0],
          p_to: sorted[sorted.length - 1],
        })
      : Promise.resolve({ data: [] as unknown[], error: null }),
    admin.from("postal_prefixes").select("prefix, lat, lng"),
  ]);
  if (dishRes.error || availRes.error || bookedRes.error || prefixRes.error)
    throw new Error("chef booking data read failed");

  const dishRows = (dishRes.data ?? []) as Row[];
  const activeCount = dishRows.filter((d) => d.is_active === true).length;
  const options = publicLocationOptions(
    stringArray(c.location_options) as ("customer_home" | "chef_home")[],
    c.chef_home_enabled === true,
  );
  if (
    !isListable({
      bio: (c.bio as string | null) ?? null,
      photoPath: (c.photo_path as string | null) ?? null,
      activeDishCount: activeCount,
    }) ||
    options.length === 0 ||
    typeof c.hourly_rate_cents !== "number"
  )
    return null;

  const centres = prefixCentres(
    ((prefixRes.data ?? []) as Row[]).map((p) => ({
      prefix: p.prefix as string,
      city: "",
      lat: Number(p.lat),
      lng: Number(p.lng),
    })),
  );
  const prefix = (c.service_postal_prefix as string | null) ?? null;
  const dishes: BookableDish[] = dishRows.map((d) => ({
    id: d.id as string,
    chefId: d.chef_id as string,
    name: d.name as string,
    isActive: d.is_active === true,
    cookMinutes: d.cook_minutes as number,
    ingredientCostCents: d.ingredient_cost_cents as number,
    allergens: stringArray(d.allergens),
    shelfLifeDays: d.shelf_life_days as number,
  }));
  // setof date comes back as a list of strings (or one-key objects, depending on the client).
  const booked = new Set<string>(
    ((bookedRes.data ?? []) as unknown[]).map((x) =>
      typeof x === "string" ? x : String(Object.values(x as Row)[0]),
    ),
  );
  return {
    bookingChef: {
      id: chefId,
      status: "approved",
      // The real options: the rules re-check "offered" and "enabled" themselves, so a customer who
      // asks for chef's home on a chef without it gets LOCATION_NOT_OFFERED / CHEF_HOME_NOT_ENABLED.
      locationOptions: stringArray(c.location_options) as (
        "customer_home" | "chef_home"
      )[],
      chefHomeEnabled: c.chef_home_enabled === true,
      serviceRadiusKm: c.service_radius_km as number,
      serviceCentre: prefix ? (centres.get(prefix) ?? null) : null,
      availableDates: new Set(
        ((availRes.data ?? []) as Row[]).map((r) => r.day as string),
      ),
      dishes,
    },
    hourlyRateCents: c.hourly_rate_cents as number,
    servicePrefix: prefix,
    servings: new Map(
      dishRows.map((d) => [d.id as string, d.servings as number]),
    ),
    bookedDates: booked,
    centres,
  };
}

// ---------------------------------------------------------------------------
// Evaluation shared by estimate and create
// ---------------------------------------------------------------------------
interface Evaluation {
  issues: BookingIssue[];
  validation: BookingValidation | null;
  chef: LoadedChef | null;
  /** Resolved days sorted by date (day 1 first) with the estimate lines, when priceable. */
  priced: { estimate: Estimate; days: BookingValidation["days"] } | null;
  today: string;
}

const HIDDEN: BookingIssue = {
  code: "CHEF_NOT_BOOKABLE",
  message: "This chef is not available for booking.",
};

async function evaluate(
  admin: SupabaseClient,
  req: ParsedBooking,
  now: Date,
  isFreeTrial: boolean,
): Promise<Evaluation> {
  const today = torontoToday(now);
  const chef = await loadChef(
    admin,
    req.chefId,
    req.days.map((d) => d.date),
  );
  if (!chef)
    return {
      issues: [HIDDEN],
      validation: null,
      chef: null,
      priced: null,
      today,
    };

  const validation = validateBooking(
    {
      locationType: req.locationType,
      customerPostal: req.address?.postalCode,
      days: req.days,
      intake: req.intake,
      allergyConflictAcknowledged: req.allergyConflictAcknowledged,
    },
    chef.bookingChef,
    { today, chefBookedDates: chef.bookedDates, centres: chef.centres },
  );

  // Priceable: every day has all its dishes resolved, and the distance is known when it matters.
  let priced: Evaluation["priced"] = null;
  const days = [...validation.days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const complete =
    validation.days.length >= 1 &&
    validation.days.length === req.days.length &&
    validation.days.every(
      (d, i) =>
        d.dishes.length === req.days[i].dishes.length && d.dishes.length > 0,
    ) &&
    (req.locationType === "chef_home" || validation.distanceMetres !== null);
  if (complete) {
    try {
      priced = {
        days,
        estimate: estimateBooking({
          hourlyRateCents: chef.hourlyRateCents,
          locationType: req.locationType,
          isFreeTrial,
          distanceMetres: validation.distanceMetres,
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
  return { issues: validation.errors, validation, chef, priced, today };
}

function mapEstimate(
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

const TRIAL_BLOCKERS = new Set<string>([
  "PHONE_NOT_SUBMITTED",
  "PHONE_NOT_VERIFIED",
  "ADDRESS_NOT_SET",
]);

/** Advisory free-trial answer for the estimate screen. Reserves nothing. */
async function advisoryTrial(
  customerId: string,
): Promise<{ eligible: boolean; blocker: FreeTrialBlocker | null }> {
  try {
    const p = await prepareFreeTrial(customerId);
    return p.eligible
      ? { eligible: true, blocker: null }
      : { eligible: false, blocker: "USED" };
  } catch (e) {
    if (e instanceof ApiFailure && TRIAL_BLOCKERS.has(e.code))
      return { eligible: false, blocker: e.code as FreeTrialBlocker };
    throw e;
  }
}

function parseOrFail(
  body: Record<string, unknown>,
  mode: "estimate" | "create",
): ParsedBooking {
  rejectUnknownKeys(body, [...BOOKING_KEYS]);
  const p = parseBookingBody(body, mode);
  if (!p.value) throw validationFailed(p.errors);
  return p.value;
}

// ---------------------------------------------------------------------------
// POST /api/bookings/estimate
// ---------------------------------------------------------------------------
export async function estimateRequest(
  caller: BookingCaller,
  body: Record<string, unknown>,
  now: Date = new Date(),
): Promise<BookingEstimateResponse> {
  const req = parseOrFail(body, "estimate");
  await sweepExpired(caller.admin, caller.userId);
  const trial = await advisoryTrial(caller.userId);
  const ev = await evaluate(
    caller.admin,
    req,
    now,
    req.useFreeTrial && trial.eligible,
  );

  const dates = ev.priced?.days.map((d) => d.date) ?? [];
  const first = req.days
    .map((d) => d.date)
    .filter((d) => isRealDate(d) && d > ev.today)
    .sort()[0];
  return {
    ok: ev.issues.length === 0,
    issues: ev.issues,
    estimate: ev.priced
      ? mapEstimate(
          ev.priced.estimate,
          dates,
          ev.validation?.distanceMetres ?? null,
        )
      : null,
    allergyConflicts: (ev.validation?.allergyConflicts ?? []).map((c) => ({
      dishId: c.dishId,
      dishName: c.dishName,
      allergens: c.allergens,
    })),
    freeTrial: trial,
    today: ev.today,
    firstBookableDay: addDays(ev.today, 1),
    wouldExpireAt: first ? requestExpiry(now, first).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/bookings
// ---------------------------------------------------------------------------
async function requireVerifiedPhone(
  admin: SupabaseClient,
  customerId: string,
): Promise<void> {
  const r = await admin
    .from("profile_private")
    .select("phone_e164, phone_verified")
    .eq("profile_id", customerId)
    .maybeSingle();
  if (r.error) throw new Error("phone lookup failed");
  if (!r.data?.phone_e164)
    throw new ApiFailure(
      "PHONE_NOT_SUBMITTED",
      "Add and verify your phone number before booking.",
    );
  if (!r.data.phone_verified)
    throw new ApiFailure(
      "PHONE_NOT_VERIFIED",
      "Verify your phone number before booking.",
    );
}

export async function createBooking(
  caller: BookingCaller,
  body: Record<string, unknown>,
  now: Date = new Date(),
): Promise<BookingDetail> {
  const req = parseOrFail(body, "create");
  const { admin, userId } = caller;
  await requireVerifiedPhone(admin, userId);

  // Dead requests must not hold a date or count against the limit (both sides of this booking).
  await sweepExpired(admin, userId);
  await sweepExpired(admin, req.chefId);

  const ev = await evaluate(admin, req, now, req.useFreeTrial);
  const outcome = classifyIssues(ev.issues);
  if (outcome === "hidden")
    throw new ApiFailure("NOT_FOUND", "Chef not found.");
  if (outcome === "double_booked")
    throw new ApiFailure(
      "DOUBLE_BOOKED",
      "The chef is already booked on that date.",
      {
        issues: ev.issues,
      },
    );
  if (outcome === "validation" || !ev.priced || !ev.chef || !ev.validation)
    throw validationWithIssues(ev.issues);

  // Free trial: the clean 409s of the advisory check come first; the real decision is the claim
  // written inside create_booking.
  let trial: { phone_hash: string; address_hash: string } | null = null;
  if (req.useFreeTrial) {
    const p = await prepareFreeTrial(userId);
    if (!p.eligible) {
      if (p.reason) await recordTrialBlock(admin, userId, p.reason);
      throw trialUsed();
    }
    trial = {
      phone_hash: p.applicant.phoneHash,
      address_hash: p.applicant.addressHash,
    };
  }

  const e = ev.priced.estimate;
  const sorted = ev.priced.days;
  const dates = sorted.map((d) => d.date);
  const payload = {
    customer_id: userId,
    chef_id: req.chefId,
    location_type: req.locationType,
    grocery_option: req.groceryOption,
    max_open: MAX_OPEN_REQUESTS,
    expires_at: requestExpiry(now, dates[0]).toISOString(),
    est: {
      hourly_rate_cents: ev.chef.hourlyRateCents,
      cook_minutes: e.cookMinutes,
      labour_cents: e.labourCents,
      ingredients_cents: e.ingredientsCents,
      travel_cents: e.travelCents,
      platform_fee_cents: e.platformFeeCents,
      total_cents: e.totalCents,
      platform_fee_percent: e.platformFeePercent,
      travel_rate_cents_per_km: e.travelRateCentsPerKm,
      distance_km:
        ev.validation.distanceMetres === null
          ? null
          : Math.round(ev.validation.distanceMetres / 10) / 100,
      service_postal_prefix: ev.chef.servicePrefix,
    },
    address: req.address
      ? {
          line: req.address.line,
          city: req.address.city,
          postal_code: req.address.postalCode,
        }
      : null,
    days: sorted.map((d, i) => ({
      date: d.date,
      cook_minutes: e.days[i].cookMinutes,
      dishes: d.dishes.map((x) => ({
        dish_id: x.id,
        name: x.name,
        cook_minutes: x.cookMinutes,
        ingredient_cost_cents: x.ingredientCostCents,
        servings: ev.chef!.servings.get(x.id) ?? 1,
        allergens: [...x.allergens],
        quantity: x.quantity,
        eat_by_date: eatByDate(d.date, x.shelfLifeDays),
      })),
    })),
    intake: {
      allergies: req.intake!.allergies,
      dietary_notes: req.intake!.dietaryNotes,
      // Stored as true only when there really was a conflict that the customer acknowledged.
      acknowledged:
        req.allergyConflictAcknowledged &&
        ev.validation.allergyConflicts.length > 0,
    },
    free_trial: trial,
  };

  const res = await admin.rpc("create_booking", { p: payload });
  if (res.error) throw await mapCreateError(admin, userId, req, res.error);
  const out = res.data as Row;
  switch (out.result) {
    case "ok":
      return loadBookingDetail(
        caller.supabase,
        userId,
        out.booking_id as string,
      );
    case "too_many_open":
      throw new ApiFailure(
        "TOO_MANY_OPEN_REQUESTS",
        `You already have ${MAX_OPEN_REQUESTS} requests waiting for an answer. Wait for a reply, or cancel one, before asking again.`,
      );
    case "chef_not_bookable":
      throw new ApiFailure("NOT_FOUND", "Chef not found.");
    case "date_too_soon":
      throw validationWithIssues([
        {
          code: "DATE_TOO_SOON",
          message:
            "Bookings start tomorrow at the earliest. Pick a later date.",
          dayIndex: 0,
        },
      ]);
    case "chef_unavailable": {
      const gone = new Set(stringArray(out.dates));
      throw validationWithIssues(
        req.days
          .map((d, dayIndex) => ({ d, dayIndex }))
          .filter(({ d }) => gone.has(d.date))
          .map(({ dayIndex }) => ({
            code: "CHEF_UNAVAILABLE" as const,
            message: "The chef is not available on that date.",
            dayIndex,
          })),
      );
    }
    default:
      throw new Error("create_booking returned an unknown result");
  }
}

function validationWithIssues(issues: BookingIssue[]): ApiFailure {
  return new ApiFailure("VALIDATION_FAILED", "Check the highlighted fields.", {
    fields: issuesToFields(issues),
    issues,
  });
}

/** Maps the errors create_booking raises (unique and check violations) to clean answers. */
async function mapCreateError(
  admin: SupabaseClient,
  customerId: string,
  req: ParsedBooking,
  err: { code?: string; message?: string },
): Promise<Error> {
  const msg = err.message ?? "";
  if (err.code === "23505") {
    if (msg.includes("booking_days_one_per_chef_date")) {
      // Name the days that are taken now (the unique index does not say which one lost).
      const real = req.days
        .map((d) => d.date)
        .filter(isRealDate)
        .sort();
      const taken = new Set<string>();
      if (real.length) {
        const r = await admin.rpc("chef_booked_dates", {
          p_chef: req.chefId,
          p_from: real[0],
          p_to: real[real.length - 1],
        });
        for (const x of (r.data ?? []) as unknown[])
          taken.add(
            typeof x === "string" ? x : String(Object.values(x as Row)[0]),
          );
      }
      const issues: BookingIssue[] = req.days
        .map((d, dayIndex) => ({ d, dayIndex }))
        .filter(({ d }) => taken.has(d.date))
        .map(({ dayIndex }) => ({
          code: "DOUBLE_BOOKED" as const,
          message: "The chef is already booked on that date.",
          dayIndex,
        }));
      return new ApiFailure(
        "DOUBLE_BOOKED",
        "The chef is already booked on that date.",
        {
          issues: issues.length
            ? issues
            : [
                {
                  code: "DOUBLE_BOOKED",
                  message: "The chef is already booked on that date.",
                },
              ],
        },
      );
    }
    const reason = trialBlockFromMessage(msg);
    if (reason) {
      await recordTrialBlock(admin, customerId, reason);
      return trialUsed();
    }
  }
  if (err.code === "23514") {
    // Database guards behind the rules above: a chef who changed between the read and the write,
    // or a date that slipped into the past at midnight.
    if (msg.includes("past"))
      return validationWithIssues([
        {
          code: "DATE_IN_PAST",
          message: "That date has already passed.",
          dayIndex: 0,
        },
      ]);
    return new ApiFailure("NOT_FOUND", "Chef not found.");
  }
  return new Error(`create_booking failed: ${err.code ?? ""} ${msg}`);
}

// ---------------------------------------------------------------------------
// Accept / decline
// ---------------------------------------------------------------------------
export function parseDeclineBody(body: Record<string, unknown>): string {
  rejectUnknownKeys(body, ["reason"]);
  const r = body.reason;
  // D-34: the reason is required. Blank or whitespace only is the same as missing.
  if (typeof r !== "string" || r.trim() === "")
    throw validationFailed({
      reason: "Tell the customer why you are declining.",
    });
  const t = r.trim();
  if (t.length < 3 || t.length > 500)
    throw validationFailed({ reason: "Enter 3 to 500 characters." });
  if (hasUnsafeText(t))
    throw validationFailed({ reason: "Remove control or invalid characters." });
  // The reason reaches the customer's notification before any acceptance (CLAUDE.md 6.8).
  if (findContactDetails(t))
    throw new ApiFailure(
      "CONTACT_DETAILS_NOT_ALLOWED",
      "Do not put phone numbers, email addresses or links in the reason. Contact details are shared after a booking is accepted.",
      {
        fields: { reason: "Remove phone numbers, email addresses and links." },
      },
    );
  return t;
}

/**
 * `body` is the parsed JSON object for a decline (null for accept). The booking must be the
 * caller's own (404 otherwise, also when the body is invalid, so another chef's booking id is
 * never "validated"); only then is the reason checked.
 */
export async function answerBooking(
  caller: BookingCaller,
  id: string,
  action: "accept" | "decline",
  body: Record<string, unknown> | null,
): Promise<BookingDetail> {
  if (!isUuid(id)) throw new ApiFailure("NOT_FOUND", "Booking not found.");
  const own = await caller.admin
    .from("bookings")
    .select("id")
    .eq("id", id)
    .eq("chef_id", caller.userId)
    .maybeSingle();
  if (own.error) throw new Error("booking lookup failed");
  if (!own.data) throw new ApiFailure("NOT_FOUND", "Booking not found.");
  const reason = action === "decline" && body ? parseDeclineBody(body) : null;
  const r = await caller.admin.rpc("answer_booking", {
    p_booking: id,
    p_chef: caller.userId,
    p_action: action,
    p_reason: reason,
  });
  if (r.error) throw new Error(`answer_booking failed: ${r.error.message}`);
  const out = r.data as Row;

  // The status change is saved; now the claim follows it (A-16). A failed release is logged and
  // repaired by the next sweep, so it never turns a saved answer into an error.
  const follow = async (event: FreeTrialEvent) => {
    try {
      await applyFreeTrialEvent(id, event, { db: caller.admin });
    } catch (e) {
      console.error(
        "bookings: free-trial update failed:",
        e instanceof Error ? e.message : "unknown",
      );
    }
  };

  switch (out.result) {
    case "ok":
      await follow(out.status as FreeTrialEvent);
      return loadBookingDetail(caller.supabase, caller.userId, id);
    case "expired":
      await follow("expired");
      throw new ApiFailure(
        "REQUEST_EXPIRED",
        "This request expired before it was answered. The date is free again.",
      );
    case "not_found":
      throw new ApiFailure("NOT_FOUND", "Booking not found.");
    case "invalid_state":
      throw new ApiFailure(
        "INVALID_STATE",
        "This request was already answered or is no longer open.",
      );
    case "chef_not_approved":
      throw new ApiFailure(
        "INVALID_STATE",
        "Your chef account is not approved, so you cannot accept bookings.",
      );
    default:
      throw new Error("answer_booking returned an unknown result");
  }
}
