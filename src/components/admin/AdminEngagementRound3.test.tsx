// @vitest-environment jsdom
// T-049 round 3 (Tester): extra edge cases for the live-mode MOCK text, encoded ids and focus.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
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
afterEach(() => {
  h.cleanup();
  vi.unstubAllEnvs();
});

const EMPTY = json(200, { items: [], nextCursor: null });

describe("live mode has no MOCK text anywhere in the DOM", () => {
  const cases: [string, () => React.ReactElement, Record<string, unknown>][] = [
    [
      "bookings",
      () => <AdminBookingsView />,
      { "GET /api/admin/bookings?status=all": EMPTY },
    ],
    ["blocks", () => <AdminBlocksView />, { "GET /api/admin/blocks": EMPTY }],
    [
      "reports",
      () => <AdminReportsView />,
      { "GET /api/admin/reports?status=active": EMPTY },
    ],
  ];
  for (const [name, view, r] of cases) {
    it(name, async () => {
      vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
      routes(h.fetchMock, r as never);
      await h.mount(view());
      expect(document.body.innerHTML).not.toMatch(/made-up|mock/i);
      expect(h.qa("mock-badge")).toHaveLength(0);
      expect(h.qa("admin-mock-line")).toHaveLength(0);
    });
  }
  it("chat", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
    routes(h.fetchMock, {});
    await h.mount(<AdminChatView bookingId="abc" />);
    expect(document.body.innerHTML).not.toMatch(/made-up|mock/i);
  });
});

describe("reserved characters in the chat id", () => {
  it.each(["..%2F..", "../x", "a#b", "a b"])("encodes %s", async (bad) => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
    routes(h.fetchMock, {});
    await h.mount(<AdminChatView bookingId={bad} />);
    const urls = h.fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
    const hit = urls.find((u: string) => u.includes("/messages"));
    expect(hit).toBe(`/api/admin/bookings/${encodeURIComponent(bad)}/messages`);
    expect(callsTo(h.fetchMock, "/api/admin/bookings/../").length).toBe(0);
  });
});
