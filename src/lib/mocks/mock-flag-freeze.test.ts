// T-064 (D-53): the mock adapter's frozen bookings behave like the real routes.
import { describe, expect, it } from "vitest";
import type { ApiError, BookingDetail } from "@/lib/api/types";
import { CHANGE_REFUSALS } from "@/lib/domain/bookingChanges";
import { RECEIPT_REFUSALS } from "@/lib/domain/groceries";
import {
  bookingRoutes,
  type BookingMockState,
  type BookingRouteResult,
} from "@/lib/mocks/mock-bookings";

const NOW = new Date();
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A03 = ID(9103); // accepted, chef's home, open pickup proposal
const A04 = ID(9104); // accepted, customer's home, chef shops
const A06 = ID(9106); // accepted, customer's home, chef shops, cooked

function state(
  role: "chef" | "customer",
  frozen: string[] | undefined,
): BookingMockState {
  return {
    profile: {
      id: "mock-user-1",
      role,
      displayName: "Demo",
      country: "CA",
      currency: "CAD",
      language: "en",
    },
    phone: null,
    phoneVerified: true,
    address: null,
    bookings: [],
    hooks: { seedCustomer: role === "customer", frozenSeeded: frozen },
  };
}

class Session {
  constructor(public s: BookingMockState) {}
  async call(method: string, path: string, body: unknown = {}) {
    const r = bookingRoutes(
      method,
      path,
      body,
      this.s,
      NOW,
    ) as BookingRouteResult;
    expect(r, `${method} ${path} was not routed`).toBeTruthy();
    if (r.next) this.s = { ...this.s, ...r.next } as BookingMockState;
    const json = await r.res.json();
    return { status: r.res.status, json, error: (json as ApiError).error };
  }
}

describe("frozen mock bookings (D-53)", () => {
  it("an unfrozen booking says frozen: false; a hooked one says true", async () => {
    const c = new Session(state("chef", [A04]));
    expect(
      ((await c.call("GET", `/api/bookings/${A04}`)).json as BookingDetail)
        .frozen,
    ).toBe(true);
    expect(
      ((await c.call("GET", `/api/bookings/${A06}`)).json as BookingDetail)
        .frozen,
    ).toBe(false);
  });

  it("the chef's actions answer 409 frozen, with the neutral text, and change nothing", async () => {
    const c = new Session(state("chef", [A03, A04, A06]));
    const attempts: [string, string, unknown][] = [
      ["POST", `/api/bookings/${A06}/complete`, {}],
      ["POST", `/api/bookings/${A04}/days/1/cooked`, {}],
      ["POST", `/api/bookings/${A04}/no-show`, {}],
      ["POST", `/api/bookings/${A06}/cancel`, { reason: "Sorry, ill." }],
      ["POST", `/api/bookings/${A03}/days/1/pickup/respond`, { accept: true }],
      ["POST", `/api/bookings/${A03}/pickup/missed`, {}],
      [
        "POST",
        `/api/bookings/${A06}/receipts`,
        { filePath: `${A06}/r-new.jpg`, amountCents: 4000 },
      ],
    ];
    for (const [m, p, b] of attempts) {
      const r = await c.call(m, p, b);
      expect(r.status, p).toBe(409);
      expect(r.error.code, p).toBe("INVALID_STATE");
      expect(r.error.reason, p).toBe("frozen");
      expect(r.error.message, p).toBe(CHANGE_REFUSALS.frozen);
    }
    const after = (await c.call("GET", `/api/bookings/${A06}`))
      .json as BookingDetail;
    expect(after.status).toBe("accepted");
    expect(after.completedAt).toBeNull();
  });

  it("the neutral text does not say why", () => {
    expect(CHANGE_REFUSALS.frozen).not.toMatch(/reject|chef|flag|admin note/i);
    expect(RECEIPT_REFUSALS.frozen).toBe(CHANGE_REFUSALS.frozen);
  });

  it("a booking that is not in the hook still works", async () => {
    const c = new Session(state("chef", [A04]));
    const r = await c.call("POST", `/api/bookings/${A06}/complete`, {});
    expect(r.status, r.json && JSON.stringify(r.json)).toBe(200);
    expect((r.json as BookingDetail).status).toBe("completed");
  });

  it("a customer cannot cancel a frozen booking (interim, question for Jimmy)", async () => {
    const c = new Session(state("customer", [A06]));
    await c.call("GET", "/api/bookings?status=all"); // brings the made-up bookings in
    const r = await c.call("POST", `/api/bookings/${A06}/cancel`, {});
    expect(r.status).toBe(409);
    expect(r.error.reason).toBe("frozen");
    const detail = (await c.call("GET", `/api/bookings/${A06}`))
      .json as BookingDetail;
    expect(detail.frozen).toBe(true);
    expect(detail.viewerRole).toBe("customer");
  });
});
