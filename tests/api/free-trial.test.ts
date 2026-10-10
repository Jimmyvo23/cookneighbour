// T-038: free-trial rules against the LOCAL Supabase (CLAUDE.md 6.6 and section 10: "second free
// trial attempt via same phone, same address, or new account"). The server functions are called
// directly (no booking routes yet, T-042). Every customer gets its own random phone and street, so
// parallel files sharing the database cannot collide with each other.
import { beforeEach, describe, expect, it } from "vitest";
import { PUT as addressRoute } from "@/app/api/me/address/route";
import { ApiFailure } from "@/lib/api/errors";
import { addressHash, phoneHash } from "@/lib/domain/hash";
import {
  applyFreeTrialEvent,
  checkFreeTrialEligibility,
  holdFreeTrial,
} from "@/lib/server/free-trial";
import {
  dayPlus,
  makeBooking,
  makeChef,
  makeUser,
  setPrivate,
} from "../rls/helpers";
import { freshLimits, rand } from "./harness";
import {
  chefClient,
  newCustomer,
  phone as phoneRoute,
  svc,
  uniquePhone,
  verify as verifyRoute,
} from "./chef-helpers";

const PEPPER = "api-test-pepper"; // set in tests/api/setup.ts
beforeEach(() => freshLimits());

interface Cust {
  id: string;
  email: string;
  phone: string;
  line: string;
}

/** A customer with a MOCK-verified phone and a home address, through the real routes. */
async function trialCustomer(
  over: { phone?: string; line?: string } = {},
): Promise<Cust> {
  const c = await newCustomer("Trial Customer");
  const phone = over.phone ?? uniquePhone();
  const line =
    over.line ?? `${100 + Math.floor(Math.random() * 800)} Ft${rand(3)} Street`;
  let r = await c.b.call(phoneRoute, { body: { phone } });
  expect(r.status, r.text).toBe(200);
  r = await c.b.call(verifyRoute, { body: { code: "123456" } });
  expect(r.status, r.text).toBe(200);
  r = await c.b.call(addressRoute, {
    method: "PUT",
    body: { line, city: "Mississauga", postalCode: "L5B 1A1" },
  });
  expect(r.status, r.text).toBe(200);
  return { id: c.id, email: c.email, phone, line };
}

let chefPromise: ReturnType<typeof makeChef> | undefined;
// A random start per run, then one new day per booking: the chef never has two visits on a day.
let dayCounter = Math.floor(Math.random() * 2000);
/** A new `requested` booking for the customer, on a date no other booking of this chef uses. */
async function newBooking(c: { id: string }): Promise<string> {
  chefPromise ??= makeChef(svc, "ft-api-chef");
  const chef = await chefPromise;
  const date = dayPlus("2032-01-01", dayCounter++);
  const b = await makeBooking(svc, {
    customer: { id: c.id, email: "" },
    chef,
    dates: [date],
  });
  return b.id;
}

