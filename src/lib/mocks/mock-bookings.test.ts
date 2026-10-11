import { describe, expect, it } from "vitest";
import type {
  ApiError,
  BookingDetail,
  BookingEstimateResponse,
  BookingRequestBody,
} from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import {
  bookingRoutes,
  hideHeldDates,
  sweepMock,
  viewOf,
  type BookingMockState,
} from "@/lib/mocks/mock-bookings";
import { MOCK_CHEFS } from "@/lib/mocks/mock-search";

const MAI = MOCK_CHEFS[0]; // both locations, 4 dishes, L5B, 25 km
const LINH = MOCK_CHEFS[1]; // customer's home only
const PHO = MAI.dishes[0]; // 180 min
const ROLLS = MAI.dishes[1]; // 60 min
const NOW = new Date();
const TODAY = torontoToday(NOW);
const D1 = addDays(TODAY, 3);
const D2 = addDays(TODAY, 4);
const D3 = addDays(TODAY, 5);

const state = (over: Partial<BookingMockState> = {}): BookingMockState => ({
  profile: {
    id: "mock-user-1",
    role: "customer",
    displayName: "Sam",
    country: "CA",
    currency: "CAD",
    language: "en",
  },
  phone: "+1******0123",
  phoneVerified: true,
  address: { line: "1 Main St", city: "Mississauga", postalCode: "L5B1M2" },
  bookings: [],
  hooks: {},
  ...over,
});

const body = (over: Partial<BookingRequestBody> = {}): BookingRequestBody => ({
  chefId: MAI.id,
  locationType: "customer_home",
  address: { line: "100 Main St", city: "Mississauga", postalCode: "L5B 1A1" },
  days: [{ date: D1, dishes: [{ dishId: PHO.id, quantity: 1 }] }],
  groceryOption: "customer_buys",
  intake: { noAllergies: true, noDietaryNeeds: true },
  useFreeTrial: true,
  ...over,
});

const call = (
  method: string,
  path: string,
  b: unknown,
  s: BookingMockState,
  now = NOW,
) => bookingRoutes(method, path, b, s, now)!;
const err = async (r: { res: Response }) =>
  ((await r.res.json()) as ApiError).error;

/** Creates a booking and returns the new state plus the detail. */
async function create(s: BookingMockState, b = body()) {
  const r = call("POST", "/api/bookings", b, s);
  expect(r.res.status, await r.res.clone().text()).toBe(201);
  return {
    s: { ...s, ...r.next } as BookingMockState,
    detail: (await r.res.json()) as BookingDetail,
  };
}

describe("routing", () => {
  it("ignores paths that are not booking routes", () => {
    expect(bookingRoutes("GET", "/api/me", {}, state())).toBeNull();
    expect(bookingRoutes("GET", "/api/chefs", {}, state())).toBeNull();
  });
  it("is customer only", async () => {
    const r = call(
      "GET",
      "/api/bookings",
      {},
      state({ profile: { ...state().profile!, role: "chef" } }),
    );
    expect(r.res.status).toBe(403);
  });
  it("answers 404 for the chef routes it cannot mock", async () => {
    const r = call("POST", `/api/bookings/${MAI.id}/accept`, {}, state());
    expect(r.res.status).toBe(404);
  });
});

