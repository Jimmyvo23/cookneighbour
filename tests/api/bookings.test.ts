// T-042: booking routes against the LOCAL Supabase (contract section 7A, CLAUDE.md 6.4, 6.5, 10).
// Every chef and customer is new, so tests do not share dates, phones or addresses. Races call the
// routes in parallel; the harness captures each browser's cookie jar when a POST starts, so
// parallel POSTs from different browsers are safe (GETs are not run in parallel).
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/bookings/route";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
import { freshLimits } from "./harness";
import {
  accept,
  book,
  bookOk,
  bookableChef,
  bookingBody,
  bookingCount,
  bookingCustomer,
  bookingRow,
  claimOf,
  day,
  decline,
  estimate,
  getBooking,
  listBookings,
  makeStale,
  notesFor,
  setChef,
  today,
  type TestChef,
} from "./booking-helpers";
import { newAdmin, svc } from "./chef-helpers";
import { Browser } from "./harness";

beforeEach(() => freshLimits());

const dayBody = (
  chef: TestChef,
  offset: number,
  dish = "pho",
  quantity = 1,
) => ({
  date: day(offset),
  dishes: [{ dishId: chef.dishes[dish], quantity }],
});

describe("POST /api/bookings: a valid request", () => {
  it("creates a requested booking with the estimate snapshot, eat-by dates and expiry", async () => {
    const chef = await bookableChef({
      dishes: [
        {
          key: "pho",
          name: "Pho bo",
          minutes: 120,
          cost: 2500,
          shelf: 3,
          servings: 4,
        },
      ],
    });
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, {
        days: [dayBody(chef, 5)],
        groceryOption: "chef_shops",
      }),
    );
    const b = r.body;
    expect(b).toMatchObject({
      status: "requested",
      viewerRole: "customer",
      locationType: "customer_home",
      groceryOption: "chef_shops",
      isFreeTrial: false,
      respondedAt: null,
      declineReason: null,
      chef: { id: chef.id },
      customer: { id: c.id, displayName: "Booking Customer" },
      payment: { mock: true, collected: false },
      contact: null,
      intake: {
        allergies: "None",
        dietaryNotes: "None",
        allergyConflictAcknowledged: false,
      },
      allergyConflicts: [],
      cookingPlace: {
        line: "100 Cooking Street",
        city: "Mississauga",
        postalCode: "L5B1A1",
      },
    });
    expect(b.days).toEqual([
      {
        dayNumber: 1,
        date: day(5),
        cookMinutes: 120,
        dishes: [
          {
            dishId: chef.dishes.pho,
            name: "Pho bo",
            quantity: 1,
            cookMinutes: 120,
            ingredientCostCents: 2500,
            servings: 4,
            allergens: [],
            eatByDate: day(8), // visit date + the dish's shelf life (A-7)
          },
        ],
      },
    ]);
    // 120 minutes at $30/h = $60.00; ingredients $25.00; same postal area so no travel; the platform
    // fee (10% of labour) is shown, never collected, and not part of the total.
    expect(b.estimate).toEqual({
      cookMinutes: 120,
      labourCents: 6000,
      ingredientsCents: 2500,
      travelCents: 0,
      platformFeeCents: 600,
      platformFeePercent: 10,
      platformFeeCollected: false,
      totalCents: 8500,
      currency: "CAD",
      travelRateCentsPerKm: 60,
      distanceKm: 0,
    });
    const row = await bookingRow(r.id);
    expect(row.est_total_cents).toBe(8500);
    expect(row.service_postal_prefix).toBe("L5B");
    expect(row.hourly_rate_cents).toBe(3000);
    // D-19: the earlier of 72 hours and 00:00 Toronto on day 1. Day 5 is far away: 72 hours (the
    // app clock and the database clock differ by a moment, so allow a few seconds).
    const created = new Date(b.createdAt).getTime();
    expect(
      Math.abs(new Date(b.expiresAt).getTime() - (created + 72 * 3600_000)),
    ).toBeLessThan(10_000);
    expect(row.expires_at).toBeTruthy();
    // The chef is told (no names, phone numbers, addresses or allergy text).
    const notes = await notesFor(chef.id, "booking_requested");
    expect(notes).toHaveLength(1);
    expect(notes[0].booking_id).toBe(r.id);
    expect(JSON.stringify(notes[0])).not.toMatch(
      /Cooking Street|Booking Customer|\+1|allerg/i,
    );
    // The address of the booking is stored apart from the booking row.
    const addr = await svc
      .from("booking_addresses")
      .select("*")
      .eq("booking_id", r.id)
      .single();
    expect(addr.data).toMatchObject({
      address_line: "100 Cooking Street",
      postal_code: "L5B1A1",
    });
  });

  it("a request for tomorrow expires at 00:00 Toronto tomorrow (D-27 with D-19)", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 1)] }));
    expect(r.body.expiresAt).toBe(torontoStartOfDay(day(1)).toISOString());
  });

  it("days are numbered by date whatever the order sent; several dishes and quantities add up", async () => {
    const chef = await bookableChef({
      dishes: [
        { key: "pho", name: "Pho", minutes: 60, cost: 1000 },
        { key: "rolls", name: "Rolls", minutes: 30, cost: 500 },
      ],
    });
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, {
        days: [
          {
            date: day(9),
            dishes: [
              { dishId: chef.dishes.pho, quantity: 2 },
              { dishId: chef.dishes.rolls },
            ],
          },
          {
            date: day(7),
            dishes: [{ dishId: chef.dishes.rolls, quantity: 3 }],
          },
        ],
      }),
    );
    expect(
      r.body.days.map((d: { dayNumber: number; date: string }) => [
        d.dayNumber,
        d.date,
      ]),
    ).toEqual([
      [1, day(7)],
      [2, day(9)],
    ]);
    expect(r.body.days[0].cookMinutes).toBe(90);
    expect(r.body.days[1].cookMinutes).toBe(150);
    expect(r.body.estimate.cookMinutes).toBe(240);
    expect(r.body.estimate.labourCents).toBe(12000); // 240 min at $30/h
    expect(r.body.estimate.ingredientsCents).toBe(1500 + 2500 + 0); // 3 rolls; 2 pho + 1 rolls
    const rows = await svc
      .from("booking_days")
      .select("day_number, visit_date, is_active")
      .eq("booking_id", r.id)
      .order("day_number");
    expect(rows.data).toEqual([
      { day_number: 1, visit_date: day(7), is_active: true },
      { day_number: 2, visit_date: day(9), is_active: true },
    ]);
  });

  it("a customer's-home booking farther than zero km pays a travel fee; a chef's-home booking never does", async () => {
    const chef = await bookableChef({
      prefix: "L5N",
      radius: 25,
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const c = await bookingCustomer();
    const far = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 6), dayBody(chef, 7)] }),
    );
    const e = far.body.estimate;
    expect(e.distanceKm).toBeGreaterThan(3);
    expect(e.distanceKm).toBeLessThan(15);
    expect(e.travelCents).toBeGreaterThan(0);
    expect(e.travelCents % 2).toBe(0); // the same fee on each of the two visit days
    expect(e.totalCents).toBe(
      e.labourCents + e.ingredientsCents + e.travelCents,
    );
    const home = await bookOk(
      c,
      bookingBody(chef, {
        locationType: "chef_home",
        address: undefined,
        days: [dayBody(chef, 8)],
      }),
    );
    expect(home.body.estimate.travelCents).toBe(0);
    expect(home.body.estimate.distanceKm).toBeNull();
    expect(home.body.cookingPlace).toBeNull(); // the kitchen address appears only after acceptance
    const stored = await svc
      .from("booking_addresses")
      .select("booking_id")
      .eq("booking_id", home.id);
    expect(stored.data).toEqual([]); // nothing about the customer's address is kept for chef's home
  });
});

