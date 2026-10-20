// @vitest-environment jsdom
// T-049: admin lists, decisions and the read-only chat (contract 7D). Real fetch is stubbed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import type {
  AdminBookingItem,
  AdminDecisionResponse,
  AdminReportItem,
} from "@/lib/api/types";
import {
  AdminBlocksView,
  AdminBookingsView,
  AdminChatView,
  AdminReportsView,
} from "./AdminEngagementViews";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, name: string) => ({ id: id(n), displayName: name });

const report = (over: Partial<AdminReportItem> = {}): AdminReportItem => ({
  id: id(1),
  bookingId: id(2),
  category: "safety",
  description: "The kitchen was dirty",
  status: "open",
  createdAt: "2026-10-20T15:00:00.000Z",
  resolvedAt: null,
  reporter: { ...person(3, "Priya Patel"), role: "customer" },
  booking: {
    status: "accepted",
    firstDay: "2026-10-19",
    customer: person(3, "Priya Patel"),
    chef: person(4, "Lan Nguyen"),
    anyDayCooked: false,
    frozen: false,
  },
  decision: null,
  ...over,
});
const booking = (over: Partial<AdminBookingItem> = {}): AdminBookingItem => ({
  id: id(2),
  status: "accepted",
  locationType: "customer_home",
  groceryOption: "customer_buys",
  isFreeTrial: true,
  createdAt: "2026-10-18T15:00:00.000Z",
  firstDay: "2026-10-19",
  dates: ["2026-10-19"],
  totalCents: 9000,
  currency: "CAD",
  customer: person(3, "Priya Patel"),
  chef: person(4, "Lan Nguyen"),
  anyDayCooked: false,
  flag: null,
  openReportCount: 0,
  ...over,
});
const decision = (
  over: Partial<AdminDecisionResponse> = {},
): AdminDecisionResponse => ({
  reportId: id(1),
  booking: { id: id(2), status: "cancelled" },
  decision: {
    kind: "report_resolved",
    finalStatus: "cancelled",
    note: "ok",
    decidedAt: "2026-10-20T16:00:00.000Z",
  },
  freeTrial: "released",
  ...over,
});

const REPORTS = "GET /api/admin/reports?status=active";
const noteBox = () => h.host.querySelector("textarea") as HTMLTextAreaElement;
const statusSelect = () =>
  h.host.querySelector(
    "form[data-testid=decision-form] select",
  ) as HTMLSelectElement;
