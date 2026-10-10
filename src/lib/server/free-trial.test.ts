// Logic tests for the free-trial server functions against a small in-memory stand-in for the
// service-role client. It enforces the same three partial unique indexes as the database, so the
// error mapping and the clean-4xx cases run without Docker. The real database is covered by
// tests/api/free-trial.test.ts (CI).
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure } from "@/lib/api/errors";
import { addressHash, phoneHash } from "@/lib/domain/hash";
import {
  applyFreeTrialEvent,
  checkFreeTrialEligibility,
  holdFreeTrial,
} from "./free-trial";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PEPPER = "unit-pepper";

class FakeDb {
  t: Record<string, Row[]> = {
    profiles: [],
    profile_private: [],
    bookings: [],
    free_trial_claims: [],
    free_trial_blocks: [],
  };
  uniqueError(row: Row): string | null {
    const live = this.t.free_trial_claims.filter((c) => c.state !== "released");
    if (this.t.free_trial_claims.some((c) => c.booking_id === row.booking_id))
      return "free_trial_claims_booking_id_key";
    if (live.some((c) => c.customer_id === row.customer_id))
      return "free_trial_one_per_customer";
    if (live.some((c) => c.phone_hash === row.phone_hash))
      return "free_trial_one_per_phone";
    if (live.some((c) => c.address_hash === row.address_hash))
      return "free_trial_one_per_address";
    return null;
  }
  from(table: string) {
    const rows = this.t[table];
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    const b: any = {
      select: () => b,
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.split(".eq."));
        filters.push((r) => parts.some(([k, v]) => r[k] === v));
        return b;
      },
      maybeSingle: () => run(true),
      single: () => run(true),
      then: (res: any, rej: any) => run(false).then(res, rej),
    };
    const run = async (single: boolean) => {
      if (op === "insert") {
        const row = { id: randomUUID(), state: "held", ...payload };
        if (table === "free_trial_claims") {
          const u = this.uniqueError(row);
          if (u)
            return {
              data: null,
              error: {
                code: "23505",
                message: `duplicate key value violates unique constraint "${u}"`,
              },
            };
        }
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, payload));
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    return b;
  }
  as() {
    return this as unknown as SupabaseClient;
  }
}

function setup(
  over: {
    role?: string;
    phone?: string | null;
    verified?: boolean;
    line?: string | null;
    postal?: string | null;
  } = {},
) {
  const db = new FakeDb();
  const id = randomUUID();
  db.t.profiles.push({ id, role: over.role ?? "customer" });
  db.t.profile_private.push({
    profile_id: id,
    phone_e164: over.phone === undefined ? "+14165550123" : over.phone,
    phone_verified: over.verified ?? true,
    address_line: over.line === undefined ? "12 Main Street" : over.line,
    postal_code: over.postal === undefined ? "L5B1A1" : over.postal,
  });
  return { db, id };
}
function booking(db: FakeDb, customer: string, status = "requested") {
  const id = randomUUID();
  db.t.bookings.push({ id, customer_id: customer, status });
  return id;
}
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  return null;
}