describe("estimate", () => {
  it("prices one day at the customer's home with the free trial waiving labour only", async () => {
    const r = call(
      "POST",
      "/api/bookings/estimate",
      body({
        address: {
          line: "1 Elm St",
          city: "Mississauga",
          postalCode: "L5N 1A1",
        },
      }),
      state(),
    );
    const e = (await r.res.json()) as BookingEstimateResponse;
    expect(e.ok).toBe(true);
    expect(e.freeTrial).toEqual({ eligible: true, blocker: null });
    expect(e.estimate).toMatchObject({
      cookMinutes: 180,
      labourCents: 0,
      freeTrialWaivedCents: 8400, // 3 h x $28
      ingredientsCents: PHO.ingredientCostCents,
      platformFeeCollected: false,
    });
    expect(e.estimate!.travelCents).toBeGreaterThan(0);
    expect(e.firstBookableDay).toBe(addDays(TODAY, 1));
    expect(e.wouldExpireAt).toBeTruthy();
  });
  it("has no travel fee at the chef's home and prices labour without the trial", async () => {
    const r = call(
      "POST",
      "/api/bookings/estimate",
      body({
        locationType: "chef_home",
        address: undefined,
        useFreeTrial: false,
      }),
      state(),
    );
    const e = (await r.res.json()) as BookingEstimateResponse;
    expect(e.ok).toBe(true);
    expect(e.estimate).toMatchObject({
      travelCents: 0,
      labourCents: 8400,
      distanceKm: null,
    });
  });
  it("lists issues in a 200: today, a day over 6 hours, outside the service area", async () => {
    const r = call(
      "POST",
      "/api/bookings/estimate",
      body({
        days: [{ date: TODAY, dishes: [{ dishId: PHO.id, quantity: 3 }] }],
        address: { line: "1 Far St", city: "Markham", postalCode: "L3R 1A1" },
      }),
      state(),
    );
    const e = (await r.res.json()) as BookingEstimateResponse;
    expect(e.ok).toBe(false);
    const codes = e.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DATE_TOO_SOON",
        "OUTSIDE_SERVICE_AREA",
        "VISIT_TOO_LONG",
      ]),
    );
    expect(e.estimate?.exceedsSoftLimit).toBe(true);
  });
  it("reports why the free trial is not available", async () => {
    const r = call(
      "POST",
      "/api/bookings/estimate",
      body(),
      state({ phoneVerified: false }),
    );
    expect(
      ((await r.res.json()) as BookingEstimateResponse).freeTrial.blocker,
    ).toBe("PHONE_NOT_VERIFIED");
  });
  it("a missing intake is an issue, not a 422", async () => {
    const b = body();
    delete b.intake;
    const e = (await call(
      "POST",
      "/api/bookings/estimate",
      b,
      state(),
    ).res.json()) as BookingEstimateResponse;
    expect(e.ok).toBe(false);
    expect(e.issues.map((i) => i.code)).toContain("INTAKE_MISSING");
  });
  it("422 for unknown keys", async () => {
    const r = call(
      "POST",
      "/api/bookings/estimate",
      { ...body(), customerId: "x" },
      state(),
    );
    expect(r.res.status).toBe(422);
    expect((await err(r)).fields).toEqual({ customerId: "Unknown field." });
  });
});

