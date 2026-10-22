// T-107: each hourly block row shows its OWN attempts, never the customer+rule sum.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listAdminFreeTrialBlocks } from "@/lib/server/admin-engagement";
import type { AdminCaller } from "@/lib/server/admin-chefs";

const C = "33333333-3333-4333-8333-333333333333";

function caller(rows: Record<string, unknown>[]) {
  const admin = {
    from: vi.fn((t: string) => {
      const q: Record<string, unknown> = {};
      const done = async () => ({
        data:
          t === "profiles"
            ? [{ id: C, display_name: "Priya Patel", role: "customer" }]
            : rows,
        error: null,
      });
      q.select = () => q;
      q.in = () => q;
      q.or = () => q;
      q.order = () => q;
      q.limit = done;
      q.then = (res: (v: unknown) => unknown) => done().then(res);
      return q;
    }),
  };
  return { admin, userId: "u" } as unknown as AdminCaller;
}

describe("listAdminFreeTrialBlocks", () => {
  it("gives each hourly row its own attempts (3 and 4, not 7 and 7)", async () => {
    const a = caller([
      {
        id: "b2",
        customer_id: C,
        reason: "address",
        attempts: 4,
        created_at: "2026-10-20T11:00:00Z",
      },
      {
        id: "b1",
        customer_id: C,
        reason: "address",
        attempts: 3,
        created_at: "2026-10-20T09:00:00Z",
      },
    ]);
    const out = await listAdminFreeTrialBlocks(
      a,
      new URLSearchParams("limit=50"),
    );
    expect(out.items.map((i) => i.attempts)).toEqual([4, 3]);
  });

  it("reads a row with no counter as one attempt", async () => {
    const a = caller([
      {
        id: "b1",
        customer_id: C,
        reason: "phone",
        created_at: "2026-10-20T09:00:00Z",
      },
    ]);
    const out = await listAdminFreeTrialBlocks(
      a,
      new URLSearchParams("limit=50"),
    );
    expect(out.items[0].attempts).toBe(1);
  });
});