describe("POST /api/bookings: refusals", () => {
  it("D-27: today is refused, the past is refused, tomorrow is fine", async () => {
    const chef = await bookableChef({ ticked: [0, 1, 2] });
    const c = await bookingCustomer();
    let r = await book(c, bookingBody(chef, { days: [dayBody(chef, 0)] }));
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "DATE_TOO_SOON",
    ]);
    expect(r.body.error.fields["days.0.date"]).toBeTruthy();
    r = await book(c, bookingBody(chef, { days: [dayBody(chef, -1)] }));
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "DATE_IN_PAST",
    ]);
    expect(await bookingCount(c.id)).toBe(0);
    r = await book(c, bookingBody(chef, { days: [dayBody(chef, 1)] }));
    expect(r.status, r.text).toBe(201);
  });

  it("reports every problem at once: 4 days, unticked date, beyond the window, unknown and foreign dish", async () => {
    const chef = await bookableChef({ ticked: [1, 2, 3] });
    const other = await bookableChef();
    const c = await bookingCustomer();
    let r = await book(
      c,
      bookingBody(chef, {
        days: [1, 2, 3, 4].map((o) => dayBody(chef, o)),
      }),
    );
    expect(r.status).toBe(422);
    const codes = (x: typeof r) =>
      x.body.error.issues.map((i: { code: string }) => i.code);
    expect(codes(r)).toEqual(
      expect.arrayContaining(["DAYS_COUNT", "CHEF_UNAVAILABLE"]),
    );
    r = await book(
      c,
      bookingBody(chef, {
        days: [
          { date: day(200), dishes: [{ dishId: chef.dishes.pho }] },
          { date: day(2), dishes: [{ dishId: other.dishes.pho }] },
          { date: day(3), dishes: [] },
        ],
      }),
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        "DATE_BEYOND_WINDOW",
        "DISH_NOT_FOUND",
        "NO_DISHES",
      ]),
    );
    expect(r.body.error.fields["days.1.dishes"]).toBeTruthy();
    expect(await bookingCount(c.id)).toBe(0);
  });

  it("a duplicate date and a duplicate dish are refused", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await book(
      c,
      bookingBody(chef, {
        days: [
          {
            date: day(3),
            dishes: [{ dishId: chef.dishes.pho }, { dishId: chef.dishes.pho }],
          },
          { date: day(3), dishes: [{ dishId: chef.dishes.pho }] },
        ],
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(["DATE_DUPLICATE", "DISH_DUPLICATE"]),
    );
  });

  it("over the 6 hour soft limit: remove dishes or split across days", async () => {
    const chef = await bookableChef({
      dishes: [{ key: "feast", minutes: 200 }],
    });
    const c = await bookingCustomer();
    let r = await book(
      c,
      bookingBody(chef, { days: [dayBody(chef, 3, "feast", 2)] }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.issues[0]).toMatchObject({
      code: "VISIT_TOO_LONG",
      dayIndex: 0,
    });
    expect(r.body.error.fields["days.0.dishes"]).toMatch(/split across days/);
    r = await book(
      c,
      bookingBody(chef, {
        days: [dayBody(chef, 3, "feast"), dayBody(chef, 4, "feast")],
      }),
    );
    expect(r.status, r.text).toBe(201);
  });

  it("the cooking address must be in the GTA and inside the chef's radius", async () => {
    const chef = await bookableChef({ prefix: "M5V", radius: 5 });
    const c = await bookingCustomer();
    let r = await book(c, bookingBody(chef));
    expect(r.status).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "OUTSIDE_SERVICE_AREA",
    ]);
    expect(r.body.error.fields["address.postalCode"]).toBeTruthy();
    r = await book(
      c,
      bookingBody(chef, {
        address: { line: "1 Far St", city: "Ottawa", postalCode: "K1A 0B1" },
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "POSTAL_NOT_GTA",
    ]);
    r = await book(
      c,
      bookingBody(chef, {
        address: { line: "1 Bad", city: "X", postalCode: "123" },
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.fields["address.postalCode"]).toBeTruthy();
    expect(await bookingCount(c.id)).toBe(0);
  });

  it("chef's home: refused when not offered, refused until the kitchen is enabled, fine when enabled", async () => {
    const c = await bookingCustomer();
    const none = await bookableChef({ options: ["customer_home"] });
    let r = await book(
      c,
      bookingBody(none, { locationType: "chef_home", address: undefined }),
    );
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "LOCATION_NOT_OFFERED",
    ]);
    const pending = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: false,
    });
    r = await book(
      c,
      bookingBody(pending, { locationType: "chef_home", address: undefined }),
    );
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "CHEF_HOME_NOT_ENABLED",
    ]);
    const ok = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    r = await book(
      c,
      bookingBody(ok, { locationType: "chef_home", address: undefined }),
    );
    expect(r.status, r.text).toBe(201);
    expect(r.body.locationType).toBe("chef_home");
  });

  it("shape errors: unknown keys alone, bad types with dotted keys, an address for chef's home", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const c = await bookingCustomer();
    let r = await book(c, {
      ...bookingBody(chef),
      customerId: "x",
      status: "accepted",
    });
    expect(r.status).toBe(422);
    expect(r.body.error.fields).toEqual({
      customerId: "Unknown field.",
      status: "Unknown field.",
    });
    r = await book(c, {
      chefId: "nope",
      locationType: "x",
      groceryOption: "y",
      days: "z",
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields)).toEqual(
      expect.arrayContaining([
        "chefId",
        "locationType",
        "groceryOption",
        "days",
      ]),
    );
    r = await book(c, bookingBody(chef, { locationType: "chef_home" }));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.address).toMatch(/chef's home/);
    r = await book(c, bookingBody(chef, { address: undefined }));
    expect(r.status).toBe(422);
    expect(r.body.error.fields.address).toBeTruthy();
    r = await c.b.call(createRoute, { raw: "{not json" });
    expect(r.status).toBe(400);
    r = await c.b.call(createRoute, {
      body: bookingBody(chef),
      contentType: "text/plain",
    });
    expect(r.status).toBe(400);
  });

  it("a hidden chef gets one identical 404: unknown, pending, rejected, no bio, only an unapproved kitchen", async () => {
    const c = await bookingCustomer();
    const good = await bookableChef();
    const hidden: TestChef[] = [
      await bookableChef({ status: "pending" }),
      await bookableChef({ status: "rejected" }),
      await bookableChef({ bio: null }),
      await bookableChef({ options: ["chef_home"], homeEnabled: false }),
    ];
    const replies = [];
    for (const h of hidden) replies.push(await book(c, bookingBody(h)));
    const unknown = await book(c, {
      ...bookingBody(good),
      chefId: "5f1c7f1e-0d6a-4c6a-9d3a-111111111111",
    });
    replies.push(unknown);
    for (const r of replies) {
      expect(r.status, r.text).toBe(404);
      expect(r.text).toBe(unknown.text);
    }
    expect(await bookingCount(c.id)).toBe(0);
  });

  it("a chef who is rejected after the page loaded cannot be booked (checked again at booking time)", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    await setChef(chef.id, { status: "rejected" });
    const r = await book(c, bookingBody(chef));
    expect(r.status).toBe(404);
  });
});

