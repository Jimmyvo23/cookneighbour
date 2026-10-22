// T-107 Tester (LOCAL Supabase, runs in CI). Admin blocks list: per-row attempts, shape per docs/api-contract.md.
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import { bookingCustomer } from "./booking-helpers";
import { adminBlocks } from "./engagement-helpers";
import { newAdmin, svc } from "./chef-helpers";

beforeEach(() => freshLimits());

type Item = {
  id: string;
  customer: { id: string; displayName: string };
  reason: string;
  createdAt: string;
  attempts: number;
};

describe("T-107 tester: admin free-trial blocks, real database", () => {
  it("each row returns its own counter; other customers and rules do not leak in; createdAt is the row's own time", async () => {
    const a = await bookingCustomer();
    const b = await bookingCustomer();
    const t = (h: number) => `2026-10-20T${String(h).padStart(2, "0")}:00:00Z`;
    const ins = await svc.from("free_trial_blocks").insert([
      { customer_id: a.id, reason: "address", attempts: 5, created_at: t(11) },
      { customer_id: a.id, reason: "address", attempts: 1, created_at: t(9) },
      { customer_id: a.id, reason: "phone", attempts: 2, created_at: t(8) },
      { customer_id: b.id, reason: "address", attempts: 6, created_at: t(7) },
    ]);
    expect(ins.error).toBeNull();
    const admin = await newAdmin();
    const list = await adminBlocks(admin.b, "limit=50");
    expect(list.status, list.text).toBe(200);
    expect(Object.keys(list.body).sort()).toEqual(["items", "nextCursor"]);
    const mine = (list.body.items as Item[]).filter((x) =>
      [a.id, b.id].includes(x.customer.id),
    );
    expect(mine).toHaveLength(4);
    for (const x of mine)
      expect(Object.keys(x).sort()).toEqual(
        ["attempts", "createdAt", "customer", "id", "reason"].sort(),
      );
    const pick = (c: string, r: string) =>
      mine
        .filter((x) => x.customer.id === c && x.reason === r)
        .map((x) => [x.attempts, new Date(x.createdAt).toISOString()]);
    expect(pick(a.id, "address")).toEqual([
      [5, "2026-10-20T11:00:00.000Z"],
      [1, "2026-10-20T09:00:00.000Z"],
    ]);
    expect(pick(a.id, "phone")).toEqual([[2, "2026-10-20T08:00:00.000Z"]]);
    expect(pick(b.id, "address")).toEqual([[6, "2026-10-20T07:00:00.000Z"]]);
    expect(JSON.stringify(mine)).not.toMatch(/last_attempt|lastAttempt/);
  });
});