async function choose(el: HTMLSelectElement, value: string) {
  const { act } = await import("react");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("AdminReportsView", () => {
  it("lists reports with reporter, booking and the MOCK label", async () => {
    routes(h.fetchMock, {
      [REPORTS]: json(200, { items: [report()], nextCursor: null }),
    });
    await h.mount(<AdminReportsView />);
    expect(h.qa("admin-report")).toHaveLength(1);
    expect(h.text()).toMatch(/Safety/);
    expect(h.text()).toMatch(/The kitchen was dirty/);
    expect(h.text()).toMatch(/Priya Patel \(customer\)/);
    expect(h.qa("mock-badge").length).toBeGreaterThan(0);
  });

  it("asks for a status on an accepted booking and a note, and sends nothing until both are valid", async () => {
    routes(h.fetchMock, {
      [REPORTS]: json(200, { items: [report()], nextCursor: null }),
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Resolve/));
    await h.click(h.button("Confirm decision"));
    expect(
      callsTo(h.fetchMock, `/api/admin/reports/${id(1)}/resolve`),
    ).toHaveLength(0);
    expect(statusSelect().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(statusSelect());
    await choose(statusSelect(), "cancelled");
    expect(h.q("decision-effect")!.textContent).toMatch(
      /cancelled and its days are freed/,
    );
    await h.click(h.button("Confirm decision"));
    expect(noteBox().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(noteBox());
  });

  it("resolves with the final status and note, tells the result, and reloads", async () => {
    let posted: unknown;
    let loads = 0;
    routes(h.fetchMock, {
      [REPORTS]: () => {
        loads++;
        return json(200, {
          items: loads === 1 ? [report()] : [],
          nextCursor: null,
        })(null);
      },
      [`POST /api/admin/reports/${id(1)}/resolve`]: (b) => {
        posted = b;
        return json(200, decision())(null);
      },
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Resolve/));
    await choose(statusSelect(), "cancelled");
    await h.type(noteBox(), "  Checked the photos ");
    await h.click(h.button("Confirm decision"));
    expect(posted).toEqual({
      finalStatus: "cancelled",
      note: "Checked the photos",
    });
    expect(h.q("decision-result")!.textContent).toMatch(
      /Decision saved\. The booking is now: Cancelled\. The customer's free first booking was given back\./,
    );
    expect(h.q("decision-form")).toBeNull();
    expect(h.qa("admin-report")).toHaveLength(0);
  });

  it("sends no status when the booking is already finished", async () => {
    let posted: unknown;
    routes(h.fetchMock, {
      [REPORTS]: json(200, {
        items: [
          report({ booking: { ...report().booking, status: "cancelled" } }),
        ],
        nextCursor: null,
      }),
      [`POST /api/admin/reports/${id(1)}/resolve`]: (b) => {
        posted = b;
        return json(200, decision({ freeTrial: "none" }))(null);
      },
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Resolve/));
    expect(statusSelect()).toBeNull();
    await h.type(noteBox(), "Nothing to change");
    await h.click(h.button("Confirm decision"));
    expect(posted).toEqual({ note: "Nothing to change" });
  });

  it("on a completed booking offers an optional status and says what it does (v1.18)", async () => {
    let posted: unknown;
    routes(h.fetchMock, {
      [REPORTS]: json(200, {
        items: [
          report({ booking: { ...report().booking, status: "completed" } }),
        ],
        nextCursor: null,
      }),
      [`POST /api/admin/reports/${id(1)}/resolve`]: (b) => {
        posted = b;
        return json(200, decision({ freeTrial: "released" }))(null);
      },
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Resolve/));
    const sel = statusSelect()!;
    expect(sel.textContent).toMatch(/Keep it completed/);
    expect(sel.textContent).not.toMatch(/^Completed|>Completed</);
    await choose(sel, "cancelled");
    const effect = h.q("decision-effect")!.textContent!;
    expect(effect).toMatch(/Reviews already written stay/);
    expect(effect).toMatch(/free first booking/);
    await h.type(noteBox(), "Never happened");
    await h.click(h.button("Confirm decision"));
    expect(posted).toEqual({
      finalStatus: "cancelled",
      note: "Never happened",
    });
  });

  it("dismisses with a note only", async () => {
    let posted: unknown;
    routes(h.fetchMock, {
      [REPORTS]: json(200, { items: [report()], nextCursor: null }),
      [`POST /api/admin/reports/${id(1)}/dismiss`]: (b) => {
        posted = b;
        return json(
          200,
          decision({
            booking: { id: id(2), status: "accepted" },
            freeTrial: "held",
          }),
        )(null);
      },
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Dismiss/));
    expect(statusSelect()).toBeNull();
    await h.type(noteBox(), "Not a real problem");
    await h.click(h.button("Confirm decision"));
    expect(posted).toEqual({ note: "Not a real problem" });
  });

  it("shows an already-decided refusal in words and keeps the form", async () => {
    routes(h.fetchMock, {
      [REPORTS]: json(200, { items: [report()], nextCursor: null }),
      [`POST /api/admin/reports/${id(1)}/dismiss`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        {
          reason: "already_decided",
        },
      ),
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button(/^Dismiss/));
    await h.type(noteBox(), "Not a real problem");
    await h.click(h.button("Confirm decision"));
    expect(h.q("decision-error")!.textContent).toMatch(/already decided this/);
    expect(h.q("decision-form")).not.toBeNull();
    expect(document.activeElement).toBe(h.q("decision-error"));
  });

  it("shows a decided report's note to the admin and offers no buttons", async () => {
    routes(h.fetchMock, {
      "GET /api/admin/reports?status=all": json(200, {
        items: [
          report({
            status: "resolved",
            decision: decision().decision,
          }),
        ],
        nextCursor: null,
      }),
      [REPORTS]: json(200, { items: [], nextCursor: null }),
    });
    await h.mount(<AdminReportsView />);
    const sel = h.host.querySelector("select") as HTMLSelectElement;
    await choose(sel, "all");
    await h.flush();
    expect(h.q("report-decision")!.textContent).toMatch(
      /booking set to Cancelled/,
    );
    expect(h.button(/^Resolve/)).toBeNull();
  });

  it("shows the list error and moves focus to it", async () => {
    routes(h.fetchMock, { [REPORTS]: apiError(500, "INTERNAL", "Boom") });
    await h.mount(<AdminReportsView />);
    const alert = h.host.querySelector("[role=alert]")!;
    expect(alert.textContent).toMatch(/Boom/);
    expect(document.activeElement).toBe(alert);
  });

  it("loads the next page on request and does not repeat items", async () => {
    routes(h.fetchMock, {
      [REPORTS]: json(200, { items: [report()], nextCursor: "m1" }),
      [`${REPORTS}&cursor=m1`]: json(200, {
        items: [report(), report({ id: id(9) })],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminReportsView />);
    await h.click(h.button("Load more"));
    expect(h.qa("admin-report")).toHaveLength(2);
    expect(h.button("Load more")).toBeNull();
  });
});

describe("AdminBookingsView", () => {
  it("shows an open flag and resolves it with a status and a note", async () => {
    let posted: unknown;
    routes(h.fetchMock, {
      "GET /api/admin/bookings?status=all": json(200, {
        items: [
          booking({
            flag: {
              reason: "no_day_cooked",
              flaggedAt: "2026-10-20T10:00:00.000Z",
              resolvedAt: null,
            },
          }),
        ],
        nextCursor: null,
      }),
      [`POST /api/admin/bookings/${id(2)}/resolve-flag`]: (b) => {
        posted = b;
        return json(200, decision({ reportId: null }))(null);
      },
    });
    await h.mount(<AdminBookingsView />);
    expect(h.q("booking-flag")!.textContent).toMatch(
      /Open flag.*no day was marked as cooked/,
    );
    expect(h.text()).toMatch(/Free first booking/);
    await h.click(h.button(/^Resolve flag/));
    await h.click(h.button("Confirm decision"));
    expect(statusSelect().getAttribute("aria-invalid")).toBe("true");
    await choose(statusSelect(), "no_show_chef");
    await h.type(noteBox(), "The chef did not come");
    await h.click(h.button("Confirm decision"));
    expect(posted).toEqual({
      finalStatus: "no_show_chef",
      note: "The chef did not come",
    });
    expect(h.q("decision-result")).not.toBeNull();
  });

  it("filters by status and by open flag through the query", async () => {
    routes(h.fetchMock, {
      "GET /api/admin/bookings?status=all": json(200, {
        items: [booking()],
        nextCursor: null,
      }),
      "GET /api/admin/bookings?status=all&flag=open": json(200, {
        items: [],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminBookingsView />);
    await h.click(h.host.querySelector("input[type=checkbox]"));
    expect(h.q("list-count")!.textContent).toMatch(/No bookings match/);
  });

  it("links to the read-only chat, and a resolved flag has no button", async () => {
    routes(h.fetchMock, {
      "GET /api/admin/bookings?status=all": json(200, {
        items: [
          booking({
            flag: {
              reason: "chef_rejected",
              flaggedAt: "2026-10-20T10:00:00.000Z",
              resolvedAt: "2026-10-20T12:00:00.000Z",
            },
          }),
        ],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminBookingsView />);
    expect(h.button(/^Resolve flag/)).toBeNull();
    expect(h.q("booking-flag")!.textContent).toMatch(/Flag resolved/);
    expect(
      h.host.querySelector(`a[href="/admin/bookings/${id(2)}/chat"]`),
    ).not.toBeNull();
  });
});

describe("AdminBlocksView and AdminChatView", () => {
  it("explains each block rule to the admin", async () => {
    routes(h.fetchMock, {
      "GET /api/admin/free-trial-blocks": json(200, {
        items: [
          {
            id: id(5),
            customer: person(3, "Priya Patel"),
            reason: "phone",
            createdAt: "2026-10-20T10:00:00.000Z",
            attempts: 2,
          },
        ],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminBlocksView />);
    expect(h.text()).toMatch(/same verified phone number/);
    expect(h.text()).toMatch(/2 attempts/);
  });

  it("shows the chat read only, with no way to send", async () => {
    routes(h.fetchMock, {
      [`GET /api/admin/bookings/${id(2)}/messages`]: json(200, {
        items: [
          {
            id: id(6),
            bookingId: id(2),
            senderId: id(3),
            senderRole: "customer",
            senderName: "Priya Patel",
            clientId: null,
            body: "Hello chef",
            createdAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
    await h.mount(<AdminChatView bookingId={id(2)} />);
    expect(h.qa("admin-message")).toHaveLength(1);
    expect(h.text()).toMatch(/Read only\. Admins cannot send messages/);
    expect(h.host.querySelector("textarea, input[type=text]")).toBeNull();
    expect(h.button(/send/i)).toBeNull();
  });
});