describe("intake form (D-23) and allergy conflicts", () => {
  it("blank allergies or dietary needs are refused; an explicit 'none' is accepted", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    for (const intake of [
      {},
      { noAllergies: true },
      { noDietaryNeeds: true },
      { allergyNotes: "  ", dietaryNotes: " " },
    ]) {
      const r = await book(c, bookingBody(chef, { intake }));
      expect(r.status, JSON.stringify(intake)).toBe(422);
      expect(
        Object.keys(r.body.error.fields).every((k) => k.startsWith("intake.")),
      ).toBe(true);
    }
    const none = await book(c, bookingBody(chef, { intake: undefined }));
    expect(none.status).toBe(422);
    expect(none.body.error.fields.intake).toBeTruthy();
    expect(await bookingCount(c.id)).toBe(0);
  });

  it("allergens come from the picker plus free text; unsafe or unknown input is refused", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    let r = await book(
      c,
      bookingBody(chef, {
        intake: { allergens: ["lava"], noDietaryNeeds: true },
      }),
    );
    expect(r.body.error.fields["intake.allergens"]).toBeTruthy();
    r = await book(
      c,
      bookingBody(chef, {
        intake: { allergyNotes: "bad\u0000text", noDietaryNeeds: true },
      }),
    );
    expect(r.body.error.fields["intake.allergyNotes"]).toMatch(/control/i);
    r = await book(
      c,
      bookingBody(chef, {
        intake: { noAllergies: true, allergens: ["soy"], noDietaryNeeds: true },
      }),
    );
    expect(r.body.error.fields["intake.noAllergies"]).toBeTruthy();
    r = await bookOk(
      c,
      bookingBody(chef, {
        intake: {
          allergens: ["fish", "sesame"],
          allergyNotes: "carries an EpiPen",
          dietaryNotes: "halal",
        },
      }),
    );
    expect(r.body.intake).toEqual({
      allergies: "fish, sesame, carries an EpiPen",
      dietaryNotes: "halal",
      allergyConflictAcknowledged: false,
    });
  });

  it("a conflict needs an acknowledgement; synonyms and the D-32 grain words count", async () => {
    const chef = await bookableChef({
      dishes: [
        { key: "satay", name: "Satay", allergens: ["peanuts"] },
        { key: "noodle", name: "Noodles", allergens: ["gluten"] },
        { key: "plain", name: "Plain rice", allergens: [] },
      ],
    });
    const c = await bookingCustomer();
    const days = (d: string, o: number) => [
      { date: day(o), dishes: [{ dishId: chef.dishes[d] }] },
    ];
    // peanuts vs a picked "tree nuts" allergen: the synonym map warns (D-24, D-30)
    let r = await book(
      c,
      bookingBody(chef, {
        days: days("satay", 3),
        intake: { allergens: ["tree nuts"], noDietaryNeeds: true },
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "ALLERGY_NOT_ACKNOWLEDGED",
    ]);
    expect(r.body.error.fields.allergyConflictAcknowledged).toBeTruthy();
    // barley written in the notes conflicts with a gluten dish (D-32)
    r = await book(
      c,
      bookingBody(chef, {
        days: days("noodle", 4),
        intake: { allergyNotes: "barley", noDietaryNeeds: true },
      }),
    );
    expect(r.body.error.issues.map((i: { code: string }) => i.code)).toEqual([
      "ALLERGY_NOT_ACKNOWLEDGED",
    ]);
    // acknowledged: created, and both parties can see the conflict
    const ok = await bookOk(
      c,
      bookingBody(chef, {
        days: days("satay", 3),
        intake: { allergens: ["tree nuts"], noDietaryNeeds: true },
        allergyConflictAcknowledged: true,
      }),
    );
    expect(ok.body.intake.allergyConflictAcknowledged).toBe(true);
    expect(ok.body.allergyConflicts).toEqual([
      { dishId: chef.dishes.satay, dishName: "Satay", allergens: ["peanuts"] },
    ]);
    const asChef = await getBooking(chef.b, ok.id);
    expect(asChef.body.allergyConflicts).toHaveLength(1);
    // no conflict: the flag is ignored and stored as false
    const noConflict = await bookOk(
      c,
      bookingBody(chef, {
        days: days("plain", 5),
        intake: { allergens: ["fish"], noDietaryNeeds: true },
        allergyConflictAcknowledged: true,
      }),
    );
    expect(noConflict.body.intake.allergyConflictAcknowledged).toBe(false);
  });
});

