// T-064 Tester: the mock adapter's frozen bookings for the CUSTOMER side (D-65) and the receipt
// answers that stay allowed (D-66). Complements mock-flag-freeze.test.ts.
import { describe, expect, it } from "vitest";
import type { ApiError, BookingDetail } from "@/lib/api/types";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import {
  bookingRoutes,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";

const NOW = new Date();
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A03 = ID(9103); // accepted, chef's home
const A06 = ID(9106); // accepted, chef shops, one receipt

function session(frozen: string[] | undefined) {
  let s: BookingMockState = {
    profile: {
      id: "mock-user-1",
      role: "customer",
      displayName: "Demo",
      country: "CA",
      currency: "CAD",
      language: "en",
    },
    phone: null,
    phoneVerified: true,
    address: null,
    bookings: [],
    hooks: { seedCustomer: true, frozenSeeded: frozen },
  };
  return async (method: string, path: string, body: unknown = {}) => {
    const r = bookingRoutes(method, path, body, s, NOW) as BookingRouteResult;
    expect(r, `${method} ${path} was not routed`).toBeTruthy();
    if (r.next) s = { ...s, ...r.next } as BookingMockState;
    const json = await r.res.json();
    return { status: r.res.status, json, error: (json as ApiError).error };
  };
}

describe("frozen mock bookings, customer side (D-65)", () => {
  it("no-show and pickup proposal are 409 frozen with the neutral text", async () => {
    const call = session([A03, A06]);
    await call("GET", "/api/bookings?status=all");
    const noShow = await call("POST", `/api/bookings/${A06}/no-show`, {});
    expect(noShow.status).toBe(409);
    expect(noShow.error.reason).toBe("frozen");
    expect(noShow.error.message).toBe(CHANGE_REFUSALS.frozen);
    const prop = await call(
      "POST",
      `/api/bookings/${A03}/days/1/pickup/propose`,
      {
        proposedAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      },
    );
    expect(prop.status, JSON.stringify(prop.json)).toBe(409);
    expect(prop.error.reason).toBe("frozen");
  });

  it("without the hook nothing is frozen", async () => {
    const call = session(undefined);
    const list = await call("GET", "/api/bookings?status=all");
    expect(list.status).toBe(200);
    const d = (await call("GET", `/api/bookings/${A06}`)).json as BookingDetail;
    expect(d.frozen).toBe(false);
  });

  it("a receipt confirm and a dispute are still allowed on a frozen booking (D-66)", async () => {
    for (const body of [
      { action: "confirm" },
      { action: "dispute", note: "The total looks too high." },
    ]) {
      const call = session([A06]);
      await call("GET", "/api/bookings?status=all");
      const list = await call("GET", `/api/bookings/${A06}/receipts`);
      expect(list.status).toBe(200);
      const waiting = (
        list.json as { items: { id: string; status: string }[] }
      ).items.find((r) => r.status === "waiting");
      expect(waiting, "seeded A06 receipt is waiting").toBeTruthy();
      const r = await call(
        "POST",
        `/api/bookings/${A06}/receipts/${waiting!.id}/respond`,
        body,
      );
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      const d = (await call("GET", `/api/bookings/${A06}`))
        .json as BookingDetail;
      expect(d.frozen).toBe(true);
      expect(d.status).toBe("accepted");
    }
  });
});
