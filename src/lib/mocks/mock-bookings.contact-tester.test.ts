// Tester additions for T-073: the mock `viewOf` must mirror the server cut-off
// `booking_contact_ends_at` = 00:00 Toronto on the last visit day + 8 (D-52, D-56), including
// the daylight-saving weeks, several days (unsorted) and the exact boundary. All data is made up.
import { describe, expect, it } from "vitest";
import type { MeProfile } from "@/lib/api/types";
import { seedChefBookings } from "@/lib/mocks/mock-booking-changes";
import { viewOf, type MockBookingRow } from "@/lib/mocks/mock-bookings";

const chef: MeProfile = {
  id: "mock-user-1",
  role: "chef",
  displayName: "Demo chef",
  country: "CA",
  currency: "CAD",
  language: "en",
} as MeProfile;

function row(
  status: MockBookingRow["detail"]["status"],
  dates: string[],
): MockBookingRow {
  const seeded = seedChefBookings(chef, new Date()).rows.find(
    (r) => r.detail.id.endsWith("9103") && r.detail.days.length >= 1,
  )!;
  const proto = seeded.detail.days[0];
  return {
    ...seeded,
    detail: {
      ...seeded.detail,
      status,
      days: dates.map((date, i) => ({
        ...proto,
        date,
        dayNumber: i + 1,
      })),
    },
  };
}

const iso = (s: string) => new Date(s);

describe("mock viewOf contact cut-off (server mirror)", () => {
  it("cut-off is 00:00 Toronto on last day + 8 in summer time (04:00Z)", () => {
    const r = row("accepted", ["2026-07-10"]);
    const v = viewOf(r, "customer", iso("2026-07-10T12:00:00Z"));
    expect(v.contactVisibleUntil).toBe("2026-07-18T04:00:00.000Z");
    expect(v.contact).not.toBeNull();
  });
  it("flips exactly at the cut-off instant, for both roles", () => {
    const r = row("completed", ["2026-07-10"]);
    for (const role of ["customer", "chef"] as const) {
      const before = viewOf(r, role, iso("2026-07-18T03:59:59.999Z"));
      const at = viewOf(r, role, iso("2026-07-18T04:00:00.000Z"));
      expect(before.contact).not.toBeNull();
      expect(at.contact).toBeNull();
      expect(at.contactVisibleUntil).toBeNull();
    }
  });
  it("uses winter offset when the cut-off is after the November change (05:00Z)", () => {
    // Last day Oct 25 + 8 = Nov 2 (EST, after the change on Nov 1, 2026).
    const v = viewOf(
      row("accepted", ["2026-10-25"]),
      "customer",
      iso("2026-10-26T12:00:00Z"),
    );
    expect(v.contactVisibleUntil).toBe("2026-11-02T05:00:00.000Z");
    // Last day Oct 24 + 8 = Nov 1 00:00, still EDT (the change is at 02:00).
    const w = viewOf(
      row("accepted", ["2026-10-24"]),
      "customer",
      iso("2026-10-26T12:00:00Z"),
    );
    expect(w.contactVisibleUntil).toBe("2026-11-01T04:00:00.000Z");
  });
  it("handles the March change (last day Mar 6 + 8 = Mar 14, 2027, EST until 02:00)", () => {
    const v = viewOf(
      row("accepted", ["2027-03-06"]),
      "customer",
      iso("2027-03-07T12:00:00Z"),
    );
    expect(v.contactVisibleUntil).toBe("2027-03-14T05:00:00.000Z");
  });
  it("uses the LAST day of a multi-day booking even when the days are listed out of order", () => {
    const v = viewOf(
      row("accepted", ["2026-07-12", "2026-07-10", "2026-07-11"]),
      "customer",
      iso("2026-07-12T12:00:00Z"),
    );
    expect(v.contactVisibleUntil).toBe("2026-07-20T04:00:00.000Z");
  });
  it("a one-day booking is visible on the visit day and on day 7 after it, hidden on day 8", () => {
    const r = row("accepted", ["2026-07-10"]);
    expect(
      viewOf(r, "chef", iso("2026-07-17T23:59:00-04:00")).contact,
    ).not.toBeNull();
    expect(
      viewOf(r, "chef", iso("2026-07-18T00:00:00-04:00")).contact,
    ).toBeNull();
  });
  it("never shows contact (or a window) for requested, cancelled, declined or expired", () => {
    for (const s of [
      "requested",
      "cancelled",
      "declined",
      "expired",
    ] as const) {
      const v = viewOf(
        row(s, ["2026-07-10"]),
        "customer",
        iso("2026-07-10T12:00:00Z"),
      );
      expect(v.contact, s).toBeNull();
      expect(v.contactVisibleUntil, s).toBeNull();
    }
  });
});