describe("who may book (T-057, section 2)", () => {
  it("needs a session, the customer role and a verified phone", async () => {
    const chef = await bookableChef();
    const body = bookingBody(chef);
    expect((await book({ b: new Browser() } as never, body)).status).toBe(401);
    expect((await book(chef, body)).status).toBe(403);
    const admin = await newAdmin();
    expect((await book(admin, body)).status).toBe(403);
    expect((await estimate(chef, body)).status).toBe(403);

    const noPhone = await bookingCustomer({ phone: false });
    let r = await book(noPhone, body);
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("PHONE_NOT_SUBMITTED");
    const unverified = await bookingCustomer({ verified: false });
    r = await book(unverified, body);
    expect(r.body.error.code).toBe("PHONE_NOT_VERIFIED");
    expect(await bookingCount(unverified.id)).toBe(0);
  });

  it("a customerId or status in the body is an unknown field, never a way to book for someone else", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    const r = await book(a, { ...bookingBody(chef), customerId: b.id });
    expect(r.status).toBe(422);
    expect(await bookingCount(b.id)).toBe(0);
  });
});

describe("double booking (section 10) and the open-request limit (D-28)", () => {
  it("a second customer on the same date gets 409 DOUBLE_BOOKED; other dates stay free", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    await bookOk(a, bookingBody(chef, { days: [dayBody(chef, 4)] }));
    const r = await book(
      b,
      bookingBody(chef, { days: [dayBody(chef, 4), dayBody(chef, 5)] }),
    );
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("DOUBLE_BOOKED");
    expect(r.body.error.issues).toEqual([
      expect.objectContaining({ code: "DOUBLE_BOOKED", dayIndex: 0 }),
    ]);
    expect(await bookingCount(b.id)).toBe(0);
    await bookOk(b, bookingBody(chef, { days: [dayBody(chef, 5)] }));
  });

  it("the same customer cannot take the same chef and date twice", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(a, bookingBody(chef, { days: [dayBody(chef, 4)] }));
    const r = await book(a, bookingBody(chef, { days: [dayBody(chef, 4)] }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("DOUBLE_BOOKED");
  });

  it("parallel requests for one chef and date: exactly one wins", async () => {
    const chef = await bookableChef();
    // Sign-ups run one after the other (the harness keeps one "current" cookie jar).
    const customers = [
      await bookingCustomer(),
      await bookingCustomer(),
      await bookingCustomer(),
    ];
    const replies = await Promise.all(
      customers.map((c) =>
        book(c, bookingBody(chef, { days: [dayBody(chef, 6)] })),
      ),
    );
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = replies.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(2);
    for (const l of losers) {
      expect(l.status, l.text).toBe(409);
      expect(l.body.error.code).toBe("DOUBLE_BOOKED");
    }
    const { data } = await svc
      .from("booking_days")
      .select("id")
      .eq("chef_id", chef.id)
      .eq("visit_date", day(6));
    expect(data).toHaveLength(1);
  });

  it("a declined request frees the date for the next customer", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    const first = await bookOk(
      a,
      bookingBody(chef, { days: [dayBody(chef, 4)] }),
    );
    expect(
      (await book(b, bookingBody(chef, { days: [dayBody(chef, 4)] }))).status,
    ).toBe(409);
    expect((await decline(chef.b, first.id)).status).toBe(200);
    await bookOk(b, bookingBody(chef, { days: [dayBody(chef, 4)] }));
  });

  it("D-28: at most 3 open requests; a 4th gets TOO_MANY_OPEN_REQUESTS; answered ones do not count", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const ids: string[] = [];
    for (const o of [3, 4, 5])
      ids.push(
        (await bookOk(c, bookingBody(chef, { days: [dayBody(chef, o)] }))).id,
      );
    const r = await book(c, bookingBody(chef, { days: [dayBody(chef, 6)] }));
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("TOO_MANY_OPEN_REQUESTS");
    expect(r.body.error.message).toMatch(/3/);
    expect(await bookingCount(c.id)).toBe(3);
    // The chef accepts one: it is no longer "requested", so the customer may ask again.
    expect((await accept(chef.b, ids[0])).status).toBe(200);
    await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 6)] }));
    expect(
      (await book(c, bookingBody(chef, { days: [dayBody(chef, 7)] }))).body
        .error.code,
    ).toBe("TOO_MANY_OPEN_REQUESTS");
  });

  it("D-28 is race-safe: five parallel requests from one customer create exactly three", async () => {
    const chefs = [];
    for (let i = 0; i < 5; i++) chefs.push(await bookableChef());
    const c = await bookingCustomer();
    const replies = await Promise.all(
      chefs.map((ch) => book(c, bookingBody(ch, { days: [dayBody(ch, 4)] }))),
    );
    expect(replies.filter((r) => r.status === 201)).toHaveLength(3);
    for (const r of replies.filter((x) => x.status !== 201)) {
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.code).toBe("TOO_MANY_OPEN_REQUESTS");
    }
    expect(await bookingCount(c.id)).toBe(3);
  });

  it("an expired request neither holds the date nor counts toward the limit", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    const old = await bookOk(
      a,
      bookingBody(chef, { days: [dayBody(chef, 4)] }),
    );
    await makeStale(old.id);
    await bookOk(b, bookingBody(chef, { days: [dayBody(chef, 4)] }));
    expect((await bookingRow(old.id)).status).toBe("expired");
  });
});