describe("create", () => {
  it("creates a requested, free-trial booking with an expiry and no chef address yet", async () => {
    const { detail } = await create(
      state(),
      body({
        locationType: "chef_home",
        address: undefined,
      }),
    );
    expect(detail.status).toBe("requested");
    expect(detail.isFreeTrial).toBe(true);
    expect(detail.payment).toEqual({ mock: true, collected: false });
    expect(detail.expiresAt).toBeTruthy();
    expect(detail.cookingPlace).toBeNull(); // chef's kitchen: after acceptance only
    expect(detail.contact).toBeNull();
    expect(detail.days[0].dishes[0]).toMatchObject({
      name: PHO.name,
      eatByDate: addDays(D1, 2),
    });
    expect(detail.days[0].pickupDeadlineDate).toBe(addDays(D1, 2));
    expect(detail.estimate.labourCents).toBe(0);
  });
  it("shows the customer's own cooking address, and no phone before acceptance", async () => {
    const { detail } = await create(state());
    expect(detail.cookingPlace).toEqual({
      line: "100 Main St",
      city: "Mississauga",
      postalCode: "L5B1A1",
    });
    expect(detail.contact).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("+1416");
  });
  it("shows the kitchen and the chef's phone once accepted", async () => {
    const { s, detail } = await create(
      state(),
      body({ locationType: "chef_home", address: undefined }),
    );
    const row = {
      ...s.bookings[0],
      detail: { ...detail, status: "accepted" as const },
    };
    const v = viewOf(row);
    expect(v.cookingPlace?.line).toContain("Kitchen");
    expect(v.contact?.phone).toBe("+14165550100");
  });
  it("needs a verified phone", async () => {
    const r = call(
      "POST",
      "/api/bookings",
      body(),
      state({ phoneVerified: false }),
    );
    expect(r.res.status).toBe(409);
    expect((await err(r)).code).toBe("PHONE_NOT_VERIFIED");
    const r2 = call("POST", "/api/bookings", body(), state({ phone: null }));
    expect((await err(r2)).code).toBe("PHONE_NOT_SUBMITTED");
  });
  it("a hidden chef and a bad id are the same 404", async () => {
    const r = call(
      "POST",
      "/api/bookings",
      body({ chefId: "00000000-0000-4000-8000-000000009999" }),
      state(),
    );
    expect(r.res.status).toBe(404);
  });
  it("422 with field keys and issues; chef's home not offered", async () => {
    const r = call(
      "POST",
      "/api/bookings",
      body({ chefId: LINH.id, locationType: "chef_home", address: undefined }),
      state(),
    );
    expect(r.res.status).toBe(422);
    const e = await err(r);
    expect(e.fields?.locationType).toBeTruthy();
    expect(e.issues?.map((i) => i.code)).toContain("LOCATION_NOT_OFFERED");
  });
  it("422 for an allergy conflict that is not acknowledged, and 201 when it is", async () => {
    const withAllergy = body({
      intake: { allergens: ["soy"], noDietaryNeeds: true },
    });
    const r = call("POST", "/api/bookings", withAllergy, state());
    expect(r.res.status).toBe(422);
    expect((await err(r)).fields?.allergyConflictAcknowledged).toBeTruthy();
    const { detail } = await create(state(), {
      ...withAllergy,
      allergyConflictAcknowledged: true,
    });
    expect(detail.allergyConflicts[0]).toMatchObject({
      dishName: PHO.name,
      allergens: ["soy"],
    });
    expect(detail.intake.allergyConflictAcknowledged).toBe(true);
    expect(detail.intake.allergies).toBe("soy");
  });
  it("refuses a day over 6 hours", async () => {
    const r = call(
      "POST",
      "/api/bookings",
      body({ days: [{ date: D1, dishes: [{ dishId: PHO.id, quantity: 3 }] }] }),
      state(),
    );
    expect(r.res.status).toBe(422);
    expect((await err(r)).fields?.["days.0.dishes"]).toMatch(
      /over the visit limit/,
    );
  });
  it("refuses a date the chef did not tick and today (D-27)", async () => {
    const r = call(
      "POST",
      "/api/bookings",
      body({ days: [{ date: TODAY, dishes: [{ dishId: PHO.id }] }] }),
      state(),
    );
    expect((await err(r)).issues?.map((i) => i.code)).toContain(
      "DATE_TOO_SOON",
    );
  });
  it("409 DOUBLE_BOOKED from another customer (hook) and from this customer's own booking", async () => {
    const hooked = state({ hooks: { otherBooked: { [MAI.id]: [D1] } } });
    const r = call("POST", "/api/bookings", body(), hooked);
    expect(r.res.status).toBe(409);
    const e = await err(r);
    expect(e.code).toBe("DOUBLE_BOOKED");
    expect(e.issues?.[0]).toMatchObject({ code: "DOUBLE_BOOKED", dayIndex: 0 });

    const { s } = await create(state());
    const again = call(
      "POST",
      "/api/bookings",
      body({ useFreeTrial: false }),
      s,
    );
    expect((await err(again)).code).toBe("DOUBLE_BOOKED");
  });
  it("free trial: one per customer, and a lost race answers FREE_TRIAL_USED once", async () => {
    const { s } = await create(state());
    const second = call(
      "POST",
      "/api/bookings",
      body({ days: [{ date: D2, dishes: [{ dishId: ROLLS.id }] }] }),
      s,
    );
    expect(second.res.status).toBe(409);
    expect((await err(second)).code).toBe("FREE_TRIAL_USED");
    // Retrying at full price works.
    const full = await create(
      s,
      body({
        days: [{ date: D2, dishes: [{ dishId: ROLLS.id }] }],
        useFreeTrial: false,
      }),
    );
    expect(full.detail.isFreeTrial).toBe(false);
    expect(full.detail.estimate.labourCents).toBeGreaterThan(0);

    const raced = state({ hooks: { trialRaceOnce: true } });
    const lost = call("POST", "/api/bookings", body(), raced);
    expect((await err(lost)).code).toBe("FREE_TRIAL_USED");
    expect(lost.next?.hooks?.trialRaceOnce).toBe(false);
    const retry = call("POST", "/api/bookings", body(), {
      ...raced,
      hooks: lost.next!.hooks!,
    });
    expect(retry.res.status).toBe(201);
  });
  it("D-28: a 4th open request is refused", async () => {
    let s = state();
    for (const d of [D1, D2, D3]) {
      s = (
        await create(
          s,
          body({
            days: [{ date: d, dishes: [{ dishId: ROLLS.id }] }],
            useFreeTrial: false,
          }),
        )
      ).s;
    }
    const r = call(
      "POST",
      "/api/bookings",
      body({
        days: [{ date: addDays(TODAY, 6), dishes: [{ dishId: ROLLS.id }] }],
        useFreeTrial: false,
      }),
      s,
    );
    expect(r.res.status).toBe(409);
    expect((await err(r)).code).toBe("TOO_MANY_OPEN_REQUESTS");
  });
});

