// T-090: decide() must fail loudly when the final free_trial_claims read fails, instead of
// answering freeTrial: "none".
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/free-trial", () => ({
  applyFreeTrialEvent: vi.fn(async () => undefined),
}));

import { decide } from "@/lib/server/admin-engagement";
import type { AdminCaller } from "@/lib/server/admin-chefs";

const BOOKING = "11111111-1111-4111-8111-111111111111";
const REPORT = "22222222-2222-4222-8222-222222222222";

function caller(claim: { data: unknown; error: unknown }) {
  const tables: string[] = [];
  const admin = {
    rpc: vi.fn(async () => ({
      error: null,
      data: {
        result: "ok",
        booking_id: BOOKING,
        status: "accepted",
        changed: false,
        cooked: false,
        kind: "report_resolved",
        decided_at: "2026-10-20T12:00:00Z",
      },
    })),
    from: vi.fn((t: string) => {
      tables.push(t);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => (t === "free_trial_claims" ? claim : { data: null, error: null });
      return q;
    }),
  };
  return { a: { admin, userId: "u" } as unknown as AdminCaller, tables };
}

const input = {
  kind: "report_resolve" as const,
  bookingId: null,
  reportId: REPORT,
  finalStatus: null,
  note: "looked at it",
};

describe("decide()", () => {
  it("throws when the free_trial_claims read fails (no silent freeTrial: none)", async () => {
    const { a } = caller({ data: null, error: { message: "boom" } });
    await expect(decide(a, input)).rejects.toThrow(/free_trial_claims/);
  });

  it("answers from the claim row and does not read reports for the booking id", async () => {
    const { a, tables } = caller({ data: { state: "held" }, error: null });
    const out = await decide(a, input);
    expect(out.freeTrial).toBe("held");
    expect(out.booking.id).toBe(BOOKING);
    expect(tables).not.toContain("reports");
  });
});