describe("free first booking (CLAUDE.md 6.6)", () => {
  it("useFreeTrial waives labour, sets is_free_trial together with the claim, and a second try leaves no booking", async () => {
    const chef = await bookableChef({
      dishes: [{ key: "pho", minutes: 120, cost: 2500 }],
    });
    const c = await bookingCustomer();
    const first = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    expect(first.body.isFreeTrial).toBe(true);
    expect(first.body.estimate).toMatchObject({
      labourCents: 0,
      ingredientsCents: 2500,
      totalCents: 2500,
      platformFeeCents: 0,
    });
    expect((await bookingRow(first.id)).is_free_trial).toBe(true);
    expect((await claimOf(first.id))?.state).toBe("held");

    const before = await bookingCount(c.id);
    const r = await book(
      c,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("FREE_TRIAL_USED");
    expect(r.text).not.toMatch(/phone|address|hash|account/i);
    // The whole request was rolled back: no booking, no days, no address, no claim for it.
    expect(await bookingCount(c.id)).toBe(before);
    const days = await svc
      .from("booking_days")
      .select("id")
      .eq("chef_id", chef.id)
      .eq("visit_date", day(5));
    expect(days.data).toEqual([]);
    // Full price is still possible.
    const full = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: false }),
    );
    expect(full.body.isFreeTrial).toBe(false);
    expect(full.body.estimate.labourCents).toBe(6000);
    expect(await claimOf(full.id)).toBeNull();
    const blocks = await svc
      .from("free_trial_blocks")
      .select("reason, attempts")
      .eq("customer_id", c.id);
    expect(blocks.data).toEqual([{ reason: "customer", attempts: 1 }]);
  });

  it("the same address under another account is blocked without saying why", async () => {
    const chef = await bookableChef();
    const a = await bookingCustomer();
    await bookOk(
      a,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    // A new account with its own phone and the same home address written differently.
    const b = await bookingCustomer({ address: false });
    const { PUT } = await import("@/app/api/me/address/route");
    const put = await b.b.call(PUT, {
      method: "PUT",
      body: {
        line: a.line.toLowerCase().replace("street", "st."),
        city: "Mississauga",
        postalCode: "l5b1a1",
      },
    });
    expect(put.status, put.text).toBe(200);
    const r = await book(
      b,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("FREE_TRIAL_USED");
    const blocks = await svc
      .from("free_trial_blocks")
      .select("reason")
      .eq("customer_id", b.id);
    expect(blocks.data).toEqual([{ reason: "address" }]);
    expect(await bookingCount(b.id)).toBe(0);
  });

  it("without a saved home address the trial cannot be used (409 ADDRESS_NOT_SET); normal booking still works", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer({ address: false });
    const r = await book(c, bookingBody(chef, { useFreeTrial: true }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("ADDRESS_NOT_SET");
    expect(await bookingCount(c.id)).toBe(0);
    await bookOk(c, bookingBody(chef));
  });

  it("A-16: declining releases the claim, so the customer can use the trial again", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const first = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    const d = await decline(chef.b, first.id, { reason: "Sorry, I am away." });
    expect(d.status, d.text).toBe(200);
    expect((await claimOf(first.id))?.state).toBe("released");
    const again = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 5)], useFreeTrial: true }),
    );
    expect(again.body.isFreeTrial).toBe(true);
  });

  it("accepting keeps the claim held", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const first = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    expect((await accept(chef.b, first.id)).status).toBe(200);
    expect((await claimOf(first.id))?.state).toBe("held");
    const r = await book(
      c,
      bookingBody(chef, { days: [dayBody(chef, 6)], useFreeTrial: true }),
    );
    expect(r.body.error.code).toBe("FREE_TRIAL_USED");
  });

  it("parallel requests with the trial from one customer: exactly one claim, the others roll back", async () => {
    const chefs = [];
    for (let i = 0; i < 3; i++) chefs.push(await bookableChef());
    const c = await bookingCustomer();
    const replies = await Promise.all(
      chefs.map((ch) =>
        book(
          c,
          bookingBody(ch, { days: [dayBody(ch, 4)], useFreeTrial: true }),
        ),
      ),
    );
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of replies.filter((x) => x.status !== 201)) {
      expect(r.status, r.text).toBe(409);
      expect(r.body.error.code).toBe("FREE_TRIAL_USED");
    }
    expect(await bookingCount(c.id)).toBe(1);
    const claims = await svc
      .from("free_trial_claims")
      .select("id")
      .eq("customer_id", c.id);
    expect(claims.data).toHaveLength(1);
  });
});

describe("POST /api/bookings/estimate", () => {
  it("returns the estimate, the trial answer and the expiry without creating anything", async () => {
    const chef = await bookableChef({
      dishes: [{ key: "pho", minutes: 120, cost: 2500 }],
    });
    const c = await bookingCustomer();
    const r = await estimate(
      c,
      bookingBody(chef, { days: [dayBody(chef, 1)], useFreeTrial: true }),
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      issues: [],
      allergyConflicts: [],
      freeTrial: { eligible: true, blocker: null },
      today: today(),
      firstBookableDay: day(1),
      wouldExpireAt: torontoStartOfDay(day(1)).toISOString(),
    });
    expect(r.body.estimate).toMatchObject({
      cookMinutes: 120,
      labourBeforeWaiverCents: 6000,
      freeTrialWaivedCents: 6000,
      labourCents: 0,
      ingredientsCents: 2500,
      totalCents: 2500,
      platformFeeCollected: false,
      exceedsSoftLimit: false,
    });
    expect(r.body.estimate.days).toEqual([
      expect.objectContaining({
        date: day(1),
        cookMinutes: 120,
        labourCents: 0,
        ingredientsCents: 2500,
      }),
    ]);
    expect(await bookingCount(c.id)).toBe(0);
    const claims = await svc
      .from("free_trial_claims")
      .select("id")
      .eq("customer_id", c.id);
    expect(claims.data).toEqual([]);
  });

  it("lists every issue with a 200: today, over 6 hours, missing intake, hidden chef", async () => {
    const chef = await bookableChef({ dishes: [{ key: "pho", minutes: 300 }] });
    const c = await bookingCustomer();
    let r = await estimate(c, {
      ...bookingBody(chef, { days: [dayBody(chef, 0, "pho", 2)] }),
      intake: undefined,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining([
        "DATE_TOO_SOON",
        "VISIT_TOO_LONG",
        "INTAKE_MISSING",
      ]),
    );
    expect(r.body.estimate.exceedsSoftLimit).toBe(true);
    const pending = await bookableChef({ status: "pending" });
    r = await estimate(c, bookingBody(pending));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.issues.map((i: { code: string }) => i.code)).toEqual([
      "CHEF_NOT_BOOKABLE",
    ]);
    expect(r.body.estimate).toBeNull();
  });

  it("an allergy conflict is listed and ok stays false until acknowledged; the trial blocker is named", async () => {
    const chef = await bookableChef({
      dishes: [{ key: "satay", name: "Satay", allergens: ["peanuts"] }],
    });
    const c = await bookingCustomer({ verified: false, address: false });
    const r = await estimate(
      c,
      bookingBody(chef, {
        intake: { allergens: ["peanuts"], noDietaryNeeds: true },
      }),
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.allergyConflicts).toEqual([
      { dishId: chef.dishes.satay, dishName: "Satay", allergens: ["peanuts"] },
    ]);
    expect(r.body.freeTrial).toEqual({
      eligible: false,
      blocker: "PHONE_NOT_VERIFIED",
    });
    const acked = await estimate(
      c,
      bookingBody(chef, {
        intake: { allergens: ["peanuts"], noDietaryNeeds: true },
        allergyConflictAcknowledged: true,
      }),
    );
    expect(acked.body.ok).toBe(true);
  });

  it("an incomplete intake is not an error while estimating", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await estimate(
      c,
      bookingBody(chef, { intake: { noAllergies: true } }),
    );
    expect(r.status).toBe(200);
    expect(r.body.issues.map((i: { code: string }) => i.code)).toEqual([
      "INTAKE_MISSING",
    ]);
    expect(r.body.estimate).not.toBeNull();
  });
});

