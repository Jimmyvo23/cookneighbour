// T-103 Tester round: estimate block log. Logic only (in-memory stand-in, no Docker). The real
// database path is covered by tests/api/estimate-block-log-tester.test.ts (CI).
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  estimateBlockReason,
  holdFreeTrial,
  prepareFreeTrial,
  recordTrialBlock,
} from "./free-trial";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PEPPER = "unit-pepper";

/** Minimal stand-in: claims table with the three live-unique rules, profiles, bookings. */
function makeDb() {
  const t: Record<string, Row[]> = {
    profiles: [],
    profile_private: [],
    bookings: [],
    free_trial_claims: [],
  };
  function from(table: string) {
    const rows = t[table];
    const filters: ((r: Row) => boolean)[] = [];
    let op = "select";
    let payload: Row = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      not: (k: string) => (filters.push((r) => r[k] != null), b),
      limit: () => b,
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.split(".eq."));
        filters.push((r) => parts.some(([k, v]) => r[k] === v));
        return b;
      },
      maybeSingle: () => run(true),
      single: () => run(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (res: any, rej: any) => run(false).then(res, rej),
    };
    const run = async (single: boolean) => {
      if (op === "insert") {
        const row = { id: randomUUID(), state: "held", ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, payload));
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    return b;
  }
  return { t, as: () => ({ from }) as unknown as SupabaseClient };
}

function customer(
  db: ReturnType<typeof makeDb>,
  over: { phone?: string; line?: string } = {},
) {
  const id = randomUUID();
  db.t.profiles.push({ id, role: "customer" });
  db.t.profile_private.push({
    profile_id: id,
    phone_e164: over.phone ?? "+14165550123",
    phone_verified: true,
    address_line: over.line ?? "12 Main Street",
    postal_code: "L5B1A1",
  });
  return id;
}
function claim(db: ReturnType<typeof makeDb>, id: string, state: string) {
  const bid = randomUUID();
  db.t.bookings.push({ id: bid, customer_id: id, status: "requested" });
  return holdFreeTrial(id, bid, { db: db.as(), pepper: PEPPER }).then(() => {
    db.t.free_trial_claims.forEach((c) => (c.state = state));
  });
}
const d = (db: ReturnType<typeof makeDb>) => ({
  db: db.as(),
  pepper: PEPPER,
});

describe("T-103 tester: which rule the estimate would log", () => {
  it("phone rule: same phone, different address, new account", async () => {
    const db = makeDb();
    const a = customer(db);
    await claim(db, a, "held");
    const b = customer(db, { line: "99 Other Road" });
    const p = await prepareFreeTrial(b, d(db));
    expect(estimateBlockReason(true, p)).toBe("phone");
  });

  it("customer rule wins over phone and address when all three match (same as POST /api/bookings)", async () => {
    const db = makeDb();
    const a = customer(db);
    await claim(db, a, "held");
    const p = await prepareFreeTrial(a, d(db));
    expect(p.reason).toBe("customer");
  });

  it("D-154: own customer with a HELD claim (first booking pending) is refused but logs nothing from the estimate", async () => {
    const db = makeDb();
    const a = customer(db);
    await claim(db, a, "held");
    const p = await prepareFreeTrial(a, d(db));
    expect(p.eligible).toBe(false);
    expect(estimateBlockReason(true, p)).toBeUndefined();
  });

  it("D-154: own customer with a CONSUMED claim logs nothing from the estimate", async () => {
    const db = makeDb();
    const a = customer(db);
    await claim(db, a, "consumed");
    expect(
      estimateBlockReason(true, await prepareFreeTrial(a, d(db))),
    ).toBeUndefined();
  });

  it("a RELEASED claim (declined or cancelled before a cooked day) blocks nothing and logs nothing", async () => {
    const db = makeDb();
    const a = customer(db);
    await claim(db, a, "released");
    const p = await prepareFreeTrial(a, d(db));
    expect(p.eligible).toBe(true);
    expect(estimateBlockReason(true, p)).toBeUndefined();
  });

  it("the eligible customer never has a reason, asked or not", async () => {
    const db = makeDb();
    const a = customer(db);
    const p = await prepareFreeTrial(a, d(db));
    expect(estimateBlockReason(true, p)).toBeUndefined();
    expect(estimateBlockReason(false, p)).toBeUndefined();
  });
});

describe("T-103 tester: log failure", () => {
  it("an rpc error response is swallowed (the estimate still answers)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    } as unknown as SupabaseClient;
    await expect(
      recordTrialBlock(db, randomUUID(), "address"),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledOnce();
    // The log line carries the message only, no ids, phone or address.
    expect(String(err.mock.calls[0].join(" "))).not.toMatch(/\+1|Main/);
    err.mockRestore();
  });

  it("a thrown rpc is swallowed too (T-103 round 1), so the estimate still answers", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      rpc: () => Promise.reject(new Error("network down")),
    } as unknown as SupabaseClient;
    await expect(
      recordTrialBlock(db, randomUUID(), "address"),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
