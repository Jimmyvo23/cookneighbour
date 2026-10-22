// @vitest-environment jsdom
// T-107 Tester: per-row attempts on the admin free-trial blocks list (UI, MOCK data, contract shape, axe).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import {
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import type { AdminFreeTrialBlock, MeProfile } from "@/lib/api/types";
import { formatWhen } from "@/lib/admin/queue";
import {
  engagementRoute,
  type EngagementMockState,
} from "@/lib/mocks/mock-reviews-reports";
import { AdminBlocksView } from "./AdminEngagementViews";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => {
  h.cleanup();
});

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const who = (n: number, name: string) => ({ id: id(n), displayName: name });
const row = (
  n: number,
  customer: number,
  name: string,
  reason: AdminFreeTrialBlock["reason"],
  attempts: number,
  createdAt: string,
): AdminFreeTrialBlock => ({
  id: id(n),
  customer: who(customer, name),
  reason,
  createdAt,
  attempts,
});
const serve = (items: AdminFreeTrialBlock[]) =>
  routes(h.fetchMock, {
    "GET /api/admin/free-trial-blocks": json(200, { items, nextCursor: null }),
  });
const lines = () =>
  h.qa("admin-block").map((el) => el.querySelector("p.text-sm")!.textContent!);

describe("T-107 tester: AdminBlocksView per-row attempts", () => {
  it("shows each row's own count for same customer+rule, other rules and other customers", async () => {
    serve([
      row(1, 3, "Priya Patel", "address", 4, "2026-10-20T11:00:00.000Z"),
      row(2, 3, "Priya Patel", "address", 3, "2026-10-20T09:00:00.000Z"),
      row(3, 3, "Priya Patel", "phone", 2, "2026-10-20T08:00:00.000Z"),
      row(4, 5, "Sam Lee", "address", 1, "2026-10-20T07:00:00.000Z"),
      row(5, 5, "Sam Lee", "customer", 9, "2026-10-19T07:00:00.000Z"),
    ]);
    await h.mount(<AdminBlocksView />);
    const l = lines();
    expect(l).toHaveLength(5);
    expect(l.map((t) => t.match(/^(\d+) /)![1])).toEqual([
      "4",
      "3",
      "2",
      "1",
      "9",
    ]);
    expect(h.text()).not.toMatch(/\b7 attempts|\b10 attempts|\b12 attempts/);
  });

  it("uses singular for 1 and plural otherwise", async () => {
    serve([
      row(1, 3, "A One", "phone", 1, "2026-10-20T11:00:00.000Z"),
      row(2, 4, "B Two", "phone", 2, "2026-10-20T11:00:00.000Z"),
      row(3, 5, "C Ten", "phone", 10, "2026-10-20T11:00:00.000Z"),
    ]);
    await h.mount(<AdminBlocksView />);
    const l = lines();
    expect(l[0]).toMatch(/^1 attempt, first on /);
    expect(l[1]).toMatch(/^2 attempts, first on /);
    expect(l[2]).toMatch(/^10 attempts, first on /);
    expect(l[0]).not.toMatch(/attempts/);
  });

  it("'first on' carries the row's createdAt in Toronto time, never 'last on'", async () => {
    // 2026-10-20T01:30Z is still 19 Oct 21:30 in Toronto (EDT): a UTC-formatted date would be wrong.
    const at = "2026-10-20T01:30:00.000Z";
    serve([row(1, 3, "Priya Patel", "address", 2, at)]);
    await h.mount(<AdminBlocksView />);
    const t = lines()[0];
    expect(t).toBe(`2 attempts, first on ${formatWhen(at)}`);
    expect(formatWhen(at)).toMatch(/Oct 19, 2026/);
    expect(t).toMatch(/9:30/);
    expect(h.text()).not.toMatch(/last on/i);
  });

  it("MOCK data: every row shows its own mock counter and 'first on' (agrees with the API shape)", async () => {
    const NOW = new Date("2026-10-20T15:00:00Z");
    const admin: MeProfile = {
      id: "mock-user-1",
      role: "admin",
      displayName: "Demo admin",
      country: "CA",
      currency: "CAD",
      language: "en",
    };
    const st = {
      profile: admin,
      engagement: null,
    } as unknown as EngagementMockState;
    const res = engagementRoute(
      "GET",
      "/api/admin/free-trial-blocks",
      {},
      st,
      NOW,
    );
    const body = (await res!.res.json()) as {
      items: AdminFreeTrialBlock[];
      nextCursor: string | null;
    };
    expect(body.items.length).toBeGreaterThan(0);
    for (const b of body.items)
      expect(Object.keys(b).sort()).toEqual(
        ["attempts", "createdAt", "customer", "id", "reason"].sort(),
      );
    serve(body.items);
    await h.mount(<AdminBlocksView />);
    const l = lines();
    expect(l).toHaveLength(body.items.length);
    body.items.forEach((b, i) =>
      expect(l[i]).toBe(
        `${b.attempts} ${b.attempts === 1 ? "attempt" : "attempts"}, first on ${formatWhen(b.createdAt)}`,
      ),
    );
    expect(h.text()).not.toMatch(/last on/i);
  });

  it("has no axe violations (jsdom; colour contrast needs a real browser)", async () => {
    serve([
      row(1, 3, "Priya Patel", "address", 4, "2026-10-20T11:00:00.000Z"),
      row(2, 3, "Priya Patel", "address", 1, "2026-10-20T09:00:00.000Z"),
    ]);
    await h.mount(<AdminBlocksView />);
    const r = await axe.run(h.host, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

void vi;
