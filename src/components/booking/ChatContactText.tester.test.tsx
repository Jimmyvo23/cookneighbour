// @vitest-environment jsdom
// T-047 Tester: is the contact-window text honest about the chat? D-63 put "Chat stays open." in
// CONTACT_RULE, but D-94 hides the chat of a no-show booking. Every place the pages show contact-window
// text is checked per booking status against whether the chat is really on the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail, BookingStatus } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { torontoStartOfDay } from "@/lib/domain/cancellation";
import {
  CONTACT_ENDED_TEXT,
  CONTACT_LOCKED_TEXT,
  CONTACT_RULE,
} from "@/lib/booking/changes";
import {
  harness,
  json,
  routes,
  seededBooking,
  type Harness,
} from "@/components/booking/testkit";
import { ChefBookingView } from "@/components/booking/ChefBookingView";
import { BookingDetailView } from "@/components/booking/BookingDetailView";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const SAYS_OPEN = /Chat stays open/;

async function open(b: BookingDetail, role: "chef" | "customer") {
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}`]: json(200, b),
  });
  await h.mount(
    role === "chef" ? (
      <ChefBookingView id={b.id} />
    ) : (
      <BookingDetailView id={b.id} />
    ),
  );
}

/** A made-up booking (real seed shape) in `status`, with contact shown or already hidden. */
function make(
  role: "chef" | "customer",
  status: BookingStatus,
  hidden: boolean,
): BookingDetail {
  return seededBooking(9103, role, (b) => {
    const date = addDays(torontoToday(), hidden ? -9 : -1);
    const until = torontoStartOfDay(addDays(date, 8)).toISOString();
    return {
      ...b,
      status,
      days: [{ ...b.days[0], date }],
      contactVisibleUntil: hidden ? null : until,
      contact: hidden ? null : b.contact,
    };
  });
}

/** All contact-window sentences on the page. */
function windowTexts(): string {
  return [h.q("contact-window"), h.q("contact-later")]
    .map((e) => e?.textContent ?? "")
    .join(" | ");
}

describe.each(["customer", "chef"] as const)("%s page", (role) => {
  // Chat is on the page: the sentence is true.
  describe.each(["accepted", "completed"] as const)("%s", (status) => {
    it.each([
      ["contact shown (open window)", false],
      ["contact hidden after 7 days (ended)", true],
    ])("%s: chat is open and the text says so", async (_n, hidden) => {
      await open(make(role, status, hidden), role);
      expect(h.q("chat")).not.toBeNull();
      expect(windowTexts()).toMatch(SAYS_OPEN);
    });
  });

  // Chat is hidden: the page must not say it stays open.
  describe.each(["cancelled", "declined", "expired"] as const)(
    "%s",
    (status) => {
      it("chat is hidden and no contact text promises it", async () => {
        await open(make(role, status, true), role);
        expect(h.q("chat")).toBeNull();
        expect(windowTexts()).not.toMatch(SAYS_OPEN);
      });
    },
  );

  // Frozen: the chat is read only (D-93), so the text must not say it stays open.
  describe.each(["accepted", "completed"] as const)(
    "%s and frozen",
    (status) => {
      it.each([
        ["contact shown (open window)", false],
        ["contact hidden after 7 days (ended)", true],
      ])(
        "%s: chat is read only and the text does not promise it",
        async (_n, hidden) => {
          await open({ ...make(role, status, hidden), frozen: true }, role);
          expect(h.q("chat-frozen")).not.toBeNull();
          expect(windowTexts()).not.toMatch(SAYS_OPEN);
        },
      );
    },
  );

  it("requested: chat is open; no window text is shown yet", async () => {
    await open(make(role, "requested", true), role);
    expect(h.q("chat")).not.toBeNull();
    expect(h.q("contact-window")).toBeNull();
  });

  describe.each(["no_show_customer", "no_show_chef"] as const)(
    "%s",
    (status) => {
      it("ended (contact hidden): chat is hidden but the text says it stays open", async () => {
        await open(make(role, status, true), role);
        expect(h.q("chat")).toBeNull();
        expect(windowTexts()).not.toMatch(SAYS_OPEN);
      });
      it("open window (contact shown): chat is hidden but the text says it stays open", async () => {
        await open(make(role, status, false), role);
        expect(h.q("chat")).toBeNull();
        expect(windowTexts()).not.toMatch(SAYS_OPEN);
      });
    },
  );
});

describe("the constants", () => {
  it("CONTACT_LOCKED_TEXT (cancelled) stays free of the chat promise", () => {
    expect(CONTACT_LOCKED_TEXT).not.toMatch(SAYS_OPEN);
  });
  it("CONTACT_RULE and CONTACT_ENDED_TEXT carry it (D-63)", () => {
    expect(CONTACT_RULE).toMatch(SAYS_OPEN);
    expect(CONTACT_ENDED_TEXT).toMatch(SAYS_OPEN);
  });
});