async function fail(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiFailure);
    return e as ApiFailure;
  }
  throw new Error("expected the call to fail");
}
async function claimState(bookingId: string) {
  const { data, error } = await svc
    .from("free_trial_claims")
    .select("state, phone_hash, address_hash, customer_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}
async function blocks(customerId: string) {
  const { data, error } = await svc
    .from("free_trial_blocks")
    .select("reason")
    .eq("customer_id", customerId);
  expect(error).toBeNull();
  return (data ?? []).map((b) => b.reason as string);
}
async function claimCount(customerId: string) {
  const { data, error } = await svc
    .from("free_trial_claims")
    .select("id")
    .eq("customer_id", customerId);
  expect(error).toBeNull();
  return (data ?? []).length;
}

describe("hold", () => {
  it("a new customer is eligible; the hold stores hashes the server made itself", async () => {
    const c = await trialCustomer();
    expect(await checkFreeTrialEligibility(c.id)).toEqual({ eligible: true });
    const b = await newBooking(c);
    const held = await holdFreeTrial(c.id, b);
    expect(held).toMatchObject({ bookingId: b, state: "held" });
    const row = await claimState(b);
    expect(row?.state).toBe("held");
    expect(row?.phone_hash).toBe(phoneHash(c.phone, PEPPER));
    expect(row?.address_hash).toBe(addressHash(c.line, "L5B1A1", PEPPER));
    expect(await checkFreeTrialEligibility(c.id)).toEqual({ eligible: false });
  });

  it("same customer, second booking: 409 FREE_TRIAL_USED, generic message, logged as 'customer'", async () => {
    const c = await trialCustomer();
    await holdFreeTrial(c.id, await newBooking(c));
    const e = await fail(holdFreeTrial(c.id, await newBooking(c)));
    expect(e.status).toBe(409);
    expect(e.code).toBe("FREE_TRIAL_USED");
    expect(`${e.message} ${JSON.stringify(e.extra)}`).not.toMatch(
      /phone|address|customer|hash|account/i,
    );
    expect(await blocks(c.id)).toEqual(["customer"]);
    expect(await claimCount(c.id)).toBe(1);
  });

  it("same phone, new account: the second account cannot even verify it (D-11); if the first account moved on, the hash still blocks", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    // A second account cannot verify a number that is still verified on the first.
    const b0 = await newCustomer("Second");
    const r1 = await b0.b.call(phoneRoute, { body: { phone: a.phone } });
    if (r1.status === 200) {
      const r2 = await b0.b.call(verifyRoute, { body: { code: "123456" } });
      expect(r2.status, r2.text).toBe(409);
      expect(r2.body.error.code).toBe("PHONE_IN_USE");
    } else {
      expect(r1.status, r1.text).toBe(409);
    }
    // The first account changes its phone; the number is free to verify again, but the claim
    // still carries its hash.
    await setPrivate(svc, a.id, {
      phone_e164: uniquePhone(),
      phone_hash: `moved-${rand(4)}`,
    });
    const b = await trialCustomer({ phone: a.phone });
    expect(await checkFreeTrialEligibility(b.id)).toEqual({ eligible: false });
    const e = await fail(holdFreeTrial(b.id, await newBooking(b)));
    expect(e.code).toBe("FREE_TRIAL_USED");
    expect(await blocks(b.id)).toEqual(["phone"]);
    expect(await claimCount(b.id)).toBe(0);
  });

  it("same address, new account and new phone: blocked, logged as 'address'; spelled differently is the same address", async () => {
    const a = await trialCustomer({ line: `55 Maple${rand(2)} Street` });
    await holdFreeTrial(a.id, await newBooking(a));
    const b = await trialCustomer({
      line: a.line.replace("Street", "st.").toLowerCase(),
    });
    expect(b.phone).not.toBe(a.phone);
    expect(await checkFreeTrialEligibility(b.id)).toEqual({ eligible: false });
    const e = await fail(holdFreeTrial(b.id, await newBooking(b)));
    expect(e.code).toBe("FREE_TRIAL_USED");
    expect(await blocks(b.id)).toEqual(["address"]);
  });

  it("a different phone and a different address are not affected by other claims", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    const b = await trialCustomer();
    expect(await checkFreeTrialEligibility(b.id)).toEqual({ eligible: true });
    await holdFreeTrial(b.id, await newBooking(b));
  });

  it("retrying the same booking is safe (idempotent)", async () => {
    const c = await trialCustomer();
    const b = await newBooking(c);
    const one = await holdFreeTrial(c.id, b);
    expect(await holdFreeTrial(c.id, b)).toEqual(one);
    expect(await claimCount(c.id)).toBe(1);
  });

  it("refuses another customer's booking (404), a chef (403) and a non-new booking (409)", async () => {
    const a = await trialCustomer();
    const b = await trialCustomer();
    const ba = await newBooking(a);
    expect((await fail(holdFreeTrial(b.id, ba))).code).toBe("NOT_FOUND");
    expect(await claimState(ba)).toBeNull();
    const chef = await makeUser(svc, "chef", "ft-role-chef");
    expect((await fail(checkFreeTrialEligibility(chef.id))).code).toBe(
      "FORBIDDEN",
    );
    const { error } = await svc
      .from("bookings")
      .update({ status: "accepted" })
      .eq("id", ba);
    expect(error).toBeNull();
    expect((await fail(holdFreeTrial(a.id, ba))).code).toBe("INVALID_STATE");
  });
});