describe("accept and decline", () => {
  it("the chef sees the intake before answering; the address and phones appear only after accepting", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, {
        intake: { allergens: ["fish"], dietaryNotes: "no pork" },
      }),
    );
    const asChef = await getBooking(chef.b, r.id);
    expect(asChef.status, asChef.text).toBe(200);
    expect(asChef.body.viewerRole).toBe("chef");
    expect(asChef.body.intake).toMatchObject({
      allergies: "fish",
      dietaryNotes: "no pork",
    });
    expect(asChef.body.cookingPlace).toBeNull();
    expect(asChef.body.contact).toBeNull();
    expect(asChef.text).not.toContain("Cooking Street");
    expect(asChef.text).not.toContain(c.phone);
    const asCustomer = await getBooking(c.b, r.id);
    expect(asCustomer.body.contact).toBeNull();
    expect(asCustomer.body.cookingPlace).toMatchObject({
      line: "100 Cooking Street",
    });

    const a = await accept(chef.b, r.id);
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe("accepted");
    expect(a.body.respondedAt).toBeTruthy();
    expect(a.body.cookingPlace).toMatchObject({
      line: "100 Cooking Street",
      postalCode: "L5B1A1",
    });
    expect(a.body.contact).toEqual({
      displayName: "Booking Customer",
      phone: c.phone,
    });
    const after = await getBooking(c.b, r.id);
    expect(after.body.contact).toMatchObject({
      phone: expect.stringMatching(/^\+1\d{10}$/),
    });
    expect(after.body.contact.displayName).toContain("Booking Chef");
    const notes = await notesFor(c.id, "booking_accepted");
    expect(notes).toHaveLength(1);
  });

  it("chef's home: the customer gets the kitchen address only after acceptance", async () => {
    const chef = await bookableChef({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    await svc
      .from("chef_private")
      .update({
        kitchen_address_line: "9 Kitchen Lane",
        kitchen_city: "Mississauga",
        kitchen_postal_code: "L5B1A1",
      })
      .eq("chef_id", chef.id);
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, { locationType: "chef_home", address: undefined }),
    );
    const before = await getBooking(c.b, r.id);
    expect(before.body.cookingPlace).toBeNull();
    expect(before.text).not.toContain("Kitchen Lane");
    await accept(chef.b, r.id);
    const after = await getBooking(c.b, r.id);
    expect(after.body.cookingPlace).toEqual({
      line: "9 Kitchen Lane",
      city: "Mississauga",
      postalCode: "L5B1A1",
    });
    const asChef = await getBooking(chef.b, r.id);
    expect(asChef.body.cookingPlace).toBeNull(); // their own kitchen
    expect(asChef.body.contact).toMatchObject({ phone: c.phone });
  });

  it("decline: reason saved, customer notified, dates freed; no second answer", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    const bad = await decline(chef.b, r.id, { reason: "x" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.reason).toBeTruthy();
    expect(
      (await decline(chef.b, r.id, { reason: "ok", extra: 1 })).status,
    ).toBe(422);
    expect((await bookingRow(r.id)).status).toBe("requested");
    const d = await decline(chef.b, r.id, {
      reason: "I am travelling that week.",
    });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({
      status: "declined",
      declineReason: "I am travelling that week.",
    });
    expect(d.body.contact).toBeNull();
    const notes = await notesFor(c.id, "booking_declined");
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("I am travelling that week.");
    const days = await svc
      .from("booking_days")
      .select("is_active")
      .eq("booking_id", r.id);
    expect(days.data).toEqual([{ is_active: false }]);
    for (const again of [
      await accept(chef.b, r.id),
      await decline(chef.b, r.id),
    ]) {
      expect(again.status, again.text).toBe(409);
      expect(again.body.error.code).toBe("INVALID_STATE");
    }
  });

  it("D-34: a decline reason is required; blank, missing and contact details are refused", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r1 = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 3)] }));
    for (const body of [
      {},
      { reason: "" },
      { reason: "   " },
      { reason: null },
      { reason: 5 },
    ]) {
      const d = await decline(chef.b, r1.id, body);
      expect(d.status, JSON.stringify(body)).toBe(422);
      expect(d.body.error.code).toBe("VALIDATION_FAILED");
      expect(d.body.error.fields.reason).toBeTruthy();
    }
    for (const reason of [
      "call me 416-555-0199",
      "mail me@example.com",
      "see www.example.com/x",
    ]) {
      const d = await decline(chef.b, r1.id, { reason });
      expect(d.status, reason).toBe(422);
      expect(d.body.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
      expect(d.body.error.fields.reason).toBeTruthy();
    }
    expect((await bookingRow(r1.id)).status).toBe("requested");
    expect((await notesFor(c.id, "booking_declined")).length).toBe(0);
    const ok = await decline(chef.b, r1.id, {
      reason: "Fully booked on 2026-10-20.",
    });
    expect(ok.status, ok.text).toBe(200);
    const r2 = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 4)] }));
    expect((await accept(chef.b, r2.id)).status).toBe(200);
    expect((await accept(chef.b, r2.id)).body.error.code).toBe("INVALID_STATE");
  });

  it("parallel accept and decline: exactly one wins and the claim follows the winner", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef, { useFreeTrial: true }));
    const [a, d] = await Promise.all([
      accept(chef.b, r.id),
      decline(chef.b, r.id),
    ]);
    expect([a.status, d.status].sort()).toEqual([200, 409]);
    const row = await bookingRow(r.id);
    expect(row.status).toBe(a.status === 200 ? "accepted" : "declined");
    expect((await claimOf(r.id))?.state).toBe(
      row.status === "accepted" ? "held" : "released",
    );
  });

  it("only the booking's chef may answer: others get the same 404; a customer and an admin get 403", async () => {
    const chef = await bookableChef();
    const other = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    const missing = await accept(
      chef.b,
      "5f1c7f1e-0d6a-4c6a-9d3a-222222222222",
    );
    expect(missing.status).toBe(404);
    for (const x of [
      await accept(other.b, r.id),
      await decline(other.b, r.id),
      await accept(chef.b, "not-a-uuid"),
    ]) {
      expect(x.status, x.text).toBe(404);
      expect(x.text).toBe(missing.text);
    }
    // An invalid body on someone else's booking is still the same 404.
    expect(
      (await decline(other.b, r.id, { reason: "x", junk: 1 })).status,
    ).toBe(404);
    expect((await accept(c.b, r.id)).status).toBe(403);
    expect((await decline(c.b, r.id)).status).toBe(403);
    const admin = await newAdmin();
    expect((await accept(admin.b, r.id)).status).toBe(403);
    expect((await accept(new Browser(), r.id)).status).toBe(401);
    expect((await bookingRow(r.id)).status).toBe("requested");
  });

  it("an expired request cannot be accepted: 409 REQUEST_EXPIRED, the booking is expired, the date and the trial are free", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
    await makeStale(r.id);
    const a = await accept(chef.b, r.id);
    expect(a.status, a.text).toBe(409);
    expect(a.body.error.code).toBe("REQUEST_EXPIRED");
    expect((await bookingRow(r.id)).status).toBe("expired");
    expect((await claimOf(r.id))?.state).toBe("released");
    expect((await notesFor(c.id, "booking_expired")).length).toBe(1);
    expect((await notesFor(chef.id, "booking_expired")).length).toBe(1);
    const days = await svc
      .from("booking_days")
      .select("is_active")
      .eq("booking_id", r.id);
    expect(days.data).toEqual([{ is_active: false }]);
    const again = await accept(chef.b, r.id);
    expect(again.body.error.code).toBe("INVALID_STATE");
    // The trial is available again.
    await bookOk(
      c,
      bookingBody(chef, { days: [dayBody(chef, 4)], useFreeTrial: true }),
    );
  });
});

