// T-082 (tester): listBookings maps the batch get_bookings_frozen answer onto the rows, calls it once
// per page, and fails when the call fails. A tiny fake client; no database.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
const { listBookings } = await import("./booking-views");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ME = "00000000-0000-4000-8000-0000000000c1";
const CHEF = "00000000-0000-4000-8000-0000000000c2";
const stamp = (n: number) => `2026-01-0${n}T10:00:00+00:00`;

function row(id: string, n: number) {
  return {
    id,
    customer_id: ME,
    chef_id: CHEF,
    status: "accepted",
    location_type: "customer_home",
    grocery_option: "customer_buys",
    is_free_trial: false,
    est_total_cents: 1000,
    currency: "CAD",
    expires_at: null,
    created_at: stamp(n),
  };
}

function fake(opts: {
  rpc: { data: unknown; error: unknown };
  rows: unknown[];
}) {
  const rpc = vi.fn(async () => opts.rpc);
  const main = {
    eq: () => main,
    in: () => main,
    or: () => main,
    order: () => main,
    limit: async () => ({ data: opts.rows, error: null }),
  };
  const parts = {
    in: async () => ({ data: [], error: null }),
  };
  const db = {
    from: (t: string) => ({
      select: () => (t === "bookings" ? main : parts),
    }),
    rpc,
  };
  return { db: db as unknown as SupabaseClient, rpc };
}

const q = { status: "all", limit: 2, cursor: null } as never;

describe("listBookings frozen (T-082)", () => {
  it("marks only the ids the batch call returns, with one call for the page", async () => {
    const { db, rpc } = fake({
      rpc: { data: [B], error: null },
      rows: [row(A, 2), row(B, 1)],
    });
    const res = await listBookings(db, ME, "customer", q);
    expect(res.items.map((i) => [i.id, i.frozen])).toEqual([
      [A, false],
      [B, true],
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_bookings_frozen", {
      p_bookings: [A, B],
    });
  });

  it("only asks about the page, not the extra look-ahead row", async () => {
    const { db, rpc } = fake({
      rpc: { data: [], error: null },
      rows: [
        row(A, 3),
        row(B, 2),
        row("00000000-0000-4000-8000-00000000000d", 1),
      ],
    });
    const res = await listBookings(db, ME, "customer", {
      ...(q as object),
      limit: 2,
    } as never);
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).not.toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_bookings_frozen", {
      p_bookings: [A, B],
    });
  });

  it("treats a null answer as nothing frozen", async () => {
    const { db } = fake({
      rpc: { data: null, error: null },
      rows: [row(A, 1)],
    });
    const res = await listBookings(db, ME, "chef", q);
    expect(res.items[0].frozen).toBe(false);
  });

  it("does not call the batch function for an empty page", async () => {
    const { db, rpc } = fake({ rpc: { data: [], error: null }, rows: [] });
    const res = await listBookings(db, ME, "customer", q);
    expect(res.items).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws when the batch call fails, without leaking row data", async () => {
    const { db } = fake({
      rpc: { data: null, error: { message: "boom secret" } },
      rows: [row(A, 1)],
    });
    await expect(listBookings(db, ME, "customer", q)).rejects.toThrow(
      "bookings read failed: list parts",
    );
  });
});