describe("stored data the rules refuse is a clean 409, never a 500 (T-037 follow-up)", () => {
  it("a stored N11 phone, an unverified phone, no phone, a bad stored postal code, no address", async () => {
    const c = await trialCustomer();
    const b = await newBooking(c);
    const cases: [Record<string, unknown>, string][] = [
      [{ phone_e164: "+14115550123" }, "PHONE_NOT_SUBMITTED"],
      [{ phone_e164: null }, "PHONE_NOT_SUBMITTED"],
      [
        { phone_e164: "+14165550123", phone_verified: false },
        "PHONE_NOT_VERIFIED",
      ],
      [{ phone_verified: true, address_line: null }, "ADDRESS_NOT_SET"],
      [{ address_line: "1 Test St", postal_code: "D1D1D1" }, "ADDRESS_NOT_SET"],
    ];
    for (const [patch, code] of cases) {
      await setPrivate(svc, c.id, patch);
      for (const call of [
        () => checkFreeTrialEligibility(c.id),
        () => holdFreeTrial(c.id, b),
      ]) {
        const e = await fail(call());
        expect(e.status).toBe(409);
        expect(e.code).toBe(code);
      }
    }
    expect(await claimState(b)).toBeNull();
  });
});

describe("outcomes (A-16) on a real claim", () => {
  const released = [
    "declined",
    "expired",
    "no_show_chef",
    "cancelled",
  ] as const;
  const consumed = ["completed", "no_show_customer"] as const;

  it.each(released)(
    "%s releases the claim and frees the trial for the customer and for the same phone/address",
    async (event) => {
      const a = await trialCustomer();
      const b = await newBooking(a);
      await holdFreeTrial(a.id, b);
      expect(await applyFreeTrialEvent(b, event)).toEqual({
        changed: true,
        state: "released",
      });
      expect(await claimState(b)).toMatchObject({ state: "released" });
      expect(await checkFreeTrialEligibility(a.id)).toEqual({ eligible: true });
      // A different account at the same address can now use the trial.
      const other = await trialCustomer({ line: a.line });
      expect(await checkFreeTrialEligibility(other.id)).toEqual({
        eligible: true,
      });
      // and the customer can hold again with a new booking.
      await holdFreeTrial(a.id, await newBooking(a));
    },
  );

  it.each(consumed)(
    "%s consumes the claim and it keeps blocking",
    async (event) => {
      const a = await trialCustomer();
      const b = await newBooking(a);
      await holdFreeTrial(a.id, b);
      expect(await applyFreeTrialEvent(b, event)).toEqual({
        changed: true,
        state: "consumed",
      });
      expect(await checkFreeTrialEligibility(a.id)).toEqual({
        eligible: false,
      });
      expect((await fail(holdFreeTrial(a.id, await newBooking(a)))).code).toBe(
        "FREE_TRIAL_USED",
      );
      const same = await trialCustomer({ line: a.line });
      expect(
        (await fail(holdFreeTrial(same.id, await newBooking(same)))).code,
      ).toBe("FREE_TRIAL_USED");
    },
  );

  it("requested and accepted keep the hold; a finished claim refuses the opposite outcome and never moves", async () => {
    const a = await trialCustomer();
    const b = await newBooking(a);
    await holdFreeTrial(a.id, b);
    expect(await applyFreeTrialEvent(b, "accepted")).toEqual({
      changed: false,
      state: "held",
    });
    await applyFreeTrialEvent(b, "completed");
    expect((await fail(applyFreeTrialEvent(b, "cancelled"))).code).toBe(
      "INVALID_STATE",
    );
    expect((await fail(applyFreeTrialEvent(b, "accepted"))).code).toBe(
      "INVALID_STATE",
    );
    expect(await applyFreeTrialEvent(b, "no_show_customer")).toEqual({
      changed: false,
      state: "consumed",
    });
    expect(await claimState(b)).toMatchObject({ state: "consumed" });
  });

  it("a booking without a claim is a no-op", async () => {
    const a = await trialCustomer();
    expect(await applyFreeTrialEvent(await newBooking(a), "completed")).toEqual(
      { changed: false, state: null },
    );
  });

  it("clients cannot change or create claims themselves (RLS, no client writes)", async () => {
    const a = await trialCustomer();
    const b = await newBooking(a);
    await holdFreeTrial(a.id, b);
    const me = await chefClient(a.email); // a signed-in client of any role
    const up = await me
      .from("free_trial_claims")
      .update({ state: "released" })
      .eq("booking_id", b)
      .select();
    expect(up.error ? up.error.code : up.data).toSatisfy(
      (v: unknown) => v === "42501" || (Array.isArray(v) && v.length === 0),
    );
    expect(await claimState(b)).toMatchObject({ state: "held" });
    const own = await me
      .from("free_trial_claims")
      .select("state")
      .eq("booking_id", b);
    expect(own.data).toEqual([{ state: "held" }]); // can read own claim, nothing else
  });
});