describe("reading bookings", () => {
  it("only the two parties see a booking; everyone else gets the same 404", async () => {
    const chef = await bookableChef();
    const other = await bookableChef();
    const c = await bookingCustomer();
    const stranger = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef));
    const missing = await getBooking(
      c.b,
      "5f1c7f1e-0d6a-4c6a-9d3a-333333333333",
    );
    expect(missing.status).toBe(404);
    for (const who of [stranger.b, other.b]) {
      const x = await getBooking(who, r.id);
      expect(x.status).toBe(404);
      expect(x.text).toBe(missing.text);
    }
    expect((await getBooking(c.b, "nope")).status).toBe(404);
    expect((await getBooking(new Browser(), r.id)).status).toBe(401);
    const admin = await newAdmin();
    expect((await getBooking(admin.b, r.id)).status).toBe(403);
    expect((await getBooking(chef.b, r.id)).status).toBe(200);
    expect((await getBooking(c.b, r.id)).status).toBe(200);
  });

  it("lists only the caller's own bookings, newest first, with paging and a status filter", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const stranger = await bookingCustomer();
    const ids: string[] = [];
    for (const o of [3, 4, 5])
      ids.push(
        (await bookOk(c, bookingBody(chef, { days: [dayBody(chef, o)] }))).id,
      );
    await bookOk(stranger, bookingBody(chef, { days: [dayBody(chef, 8)] }));
    await accept(chef.b, ids[1]);

    const all = await listBookings(c.b);
    expect(all.status, all.text).toBe(200);
    expect(all.body.items.map((i: { id: string }) => i.id)).toEqual(
      [...ids].reverse(),
    );
    expect(all.body.nextCursor).toBeNull();
    expect(all.body.items[0]).toMatchObject({
      status: "requested",
      locationType: "customer_home",
      firstDay: day(5),
      dates: [day(5)],
      totalCents: 6000,
      counterparty: { id: chef.id },
    });
    expect(all.text).not.toContain("Cooking Street");

    const p1 = await listBookings(c.b, "limit=2");
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await listBookings(c.b, `limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
    expect(p2.body.nextCursor).toBeNull();

    const open = await listBookings(c.b, "status=accepted");
    expect(open.body.items.map((i: { id: string }) => i.id)).toEqual([ids[1]]);
    expect((await listBookings(c.b, "status=open")).body.items).toHaveLength(3);
    expect((await listBookings(c.b, "status=declined")).body.items).toEqual([]);

    // The chef sees theirs (all four, from two customers) with the customer as counterparty.
    const asChef = await listBookings(chef.b);
    expect(asChef.body.items).toHaveLength(4);
    expect(asChef.body.items[0].counterparty.displayName).toBe(
      "Booking Customer",
    );
    expect((await listBookings(stranger.b)).body.items).toHaveLength(1);
  });

  it("rejects bad list queries and refuses anonymous callers and admins", async () => {
    const c = await bookingCustomer();
    const r = await listBookings(c.b, "status=x&limit=0&cursor=zzz");
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual([
      "cursor",
      "limit",
      "status",
    ]);
    expect((await listBookings(c.b, "status=a&status=b")).status).toBe(422);
    expect((await listBookings(new Browser())).status).toBe(401);
    const admin = await newAdmin();
    expect((await listBookings(admin.b)).status).toBe(403);
  });

  it("listing expires stale requests first", async () => {
    const chef = await bookableChef();
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef, { useFreeTrial: true }));
    await makeStale(r.id);
    const l = await listBookings(c.b);
    expect(l.body.items[0]).toMatchObject({ id: r.id, status: "expired" });
    expect((await claimOf(r.id))?.state).toBe("released");
  });
});

describe("booked dates in public data (A-19, D-27, D-22)", () => {
  it("a booked date leaves bookableDates and the search date filter; today never shows", async () => {
    const tag = `Bk${Math.random().toString(36).slice(2, 8)}`;
    const chef = await bookableChef({ ticked: [0, 1, 2, 3], cuisine: tag });
    const c = await bookingCustomer();
    const anon = new Browser();
    let d = await (
      await import("./booking-helpers")
    ).publicDetail(anon, chef.id);
    expect(d.status, d.text).toBe(200);
    expect(d.body.bookableDates).toEqual([day(1), day(2), day(3)]);
    expect(d.body.firstBookableDay).toBe(day(1));
    const { publicSearch } = await import("./booking-helpers");
    const has = async (date: string) =>
      (
        (await publicSearch(anon, `date=${date}&cuisine=${tag}`)).body
          .items as { id: string }[]
      ).some((i) => i.id === chef.id);
    expect(await has(day(2))).toBe(true);
    const r = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 2)] }));
    d = await (await import("./booking-helpers")).publicDetail(anon, chef.id);
    expect(d.body.bookableDates).toEqual([day(1), day(3)]);
    expect(await has(day(2))).toBe(false);
    expect(await has(day(3))).toBe(true);
    // The public page says that the date is taken, not who took it.
    expect(JSON.stringify(d.body)).not.toContain(c.id);
    // Declining brings the date back.
    await decline(chef.b, r.id);
    d = await (await import("./booking-helpers")).publicDetail(anon, chef.id);
    expect(d.body.bookableDates).toEqual([day(1), day(2), day(3)]);
    expect(await has(day(2))).toBe(true);
    // Searching for today is refused (D-27).
    const t = await publicSearch(anon, `date=${today()}`);
    expect(t.status).toBe(422);
  });

  it("an expired request that nobody has swept yet does not hide the date", async () => {
    const chef = await bookableChef({ ticked: [2, 3] });
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 2)] }));
    await makeStale(r.id);
    const { publicDetail } = await import("./booking-helpers");
    const d = await publicDetail(new Browser(), chef.id);
    expect(d.body.bookableDates).toEqual([day(2), day(3)]);
    expect((await bookingRow(r.id)).status).toBe("requested"); // public reads never write
  });

  it("D-22: a chef cannot clear a booked date (409 DATE_BOOKED), nothing else in the request is saved", async () => {
    const chef = await bookableChef({ ticked: [2, 3, 4] });
    const c = await bookingCustomer();
    const r = await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 3)] }));
    const { putAvailability } = await import("./dish-helpers");
    const put = (body: object) =>
      chef.b.call(putAvailability, { method: "PUT", body });
    let x = await put({ remove: [day(3), day(4)], add: [day(10)] });
    expect(x.status, x.text).toBe(409);
    expect(x.body.error.code).toBe("DATE_BOOKED");
    expect(x.body.error.dates).toEqual([day(3)]);
    const days = await svc
      .from("availability")
      .select("day")
      .eq("chef_id", chef.id)
      .order("day");
    expect((days.data ?? []).map((v) => v.day)).toEqual([
      day(2),
      day(3),
      day(4),
    ]); // day 4 and day 10 untouched
    // An accepted booking blocks too.
    await accept(chef.b, r.id);
    x = await put({ remove: [day(3)] });
    expect(x.status).toBe(409);
    // A free date can be cleared.
    x = await put({ remove: [day(4)] });
    expect(x.status, x.text).toBe(200);
    expect(x.body.days).not.toContain(day(4));
  });

  it("a declined or expired booking no longer blocks clearing the date", async () => {
    const chef = await bookableChef({ ticked: [2, 3] });
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    const r1 = await bookOk(a, bookingBody(chef, { days: [dayBody(chef, 2)] }));
    const r2 = await bookOk(b, bookingBody(chef, { days: [dayBody(chef, 3)] }));
    await decline(chef.b, r1.id);
    await makeStale(r2.id); // expired but not swept: the route sweeps first
    const { putAvailability } = await import("./dish-helpers");
    const x = await chef.b.call(putAvailability, {
      method: "PUT",
      body: { remove: [day(2), day(3)] },
    });
    expect(x.status, x.text).toBe(200);
    expect(x.body.days).toEqual([]);
  });

  it("clearing a date while it is being booked: either the booking or the clear wins, never both", async () => {
    const chef = await bookableChef({ ticked: [2] });
    const c = await bookingCustomer();
    const { putAvailability } = await import("./dish-helpers");
    const [booked, cleared] = await Promise.all([
      book(c, bookingBody(chef, { days: [dayBody(chef, 2)] })),
      chef.b.call(putAvailability, {
        method: "PUT",
        body: { remove: [day(2)] },
      }),
    ]);
    const avail = await svc
      .from("availability")
      .select("day")
      .eq("chef_id", chef.id);
    const rows = await svc
      .from("booking_days")
      .select("id")
      .eq("chef_id", chef.id);
    if (booked.status === 201) {
      expect(cleared.status, cleared.text).toBe(409);
      expect(avail.data).toHaveLength(1);
      expect(rows.data).toHaveLength(1);
    } else {
      expect(booked.status, booked.text).toBe(422);
      expect(booked.body.error.issues[0].code).toBe("CHEF_UNAVAILABLE");
      expect(cleared.status).toBe(200);
      expect(rows.data).toEqual([]);
    }
  });
});

describe("search avoidAllergens uses the booking synonym map (D-31)", () => {
  it("avoiding gluten hides a chef whose only dish lists wheat; avoiding it keeps a chef with a free dish", async () => {
    const tag = `Bk${Math.random().toString(36).slice(2, 8)}`;
    const wheat = await bookableChef({
      cuisine: tag,
      dishes: [{ key: "a", allergens: ["wheat"] }],
    });
    const mixed = await bookableChef({
      cuisine: tag,
      dishes: [
        { key: "a", allergens: ["barley"] },
        { key: "b", allergens: [] },
      ],
    });
    const { publicSearch } = await import("./booking-helpers");
    const r = await publicSearch(
      new Browser(),
      `avoidAllergens=gluten&cuisine=${tag}`,
    );
    const ids = (r.body.items as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain(wheat.id);
    expect(ids).toContain(mixed.id);
  });
});

describe("public date helpers are limited to the public window (review finding 1)", () => {
  it("a rejected chef's booked dates and a booking outside the window are not public", async () => {
    const chef = await bookableChef({ ticked: [3] });
    const c = await bookingCustomer();
    await bookOk(c, bookingBody(chef, { days: [dayBody(chef, 3)] }));
    const { publicSearch } = await import("./booking-helpers");
    const anon = new Browser();
    expect((await publicSearch(anon, `date=${day(3)}`)).status).toBe(200);
    await setChef(chef.id, { status: "rejected" });
    const { publicDetail } = await import("./booking-helpers");
    expect((await publicDetail(anon, chef.id)).status).toBe(404);
    const r = await svc.rpc("chef_booked_dates", {
      p_chef: chef.id,
      p_from: day(1),
      p_to: day(30),
    });
    expect(r.data).toEqual([]); // no helper answers for a rejected chef
  });
});
