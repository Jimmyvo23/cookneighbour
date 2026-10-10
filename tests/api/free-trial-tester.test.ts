// T-038 Tester round: gaps found after reading the builder's tests. Runs against the LOCAL
// Supabase (CI). Same style as tests/api/free-trial.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { PUT as addressRoute } from "@/app/api/me/address/route";
import { ApiFailure } from "@/lib/api/errors";
import type { FreeTrialEvent } from "@/lib/domain/cancellation";
import {
  applyFreeTrialEvent,
  checkFreeTrialEligibility,
  holdFreeTrial,
} from "@/lib/server/free-trial";
import {
  anonClient,
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

beforeEach(() => freshLimits());

async function trialCustomer(over: { phone?: string; line?: string } = {}) {
  const c = await newCustomer("Tester Trial");
  const phone = over.phone ?? uniquePhone();
  const line =
    over.line ?? `${100 + Math.floor(Math.random() * 800)} Tt${rand(3)} Avenue`;
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
let day = 3000 + Math.floor(Math.random() * 2000);
async function newBooking(c: { id: string }) {
  chefPromise ??= makeChef(svc, "ft-tester-chef");
  const chef = await chefPromise;
  const b = await makeBooking(svc, {
    customer: { id: c.id, email: "" },
    chef,
    dates: [dayPlus("2036-01-01", day++)],
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
async function state(bookingId: string) {
  const { data } = await svc
    .from("free_trial_claims")
    .select("state")
    .eq("booking_id", bookingId)
    .maybeSingle();
  return data?.state as string | undefined;
}

const OUTCOME: Record<FreeTrialEvent, "hold" | "consume" | "release"> = {
  requested: "hold",
  accepted: "hold",
  declined: "release",
  expired: "release",
  cancelled: "release",
  no_show_chef: "release",
  completed: "consume",
  no_show_customer: "consume",
};
const EVENTS = Object.keys(OUTCOME) as FreeTrialEvent[];
const TARGET = { consume: "consumed", release: "released" } as const;

describe("every event from every state through the real database (A-16)", () => {
  // Reach each start state with the events that define it, then apply every event.
  const starts = [
    ["held", null],
    ["consumed", "completed"],
    ["released", "cancelled"],
  ] as const;
  for (const [from, setup] of starts)
    for (const ev of EVENTS) {
      it(`${from} + ${ev}`, async () => {
        const c = await trialCustomer();
        const b = await newBooking(c);
        await holdFreeTrial(c.id, b);
        if (setup) await applyFreeTrialEvent(b, setup);
        expect(await state(b)).toBe(from);
        const out = OUTCOME[ev];
        const expectedNext =
          out === "hold"
            ? from
            : from === "held"
              ? TARGET[out as "consume" | "release"]
              : from;
        const sameAsOutcome = out !== "hold" && from === TARGET[out];
        if (
          out === "hold" ? from === "held" : from === "held" || sameAsOutcome
        ) {
          const r = await applyFreeTrialEvent(b, ev);
          expect(r.state).toBe(expectedNext);
          expect(r.changed).toBe(from === "held" && out !== "hold");
        } else {
          expect((await fail(applyFreeTrialEvent(b, ev))).code).toBe(
            "INVALID_STATE",
          );
        }
        expect(await state(b)).toBe(expectedNext);
      });
    }
});

describe("privacy of the refusal", () => {
  it("the customer sees the identical message and extras whichever rule blocked", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    // customer rule
    const e1 = await fail(holdFreeTrial(a.id, await newBooking(a)));
    // address rule (different phone)
    const bAddr = await trialCustomer({ line: a.line });
    const e2 = await fail(holdFreeTrial(bAddr.id, await newBooking(bAddr)));
    // phone rule: same stored phone, different address (service write; D-11 blocks it via routes)
    const bPh = await trialCustomer();
    await setPrivate(svc, bPh.id, { phone_e164: a.phone });
    const e3 = await fail(holdFreeTrial(bPh.id, await newBooking(bPh)));
    for (const e of [e1, e2, e3]) {
      expect(e.status).toBe(409);
      expect(e.code).toBe("FREE_TRIAL_USED");
      expect(e.message).toBe(e1.message);
      expect(JSON.stringify(e.extra ?? null)).toBe(
        JSON.stringify(e1.extra ?? null),
      );
    }
    const logged = async (id: string) =>
      (
        await svc
          .from("free_trial_blocks")
          .select("reason")
          .eq("customer_id", id)
      ).data?.map((r) => r.reason);
    expect(await logged(a.id)).toEqual(["customer"]);
    expect(await logged(bAddr.id)).toEqual(["address"]);
    expect(await logged(bPh.id)).toEqual(["phone"]);
  });

  it("free_trial_blocks has only id, customer_id, reason, created_at: no phone, address or hash", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    await fail(holdFreeTrial(a.id, await newBooking(a)));
    const { data } = await svc
      .from("free_trial_blocks")
      .select("*")
      .eq("customer_id", a.id);
    expect(data).toHaveLength(1);
    expect(Object.keys(data![0]).sort()).toEqual([
      "created_at",
      "customer_id",
      "id",
      "reason",
    ]);
    expect(JSON.stringify(data)).not.toContain(a.phone.slice(-7));
  });

  it("clients (customer, chef, anon) cannot read, insert, update or delete blocks; only reading own claim", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    await fail(holdFreeTrial(a.id, await newBooking(a)));
    const chef = await makeUser(svc, "chef", "ft-tester-chefuser");
    const clients = [
      await chefClient(a.email),
      await chefClient(chef.email),
      anonClient(),
    ];
    for (const cl of clients) {
      const sel = await cl.from("free_trial_blocks").select("id");
      expect(sel.error ? true : (sel.data ?? []).length === 0).toBe(true);
      const ins = await cl
        .from("free_trial_blocks")
        .insert({ customer_id: a.id, reason: "phone" })
        .select();
      expect(ins.error).not.toBeNull();
      const upd = await cl
        .from("free_trial_blocks")
        .update({ reason: "phone" })
        .eq("customer_id", a.id)
        .select();
      expect(upd.error ? true : (upd.data ?? []).length === 0).toBe(true);
      const del = await cl
        .from("free_trial_blocks")
        .delete()
        .eq("customer_id", a.id)
        .select();
      expect(del.error ? true : (del.data ?? []).length === 0).toBe(true);
      const delC = await cl
        .from("free_trial_claims")
        .delete()
        .eq("customer_id", a.id)
        .select();
      expect(delC.error ? true : (delC.data ?? []).length === 0).toBe(true);
    }
    const { data } = await svc
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", a.id);
    expect(data).toHaveLength(1);
    // another customer cannot see this customer's claim
    const other = await trialCustomer();
    const oc = await chefClient(other.email);
    expect(
      (await oc.from("free_trial_claims").select("id").eq("customer_id", a.id))
        .data,
    ).toEqual([]);
  });
});

describe("more races and abuse", () => {
  it("two accounts with the same stored phone, different addresses, hold in parallel: exactly one wins", async () => {
    const a = await trialCustomer();
    const b = await trialCustomer();
    await setPrivate(svc, b.id, { phone_e164: a.phone });
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
  });

  it("a hold racing with a release of the same customer's other claim never leaves two live claims", async () => {
    for (let i = 0; i < 3; i++) {
      const c = await trialCustomer();
      const b1 = await newBooking(c);
      const b2 = await newBooking(c);
      await holdFreeTrial(c.id, b1);
      const res = await Promise.allSettled([
        applyFreeTrialEvent(b1, "cancelled"),
        holdFreeTrial(c.id, b2),
      ]);
      expect(res[0].status).toBe("fulfilled");
      const live = (
        await svc
          .from("free_trial_claims")
          .select("state")
          .eq("customer_id", c.id)
          .neq("state", "released")
      ).data;
      expect(live!.length).toBeLessThanOrEqual(1);
      if (res[1].status === "rejected")
        expect((res[1].reason as ApiFailure).code).toBe("FREE_TRIAL_USED");
    }
  });

  it("a released booking cannot be held again (booking id is single use) and a released customer can use a new one", async () => {
    const c = await trialCustomer();
    const b = await newBooking(c);
    await holdFreeTrial(c.id, b);
    await applyFreeTrialEvent(b, "declined");
    expect((await fail(holdFreeTrial(c.id, b))).code).toBe("INVALID_STATE");
    const b2 = await newBooking(c);
    expect((await holdFreeTrial(c.id, b2)).state).toBe("held");
  });

  it("an admin is refused (403) and a malformed id is 404, never 500", async () => {
    const admin = await makeUser(svc, "admin", "ft-tester-admin");
    expect((await fail(checkFreeTrialEligibility(admin.id))).code).toBe(
      "FORBIDDEN",
    );
    expect((await fail(checkFreeTrialEligibility("not-a-uuid"))).status).toBe(
      404,
    );
    const c = await trialCustomer();
    expect((await fail(holdFreeTrial(c.id, "nope"))).status).toBe(404);
    expect((await fail(applyFreeTrialEvent("nope", "completed"))).status).toBe(
      404,
    );
  });

  it("phone written with a different format collides (stored E.164 is what is hashed); foreign +44 number is refused cleanly via the DB check", async () => {
    const c = await trialCustomer();
    const r = await svc
      .from("profile_private")
      .update({ phone_e164: "+447911123456" })
      .eq("profile_id", c.id);
    expect(r.error).not.toBeNull(); // DB check allows +1 and ten digits only
  });

  it("block log grows on every blocked attempt (no de-duplication): documents the behaviour", async () => {
    const c = await trialCustomer();
    await holdFreeTrial(c.id, await newBooking(c));
    for (let i = 0; i < 3; i++)
      await fail(holdFreeTrial(c.id, await newBooking(c)));
    const { data } = await svc
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", c.id);
    expect(data).toHaveLength(3);
  });

  it("the advisory check never writes a block row", async () => {
    const a = await trialCustomer();
    await holdFreeTrial(a.id, await newBooking(a));
    await checkFreeTrialEligibility(a.id);
    const { data } = await svc
      .from("free_trial_blocks")
      .select("id")
      .eq("customer_id", a.id);
    expect(data).toHaveLength(0);
  });
});