describe("races", () => {
  it("parallel holds by one customer for five bookings: exactly one wins", async () => {
    const c = await trialCustomer();
    const bookings = await Promise.all(
      [1, 2, 3, 4, 5].map(() => newBooking(c)),
    );
    const res = await Promise.allSettled(
      bookings.map((b) => holdFreeTrial(c.id, b)),
    );
    const ok = res.filter((r) => r.status === "fulfilled");
    const bad = res.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(4);
    for (const r of bad) {
      expect(r.reason).toBeInstanceOf(ApiFailure);
      expect(r.reason.code).toBe("FREE_TRIAL_USED");
    }
    expect(await claimCount(c.id)).toBe(1);
    expect(await blocks(c.id)).toHaveLength(4);
  });

  it("parallel holds by two accounts at the same address: exactly one wins", async () => {
    const line = `7 Race${rand(3)} Road`;
    const [a, b] = await Promise.all([
      trialCustomer({ line }),
      trialCustomer({ line }),
    ]);
    const [ba, bb] = await Promise.all([newBooking(a), newBooking(b)]);
    const res = await Promise.allSettled([
      holdFreeTrial(a.id, ba),
      holdFreeTrial(b.id, bb),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = res.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(lost.reason.code).toBe("FREE_TRIAL_USED");
    expect((await claimCount(a.id)) + (await claimCount(b.id))).toBe(1);
  });

  it("parallel retries of the same booking all succeed with one claim", async () => {
    const c = await trialCustomer();
    const b = await newBooking(c);
    const res = await Promise.all(
      [1, 2, 3, 4].map(() => holdFreeTrial(c.id, b)),
    );
    expect(new Set(res.map((r) => r.claimId)).size).toBe(1);
    expect(await claimCount(c.id)).toBe(1);
  });

  it("completed and cancelled at the same moment: one applies, the other is refused, the state matches the winner", async () => {
    for (let i = 0; i < 5; i++) {
      const c = await trialCustomer();
      const b = await newBooking(c);
      await holdFreeTrial(c.id, b);
      const res = await Promise.allSettled([
        applyFreeTrialEvent(b, "completed"),
        applyFreeTrialEvent(b, "cancelled"),
      ]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = res.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(lost.reason.code).toBe("INVALID_STATE");
      const win = res.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<{ state: string }>;
      expect((await claimState(b))?.state).toBe(win.value.state);
    }
  });

  it("the same outcome twice at once: both succeed, exactly one changed it", async () => {
    const c = await trialCustomer();
    const b = await newBooking(c);
    await holdFreeTrial(c.id, b);
    const res = await Promise.all([
      applyFreeTrialEvent(b, "declined"),
      applyFreeTrialEvent(b, "declined"),
      applyFreeTrialEvent(b, "expired"),
    ]);
    expect(res.filter((r) => r.changed)).toHaveLength(1);
    expect(res.every((r) => r.state === "released")).toBe(true);
  });
});