describe("list, detail, expiry", () => {
  it("lists newest first with the open filter, and finds one booking", async () => {
    let s = state();
    const a = await create(s, body({ useFreeTrial: false }));
    const b = await create(
      a.s,
      body({
        days: [{ date: D2, dishes: [{ dishId: ROLLS.id }] }],
        useFreeTrial: false,
      }),
    );
    const list = await call(
      "GET",
      "/api/bookings?status=open",
      {},
      b.s,
    ).res.json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([
      b.detail.id,
      a.detail.id,
    ]);
    expect(list.items[0]).toMatchObject({
      firstDay: D2,
      counterparty: { displayName: MAI.displayName },
    });
    expect(list.nextCursor).toBeNull();
    const one = await call(
      "GET",
      `/api/bookings/${a.detail.id}`,
      {},
      b.s,
    ).res.json();
    expect(one.id).toBe(a.detail.id);
    expect(call("GET", "/api/bookings/not-a-uuid", {}, b.s).res.status).toBe(
      404,
    );
    expect(call("GET", "/api/bookings?status=nope", {}, b.s).res.status).toBe(
      422,
    );
  });
  it("expires a request past expiresAt on the next read (D-19)", async () => {
    const far = addDays(TODAY, 10); // expiry is 72 h, not midnight of day 1
    const farBody = () =>
      body({
        days: [{ date: far, dishes: [{ dishId: PHO.id, quantity: 1 }] }],
      });
    const { s, detail } = await create(state(), farBody());
    const later = new Date(new Date(detail.expiresAt!).getTime() + 1000);
    expect(sweepMock(s.bookings, later)![0].detail.status).toBe("expired");
    expect(sweepMock(s.bookings, NOW)).toBeNull();
    const r = call("GET", `/api/bookings/${detail.id}`, {}, s, later);
    expect(((await r.res.json()) as BookingDetail).status).toBe("expired");
    expect(r.next?.bookings?.[0].detail.status).toBe("expired");
    // An expired request frees the date and the free trial.
    const again = call(
      "POST",
      "/api/bookings",
      farBody(),
      { ...s, bookings: r.next!.bookings! },
      later,
    );
    expect(again.res.status).toBe(201);
  });
  it("hides the dates this customer holds from the chef page, not the hook's dates", async () => {
    const { s } = await create(state());
    const page = new Response(
      JSON.stringify({ id: MAI.id, bookableDates: [D1, D2] }),
      { status: 200 },
    );
    const out = await (
      await hideHeldDates(page, `/api/chefs/${MAI.id}`, s)
    ).json();
    expect(out.bookableDates).toEqual([D2]);
    const hooked = { ...state(), hooks: { otherBooked: { [MAI.id]: [D1] } } };
    const kept = await (
      await hideHeldDates(
        new Response(JSON.stringify({ id: MAI.id, bookableDates: [D1, D2] })),
        `/api/chefs/${MAI.id}`,
        hooked,
      )
    ).json();
    expect(kept.bookableDates).toEqual([D1, D2]);
  });
});

describe("cancel", () => {
  it("cancels with the timing rule (D-20): on time for a far day, late inside 48 hours", async () => {
    const { s, detail } = await create(state());
    const far = call(
      "POST",
      `/api/bookings/${detail.id}/cancel`,
      { reason: "Plans changed" },
      s,
    );
    const d = (await far.res.json()) as BookingDetail;
    expect(d).toMatchObject({
      status: "cancelled",
      cancelledBy: "customer",
      cancellationTiming: "on_time",
      cancelReason: "Plans changed",
    });
    // The date is free again and the trial is released (a new free booking works).
    const again = call("POST", "/api/bookings", body(), {
      ...s,
      bookings: far.next!.bookings!,
    });
    expect(again.res.status).toBe(201);

    const soon = await create(
      state(),
      body({
        days: [{ date: addDays(TODAY, 1), dishes: [{ dishId: ROLLS.id }] }],
        useFreeTrial: false,
      }),
    );
    const late = call(
      "POST",
      `/api/bookings/${soon.detail.id}/cancel`,
      {},
      soon.s,
    );
    expect(((await late.res.json()) as BookingDetail).cancellationTiming).toBe(
      "late",
    );
  });
  it("refuses contact details in the reason, a short reason and a second cancel", async () => {
    const { s, detail } = await create(state());
    const phone = call(
      "POST",
      `/api/bookings/${detail.id}/cancel`,
      { reason: "Call me on 416 555 0100" },
      s,
    );
    expect(phone.res.status).toBe(422);
    const e = await err(phone);
    expect(e.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    expect(e.fields?.reason).toBeTruthy();
    expect(
      call("POST", `/api/bookings/${detail.id}/cancel`, { reason: "no" }, s).res
        .status,
    ).toBe(422);
    const done = call("POST", `/api/bookings/${detail.id}/cancel`, {}, s);
    const s2 = { ...s, bookings: done.next!.bookings! };
    const twice = call("POST", `/api/bookings/${detail.id}/cancel`, {}, s2);
    expect(twice.res.status).toBe(409);
    expect((await err(twice)).reason).toBe("wrong_status");
    expect(
      call("POST", `/api/bookings/${MAI.id}/cancel`, {}, s).res.status,
    ).toBe(404);
  });
});
