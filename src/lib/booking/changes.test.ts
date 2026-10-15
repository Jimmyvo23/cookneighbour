import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import type {
  BookingDayView,
  BookingDetail,
  ReceiptView,
} from "@/lib/api/types";
import {
  canChefCancel,
  cancelBookingErrorText,
  noShowDay,
  isWaitingForCheck,
  pastUncookedDays,
  summaryAllDatesPast,
  chefNoShowTrialText,
  noShowErrorText,
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
import { torontoToday } from "@/lib/domain/dishes";

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

describe("chef cancel and no-show (T-070)", () => {
  const book = (
    status: BookingDetail["status"],
    days: Partial<BookingDayView>[],
  ) =>
    ({
      status,
      days: days.map((d, i) => day({ dayNumber: i + 1, ...d })),
    }) as BookingDetail;
  const T = "2026-10-20";

  it("can cancel an accepted booking while a visit that is not cooked is today or later", () => {
    expect(
      canChefCancel(book("accepted", [{ date: T, cookedAt: null }]), T),
    ).toBe(true);
    expect(
      canChefCancel(
        book("accepted", [{ date: "2026-10-21", cookedAt: null }]),
        T,
      ),
    ).toBe(true);
  });
  it("cannot cancel when every visit is cooked or past, or the booking is not accepted", () => {
    expect(
      canChefCancel(book("accepted", [{ date: T, cookedAt: "x" }]), T),
    ).toBe(false);
    expect(
      canChefCancel(
        book("accepted", [{ date: "2026-10-19", cookedAt: null }]),
        T,
      ),
    ).toBe(false);
    expect(
      canChefCancel(book("requested", [{ date: T, cookedAt: null }]), T),
    ).toBe(false);
  });
  it("finds the earliest due visit that is not cooked", () => {
    const b = book("accepted", [
      { date: "2026-10-19", cookedAt: "x" },
      { date: "2026-10-20", cookedAt: null },
      { date: "2026-10-21", cookedAt: null },
    ]);
    expect(noShowDay(b, T)?.dayNumber).toBe(2);
  });
  it("finds no due visit before the visit date, or when it is cooked, or when not accepted", () => {
    expect(
      noShowDay(book("accepted", [{ date: "2026-10-21", cookedAt: null }]), T),
    ).toBeNull();
    expect(
      noShowDay(book("accepted", [{ date: T, cookedAt: "x" }]), T),
    ).toBeNull();
    expect(
      noShowDay(book("completed", [{ date: T, cookedAt: null }]), T),
    ).toBeNull();
  });
  it("words every cancel refusal", () => {
    expect(cancelBookingErrorText(inv("wrong_status"))).toMatch(
      /not accepted any more/,
    );
    expect(cancelBookingErrorText(inv("chef_use_decline"))).toMatch(
      /Decline it with a reason/,
    );
    expect(cancelBookingErrorText(inv("nothing_left"))).toMatch(
      /nothing left to cancel/,
    );
    expect(cancelBookingErrorText(inv("expired"))).toMatch(/expired/);
    expect(
      cancelBookingErrorText(
        new ApiClientError(422, "CONTACT_DETAILS_NOT_ALLOWED", "server text", {
          fields: { reason: "Remove the contact details." },
        }),
      ),
    ).toMatch(/phone numbers, emails and links/);
    expect(
      cancelBookingErrorText(
        new ApiClientError(422, "VALIDATION_FAILED", "Check", {
          fields: { reason: "Enter 3 to 500 characters." },
        }),
      ),
    ).toBe("Enter 3 to 500 characters.");
    expect(cancelBookingErrorText(new Error("x"))).toMatch(/try again/i);
  });
  it("words every no-show refusal", () => {
    expect(noShowErrorText(inv("wrong_status"))).toMatch(
      /not accepted any more/,
    );
    expect(noShowErrorText(inv("no_visit_due"))).toMatch(/from the visit date/);
    expect(
      noShowErrorText(new ApiClientError(403, "FORBIDDEN", "Only the chef.")),
    ).toBe("Only the chef.");
  });
});

describe("waiting for a check and past uncooked days (T-072)", () => {
  const book = (
    status: BookingDetail["status"],
    days: Partial<BookingDayView>[],
  ) =>
    ({
      status,
      days: days.map((d, i) => day({ dayNumber: i + 1, ...d })),
    }) as BookingDetail;
  const T = "2026-10-20";

  it("waits for a check only when accepted, every date is before today and no day is cooked", () => {
    const past = [
      { date: "2026-10-17", cookedAt: null },
      { date: "2026-10-18", cookedAt: null },
    ];
    expect(isWaitingForCheck(book("accepted", past), T)).toBe(true);
    expect(isWaitingForCheck(book("completed", past), T)).toBe(false);
    expect(
      isWaitingForCheck(
        book("accepted", [past[0], { date: T, cookedAt: null }]),
        T,
      ),
    ).toBe(false);
    expect(
      isWaitingForCheck(
        book("accepted", [past[0], { date: "2026-10-18", cookedAt: "x" }]),
        T,
      ),
    ).toBe(false);
    expect(isWaitingForCheck(book("accepted", []), T)).toBe(false);
  });

  it("lists the uncooked days whose date is before today, in order", () => {
    const b = book("accepted", [
      { date: "2026-10-18", cookedAt: "x" },
      { date: "2026-10-19", cookedAt: null },
      { date: T, cookedAt: null },
    ]);
    expect(pastUncookedDays(b, T).map((d) => d.dayNumber)).toEqual([2]);
    expect(pastUncookedDays(book("cancelled", b.days), T)).toEqual([]);
  });

  it("a list row has all dates past only for an accepted booking", () => {
    expect(
      summaryAllDatesPast("accepted", ["2026-10-18", "2026-10-19"], T),
    ).toBe(true);
    expect(summaryAllDatesPast("accepted", ["2026-10-19", T], T)).toBe(false);
    expect(summaryAllDatesPast("completed", ["2026-10-18"], T)).toBe(false);
    expect(summaryAllDatesPast("accepted", [], T)).toBe(false);
  });

  it("chef no-show trial words follow D-37", () => {
    expect(chefNoShowTrialText(true, true)).toMatch(/counts as used/);
    expect(chefNoShowTrialText(true, false)).toMatch(/not used up/);
    expect(chefNoShowTrialText(false, true)).toBeNull();
    expect(chefNoShowTrialText(false, false)).toBeNull();
  });
});

describe("waiting for a check around Toronto midnight (T-072 tester)", () => {
  const b = (date: string) =>
    ({
      status: "accepted",
      days: [day({ dayNumber: 1, date, cookedAt: null })],
    }) as BookingDetail;
  const waitingAt = (iso: string, date: string) =>
    isWaitingForCheck(b(date), torontoToday(new Date(iso)));

  it("a last day of yesterday waits; a last day of today does not, using the Toronto date", () => {
    // 2026-10-14 23:30Z is 19:30 EDT: Toronto is still on the 14th (UTC is also the 14th).
    expect(waitingAt("2026-10-14T23:30:00Z", "2026-10-13")).toBe(true);
    expect(waitingAt("2026-10-14T23:30:00Z", "2026-10-14")).toBe(false);
    // 2026-10-15 03:59Z is 23:59 EDT on the 14th, though UTC says the 15th: the 14th is not past.
    expect(waitingAt("2026-10-15T03:59:00Z", "2026-10-14")).toBe(false);
    expect(waitingAt("2026-10-15T03:59:00Z", "2026-10-13")).toBe(true);
    // 04:00Z is Toronto midnight: the 14th is now yesterday.
    expect(waitingAt("2026-10-15T04:00:00Z", "2026-10-14")).toBe(true);
    expect(waitingAt("2026-10-15T04:00:00Z", "2026-10-15")).toBe(false);
  });

  it("holds across the November changeover (EST, UTC-5)", () => {
    // 2026-11-02 04:59Z is 23:59 EST on 1 Nov; 05:00Z is midnight on 2 Nov.
    expect(waitingAt("2026-11-02T04:59:00Z", "2026-11-01")).toBe(false);
    expect(waitingAt("2026-11-02T05:00:00Z", "2026-11-01")).toBe(true);
  });
});