describe("loading the customer: clean 4xx, never a 500", () => {
  it("a stored phone the stricter rule rejects (N11) is 409 PHONE_NOT_SUBMITTED", async () => {
    const { db, id } = setup({ phone: "+14115550123" });
    const e = await code(
      checkFreeTrialEligibility(id, { db: db.as(), pepper: PEPPER }),
    );
    expect(e?.code).toBe("PHONE_NOT_SUBMITTED");
    expect(e?.status).toBe(409);
    const b = booking(db, id);
    expect(
      (await code(holdFreeTrial(id, b, { db: db.as(), pepper: PEPPER })))
        ?.status,
    ).toBe(409);
  });
  it("no phone, unverified phone, no address, invalid stored address", async () => {
    const run = async (o: Parameters<typeof setup>[0]) => {
      const { db, id } = setup(o);
      return code(
        checkFreeTrialEligibility(id, { db: db.as(), pepper: PEPPER }),
      );
    };
    expect((await run({ phone: null }))?.code).toBe("PHONE_NOT_SUBMITTED");
    expect((await run({ verified: false }))?.code).toBe("PHONE_NOT_VERIFIED");
    expect((await run({ line: null }))?.code).toBe("ADDRESS_NOT_SET");
    expect((await run({ postal: null }))?.code).toBe("ADDRESS_NOT_SET");
    expect((await run({ postal: "D1D1D1" }))?.code).toBe("ADDRESS_NOT_SET"); // D is never used
  });
  it("a missing private row, a chef, an admin and a bad id", async () => {
    const { db, id } = setup();
    db.t.profile_private.length = 0;
    expect(
      (
        await code(
          checkFreeTrialEligibility(id, { db: db.as(), pepper: PEPPER }),
        )
      )?.code,
    ).toBe("PHONE_NOT_SUBMITTED");
    for (const role of ["chef", "admin"]) {
      const s = setup({ role });
      expect(
        (
          await code(
            checkFreeTrialEligibility(s.id, { db: s.db.as(), pepper: PEPPER }),
          )
        )?.code,
      ).toBe("FORBIDDEN");
    }
    const s = setup();
    expect(
      (
        await code(
          checkFreeTrialEligibility("nope", { db: s.db.as(), pepper: PEPPER }),
        )
      )?.code,
    ).toBe("NOT_FOUND");
    expect(
      (
        await code(
          checkFreeTrialEligibility(randomUUID(), {
            db: s.db.as(),
            pepper: PEPPER,
          }),
        )
      )?.code,
    ).toBe("NOT_FOUND");
  });
});

describe("holdFreeTrial", () => {
  it("holds, stores server-made hashes, and a second hold by the same customer is the generic 409", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    expect(await checkFreeTrialEligibility(id, d)).toEqual({ eligible: true });
    const b1 = booking(db, id);
    const held = await holdFreeTrial(id, b1, d);
    expect(held.state).toBe("held");
    const claim = db.t.free_trial_claims[0];
    expect(claim.phone_hash).toBe(phoneHash("+14165550123", PEPPER));
    expect(claim.address_hash).toBe(
      addressHash("12 Main Street", "L5B1A1", PEPPER),
    );
    expect(await checkFreeTrialEligibility(id, d)).toEqual({ eligible: false });
    const e = await code(holdFreeTrial(id, booking(db, id), d));
    expect(e?.code).toBe("FREE_TRIAL_USED");
    expect(e?.status).toBe(409);
    // generic: nothing says which rule, no hash, no other account
    expect(JSON.stringify({ m: e?.message, x: e?.extra })).not.toMatch(
      /phone|address|customer|hash/i,
    );
    expect(db.t.free_trial_blocks).toMatchObject([
      { customer_id: id, reason: "customer" },
    ]);
  });
  it("another account with the same phone or the same address is blocked and logged with the real reason", async () => {
    const a = setup();
    const d = { db: a.db.as(), pepper: PEPPER };
    await holdFreeTrial(a.id, booking(a.db, a.id), d);
    for (const [over, reason] of [
      [{ line: "99 Other Rd", postal: "L5C2B2" }, "phone"],
      [{ phone: "+16475550199" }, "address"],
    ] as const) {
      const id = randomUUID();
      a.db.t.profiles.push({ id, role: "customer" });
      a.db.t.profile_private.push({
        profile_id: id,
        phone_e164: "+14165550123",
        phone_verified: true,
        address_line: "12 Main Street",
        postal_code: "L5B1A1",
        ...(("line" in over
          ? { address_line: over.line, postal_code: over.postal }
          : {}) as Row),
        ...(("phone" in over ? { phone_e164: over.phone } : {}) as Row),
      });
      expect(await checkFreeTrialEligibility(id, d)).toEqual({
        eligible: false,
      });
      const e = await code(holdFreeTrial(id, booking(a.db, id), d));
      expect(e?.code).toBe("FREE_TRIAL_USED");
      expect(a.db.t.free_trial_blocks.at(-1)).toMatchObject({
        customer_id: id,
        reason,
      });
    }
  });
  it("same address written differently still collides (normalization)", async () => {
    const a = setup({ line: "12 Main Street", postal: "L5B1A1" });
    const d = { db: a.db.as(), pepper: PEPPER };
    await holdFreeTrial(a.id, booking(a.db, a.id), d);
    const b = setup({
      line: "12  main st.",
      postal: "l5b 1a1",
      phone: "+16475550188",
    });
    // move b into a's fake db
    a.db.t.profiles.push(...b.db.t.profiles);
    a.db.t.profile_private.push(...b.db.t.profile_private);
    expect(await checkFreeTrialEligibility(b.id, d)).toEqual({
      eligible: false,
    });
  });
  it("a released claim frees the trial; a new booking can hold again", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    const b1 = booking(db, id);
    await holdFreeTrial(id, b1, d);
    await applyFreeTrialEvent(b1, "cancelled", d);
    expect(await checkFreeTrialEligibility(id, d)).toEqual({ eligible: true });
    expect((await holdFreeTrial(id, booking(db, id), d)).state).toBe("held");
  });
  it("a consumed claim keeps blocking", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    const b1 = booking(db, id);
    await holdFreeTrial(id, b1, d);
    await applyFreeTrialEvent(b1, "completed", d);
    expect((await code(holdFreeTrial(id, booking(db, id), d)))?.code).toBe(
      "FREE_TRIAL_USED",
    );
  });
  it("is idempotent for the same booking, and refuses someone else's, missing and non-new bookings", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    const b1 = booking(db, id);
    const first = await holdFreeTrial(id, b1, d);
    expect(await holdFreeTrial(id, b1, d)).toEqual(first);
    expect(db.t.free_trial_claims).toHaveLength(1);
    const other = setup();
    db.t.profiles.push(...other.db.t.profiles);
    db.t.profile_private.push(...other.db.t.profile_private);
    expect((await code(holdFreeTrial(other.id, b1, d)))?.code).toBe(
      "NOT_FOUND",
    );
    expect((await code(holdFreeTrial(other.id, randomUUID(), d)))?.code).toBe(
      "NOT_FOUND",
    );
    expect((await code(holdFreeTrial(other.id, "x", d)))?.code).toBe(
      "NOT_FOUND",
    );
    expect(
      (
        await code(
          holdFreeTrial(other.id, booking(db, other.id, "accepted"), d),
        )
      )?.code,
    ).toBe("INVALID_STATE");
  });
});

