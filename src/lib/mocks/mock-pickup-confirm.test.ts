// T-071 (D-55, contract v1.12): the mock adapter's pickup confirmation behaves like the server.
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { describe, expect, it } from "vitest";
import type { ApiError, BookingDetail } from "@/lib/api/types";
import {
  bookingRoutes,
  type BookingMockState,
} from "@/lib/mocks/mock-bookings";
import { seedCustomerBookings } from "@/lib/mocks/mock-booking-changes";

const NOW = new Date();
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A03 = ID(9103); // chef's home, day 1 cooked, a pickup time waiting
const A04 = ID(9104); // customer's home, nothing cooked
const A05 = ID(9105); // chef's home, day 1 cooked, deadline passed
const ME = {
  id: "mock-user-1",
  role: "customer" as const,
  displayName: "Demo customer",
  country: "CA",
  currency: "CAD",
  language: "en",
};

function customer(
  pickedUpIds: string[] = [],
  frozenIds: string[] = [],
): BookingMockState {
  return {
    profile: ME,
    phone: null,
    phoneVerified: true,
    address: null,
    bookings: seedCustomerBookings(ME, NOW, frozenIds, pickedUpIds).rows,
    hooks: {},
  } as unknown as BookingMockState;
}
function chefOf(s: BookingMockState): BookingMockState {
  return {
    ...s,
    profile: { ...ME, role: "chef" },
    chefBookings: s.bookings.map((r) => ({
      ...r,
      detail: { ...r.detail, viewerRole: "chef" as const },
    })),
    chefSeeded: true,
  } as unknown as BookingMockState;
}
async function call(s: BookingMockState, method: string, path: string) {
  const r = bookingRoutes(method, path, undefined, s, NOW)!;
  const json = await r.res.json();
  return {
    status: r.res.status,
    json,
    error: (json as ApiError).error,
    next: r.next ? ({ ...s, ...r.next } as BookingMockState) : s,
  };
}
const url = (id: string, n = 1) =>
  `/api/bookings/${id}/days/${n}/pickup/confirm`;

describe("mock: POST .../pickup/confirm", () => {
  it("sets pickedUpAt, voids that day's live proposals, and repeating keeps the first time", async () => {
    const r = await call(customer(), "POST", url(A03));
    expect(r.status).toBe(200);
    const d = r.json as BookingDetail;
    expect(d.days[0].pickedUpAt).toEqual(expect.any(String));
    expect(d.days[0].pickups.some((p) => p.status === "proposed")).toBe(false);
    const again = await call(r.next, "POST", url(A03));
    expect(again.status).toBe(200);
    expect((again.json as BookingDetail).days[0].pickedUpAt).toBe(
      d.days[0].pickedUpAt,
    );
  });
  it("works after the pickup deadline has passed", async () => {
    expect((await call(customer(), "POST", url(A05))).status).toBe(200);
  });
  it("refuses a customer's-home booking, an uncooked day and a frozen booking", async () => {
    expect((await call(customer(), "POST", url(A04))).error.reason).toBe(
      "not_chef_home",
    );
    const s = customer();
    s.bookings = s.bookings.map((r) =>
      r.detail.id === A03
        ? {
            ...r,
            detail: {
              ...r.detail,
              days: r.detail.days.map((d) => ({ ...d, cookedAt: null })),
            },
          }
        : r,
    );
    expect((await call(s, "POST", url(A03))).error.reason).toBe(
      "day_not_cooked",
    );
    const f = await call(customer([], [A03]), "POST", url(A03));
    expect(f.status).toBe(409);
    expect(f.error.reason).toBe("frozen");
  });
  it("refuses a booking that is not accepted, and an unknown day or booking", async () => {
    const s = customer();
    s.bookings = s.bookings.map((r) =>
      r.detail.id === A05
        ? { ...r, detail: { ...r.detail, status: "no_show_customer" as const } }
        : r,
    );
    expect((await call(s, "POST", url(A05))).error.reason).toBe("wrong_status");
    expect((await call(customer(), "POST", url(A03, 2))).status).toBe(404);
    expect((await call(customer(), "POST", url(A03, 0))).status).toBe(404);
    expect((await call(customer(), "POST", url(ID(1)))).status).toBe(404);
  });
  it("is customer only", async () => {
    expect((await call(chefOf(customer()), "POST", url(A03))).status).toBe(403);
  });
  it("always returns pickedUpAt (null before)", async () => {
    const list = await call(customer(), "GET", `/api/bookings/${A03}`);
    expect((list.json as BookingDetail).days[0].pickedUpAt).toBeNull();
  });
});

describe("mock: propose on a confirmed day (contract v1.12)", () => {
  it("is 409 picked_up and stores nothing", async () => {
    const soon = new Date(NOW.getTime() + 3600_000).toISOString();
    const s = customer();
    const c = await call(s, "POST", url(A03));
    const r = bookingRoutes(
      "POST",
      `/api/bookings/${A03}/days/1/pickup/propose`,
      { proposedAt: soon },
      c.next,
      NOW,
    )!;
    expect(r.res.status).toBe(409);
    const j = (await r.res.json()) as ApiError;
    expect(j.error.reason).toBe("picked_up");
    expect(j.error.message).toMatch(/already confirmed/);
    expect(r.next).toBeUndefined();
    const d = await call(c.next, "GET", `/api/bookings/${A03}`);
    expect(
      (d.json as BookingDetail).days[0].pickups.map((p) => p.status),
    ).not.toContain("proposed");
  });
});

describe("mock: pickup missed after a confirmation (A-29)", () => {
  it("is refused with pickup_confirmed when every past-deadline day is confirmed", async () => {
    const chef = chefOf(customer([A05]));
    const r = await call(chef, "POST", `/api/bookings/${A05}/pickup/missed`);
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("pickup_confirmed");
    expect(r.error.message).toBe(CHANGE_REFUSALS.pickup_confirmed);
  });
  it("keeps pickup_window_open when no cooked day is past its deadline", async () => {
    const r = await call(
      chefOf(customer([A03])),
      "POST",
      `/api/bookings/${A03}/pickup/missed`,
    );
    expect(r.error.reason).toBe("pickup_window_open");
  });
  it("still works for an unconfirmed day", async () => {
    const r = await call(
      chefOf(customer()),
      "POST",
      `/api/bookings/${A05}/pickup/missed`,
    );
    expect(r.status).toBe(200);
  });
  it("the seed hook marks only cooked days of the listed bookings", async () => {
    const rows = seedCustomerBookings(ME, NOW, [], [A04, A05]).rows;
    const by = (id: string) => rows.find((r) => r.detail.id === id)!.detail;
    expect(by(A04).days.every((d) => d.pickedUpAt === null)).toBe(true);
    expect(by(A05).days[0].pickedUpAt).not.toBeNull();
    expect(by(A03).days[0].pickedUpAt).toBeNull();
  });
});

describe("mock: check order on propose for a confirmed day (tester, round 3)", () => {
  // The server checks picked_up before deadline_passed (migration pickup_propose branch); the mock
  // checks the deadline first.
  it("a confirmed day past its deadline answers picked_up, like the server", async () => {
    const s = customer([A05]);
    const r = bookingRoutes(
      "POST",
      `/api/bookings/${A05}/days/1/pickup/propose`,
      { proposedAt: new Date(NOW.getTime() + 3600_000).toISOString() },
      s,
      NOW,
    )!;
    expect(r.res.status).toBe(409);
    expect(((await r.res.json()) as ApiError).error.reason).toBe("picked_up");
  });
});
