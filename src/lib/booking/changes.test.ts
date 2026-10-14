import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import type { BookingDayView, ReceiptView } from "@/lib/api/types";
import {
  canMarkPickupMissed,
  canPropose,
  changeErrorText,
  currentReceipt,
  differenceText,
  liveProposal,
  newReceiptPath,
  pickupEnd,
  pickupWindowPassed,
  proposalErrorText,
  receiptErrorText,
  safeFileUrl,
  torontoLocalToIso,
  validateReceiptFile,
} from "@/lib/booking/changes";
import { receiptPathError } from "@/lib/domain/groceries";

const day = (over: Partial<BookingDayView> = {}): BookingDayView => ({
  dayNumber: 1,
  date: "2026-10-20",
  cookMinutes: 60,
  dishes: [],
  cookedAt: "2026-10-20T15:00:00.000Z",
  pickupDeadlineDate: "2026-10-22",
  pickups: [],
  ...over,
});
const inv = (reason: string) =>
  new ApiClientError(409, "INVALID_STATE", "server text", { reason });

describe("torontoLocalToIso", () => {
  it("uses the summer offset", () => {
    expect(torontoLocalToIso("2026-10-20T15:30")).toBe(
      "2026-10-20T15:30:00-04:00",
    );
  });
  it("uses the winter offset", () => {
    expect(torontoLocalToIso("2026-12-20T09:05")).toBe(
      "2026-12-20T09:05:00-05:00",
    );
  });
  it("handles the changeover days", () => {
    // 2026: clocks go forward 8 March, back 1 November.
    expect(torontoLocalToIso("2026-03-08T12:00")).toBe(
      "2026-03-08T12:00:00-04:00",
    );
    expect(torontoLocalToIso("2026-03-07T12:00")).toBe(
      "2026-03-07T12:00:00-05:00",
    );
    expect(torontoLocalToIso("2026-11-01T12:00")).toBe(
      "2026-11-01T12:00:00-05:00",
    );
  });
  it("rejects text that is not a real date and time", () => {
    for (const bad of [
      "",
      "2026-10-20",
      "2026-02-30T10:00",
      "2026-10-20T25:00",
      "x",
    ])
      expect(torontoLocalToIso(bad)).toBeNull();
  });
  it("produces an instant the API parser accepts", () => {
    const iso = torontoLocalToIso("2026-10-20T15:30")!;
    expect(new Date(iso).toISOString()).toBe("2026-10-20T19:30:00.000Z");
  });
});

describe("pickups", () => {
  it("the window ends at the end of the deadline date, Toronto time", () => {
    expect(pickupEnd("2026-10-22").toISOString()).toBe(
      "2026-10-23T04:00:00.000Z",
    );
  });
  it("liveProposal prefers an open proposal, then an agreed one", () => {
    const p = (
      status: "proposed" | "accepted" | "declined" | "void",
      id: string,
    ) => ({
      id,
      proposedAt: "2026-10-21T19:00:00.000Z",
      status,
      createdAt: "2026-10-20T19:00:00.000Z",
      respondedAt: null,
    });
    expect(liveProposal(day({ pickups: [p("declined", "a")] }))).toBeNull();
    expect(
      liveProposal(day({ pickups: [p("declined", "a"), p("proposed", "b")] }))
        ?.id,
    ).toBe("b");
    expect(liveProposal(day({ pickups: [p("accepted", "c")] }))?.id).toBe("c");
  });
  it("canPropose: cooked, no live proposal, before the end of the deadline", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(canPropose(day(), now)).toBe(true);
    expect(canPropose(day({ cookedAt: null }), now)).toBe(false);
    expect(canPropose(day({ pickupDeadlineDate: null }), now)).toBe(false);
    expect(canPropose(day(), new Date("2026-10-23T04:00:00Z"))).toBe(false);
    expect(canPropose(day(), new Date("2026-10-23T03:59:59Z"))).toBe(true);
  });
  it("canMarkPickupMissed needs an accepted chef's-home booking with a passed window", () => {
    const base = {
      status: "accepted",
      locationType: "chef_home",
      days: [day()],
    } as never;
    const late = new Date("2026-10-23T04:00:00Z");
    expect(canMarkPickupMissed(base, late)).toBe(true);
    expect(canMarkPickupMissed(base, new Date("2026-10-22T12:00:00Z"))).toBe(
      false,
    );
    expect(
      canMarkPickupMissed(
        { ...(base as object), status: "completed" } as never,
        late,
      ),
    ).toBe(false);
    expect(
      canMarkPickupMissed(
        { ...(base as object), locationType: "customer_home" } as never,
        late,
      ),
    ).toBe(false);
    expect(pickupWindowPassed(day({ cookedAt: null }), late)).toBe(false);
  });
});