describe("applyFreeTrialEvent", () => {
  it("applies every A-16 outcome to a held claim and is idempotent", async () => {
    const cases: [string, string][] = [
      ["declined", "released"],
      ["expired", "released"],
      ["no_show_chef", "released"],
      ["cancelled", "released"],
      ["completed", "consumed"],
      ["no_show_customer", "consumed"],
    ];
    for (const [event, state] of cases) {
      const { db, id } = setup();
      const d = { db: db.as(), pepper: PEPPER };
      const b = booking(db, id);
      await holdFreeTrial(id, b, d);
      expect(await applyFreeTrialEvent(b, event as never, d)).toEqual({
        changed: true,
        state,
      });
      expect(await applyFreeTrialEvent(b, event as never, d)).toEqual({
        changed: false,
        state,
      });
    }
  });
  it("requested and accepted keep the hold; opposite outcome after a final one is 409 INVALID_STATE", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    const b = booking(db, id);
    await holdFreeTrial(id, b, d);
    expect(await applyFreeTrialEvent(b, "accepted", d)).toEqual({
      changed: false,
      state: "held",
    });
    await applyFreeTrialEvent(b, "completed", d);
    const e = await code(applyFreeTrialEvent(b, "cancelled", d));
    expect(e?.code).toBe("INVALID_STATE");
    expect(db.t.free_trial_claims[0].state).toBe("consumed");
  });
  it("a booking with no claim is a no-op; a bad id is 404", async () => {
    const { db, id } = setup();
    const d = { db: db.as(), pepper: PEPPER };
    expect(await applyFreeTrialEvent(booking(db, id), "completed", d)).toEqual({
      changed: false,
      state: null,
    });
    expect(
      (await code(applyFreeTrialEvent("nope", "completed", d)))?.code,
    ).toBe("NOT_FOUND");
  });
});