describe("error words", () => {
  it("words the T-063 reasons for people", () => {
    expect(changeErrorText(inv("too_early"))).toMatch(/not arrived/);
    expect(changeErrorText(inv("days_not_cooked"))).toMatch(/Mark each visit/);
    expect(changeErrorText(inv("pickup_window_open"))).toMatch(
      /can still pick up/,
    );
    expect(changeErrorText(inv("chef_home_not_enabled"))).toMatch(/Decline/);
    expect(changeErrorText(inv("kitchen_in_use"))).toMatch(/locked/);
    expect(changeErrorText(inv("something_new"))).toMatch(/Reload/);
  });
  it("words an expired request and contact details", () => {
    expect(
      changeErrorText(new ApiClientError(409, "REQUEST_EXPIRED", "x")),
    ).toMatch(/expired/);
    expect(
      changeErrorText(
        new ApiClientError(422, "CONTACT_DETAILS_NOT_ALLOWED", "x"),
      ),
    ).toMatch(/phone numbers/);
  });
  it("a proposal error names the latest allowed time", () => {
    const e = new ApiClientError(422, "VALIDATION_FAILED", "Check", {
      fields: { proposedAt: "Pick a time no later than the eat-by date." },
      latest: "2026-10-23T04:00:00.000Z",
    });
    const t = proposalErrorText(e);
    expect(t).toMatch(/no later than/);
    expect(t).toMatch(/before .*Oct/);
  });
  it("words the receipt reasons from the contract", () => {
    expect(receiptErrorText(inv("receipt_waiting"))).toMatch(/waiting/);
    expect(receiptErrorText(inv("receipt_confirmed"))).toMatch(
      /already confirmed/,
    );
    expect(receiptErrorText(inv("path_used"))).toMatch(/new name/);
    expect(receiptErrorText(inv("not_chef_shops"))).toMatch(/option B/);
    expect(receiptErrorText(inv("wrong_status"))).toMatch(
      /accepted or completed/,
    );
    expect(receiptErrorText(inv("already_answered"))).toMatch(
      /already answered/,
    );
    expect(receiptErrorText(inv("receipt_superseded"))).toMatch(/replaced/);
  });
});

describe("receipt files", () => {
  it("accepts PNG, JPEG and PDF up to 10 MB", () => {
    for (const type of ["image/png", "image/jpeg", "application/pdf"])
      expect(validateReceiptFile({ type, size: 1000 })).toBeNull();
    expect(
      validateReceiptFile({ type: "image/png", size: 10 * 1024 * 1024 }),
    ).toBeNull();
  });
  it("refuses other types, empty and large files, and no file", () => {
    expect(validateReceiptFile({ type: "image/webp", size: 10 })).toMatch(
      /not allowed/,
    );
    expect(validateReceiptFile({ type: "image/png", size: 0 })).toMatch(
      /empty/,
    );
    expect(
      validateReceiptFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }),
    ).toMatch(/too large/);
    expect(validateReceiptFile(null)).toMatch(/Choose/);
  });
  it("makes a fresh path the server accepts, never the same twice", () => {
    const booking = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const a = newReceiptPath(booking, "application/pdf");
    const b = newReceiptPath(booking, "application/pdf");
    expect(a).not.toBe(b);
    expect(a.startsWith(`${booking}/`)).toBe(true);
    for (const type of ["image/png", "image/jpeg", "application/pdf"])
      expect(
        receiptPathError(booking, newReceiptPath(booking, type)),
      ).toBeNull();
    expect(newReceiptPath(booking, "image/jpeg", "ABC-1")).toBe(
      `${booking}/abc-1.jpg`,
    );
    expect(() => newReceiptPath(booking, "image/gif")).toThrow();
  });
  it("only opens http(s) links", () => {
    expect(safeFileUrl("https://x.test/a?token=1")).toMatch(/^https:/);
    expect(safeFileUrl("javascript:alert(1)")).toBeNull();
    expect(safeFileUrl("data:text/html,hi")).toBeNull();
    expect(safeFileUrl(null)).toBeNull();
    expect(safeFileUrl("not a url")).toBeNull();
  });
});

describe("receipt wording", () => {
  const r = (over: Partial<ReceiptView>): ReceiptView => ({
    id: "r",
    bookingId: "b",
    amountCents: 5000,
    currency: "CAD",
    estimatedIngredientsCents: 4000,
    differenceCents: 1000,
    toleranceCents: 600,
    mismatchFlagged: true,
    status: "waiting",
    customerConfirmedAt: null,
    customerDisputedAt: null,
    disputeNote: null,
    createdAt: "2026-10-20T15:00:00.000Z",
    fileUrl: null,
    reimbursement: { mock: true, collected: false, amountCents: null },
    ...over,
  });
  it("says more, less or equal", () => {
    expect(differenceText(r({}))).toBe(
      "The receipt is $10.00 more than the estimate.",
    );
    expect(differenceText(r({ differenceCents: -750 }))).toMatch(
      /\$7\.50 less/,
    );
    expect(differenceText(r({ differenceCents: 0 }))).toMatch(/matches/);
  });
  it("currentReceipt skips replaced receipts", () => {
    expect(currentReceipt([])).toBeNull();
    expect(currentReceipt([r({ id: "1", status: "superseded" })])).toBeNull();
    expect(
      currentReceipt([
        r({ id: "1", status: "superseded" }),
        r({ id: "2", status: "waiting" }),
      ])?.id,
    ).toBe("2");
  });
});
