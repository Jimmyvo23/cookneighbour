/* eslint-disable @typescript-eslint/no-explicit-any -- the mock answers are untyped JSON */
import { describe, expect, it } from "vitest";
import type { MeProfile } from "@/lib/api/types";
import { seedChefBookings } from "@/lib/mocks/mock-booking-changes";
import {
  ADMIN_IDS,
  EMPTY_ENGAGEMENT,
  engagementRoute,
  type EngagementMockState,
  type EngagementState,
} from "@/lib/mocks/mock-reviews-reports";
import { MOCK_CHEFS } from "@/lib/mocks/mock-search";

const NOW = new Date("2026-10-20T15:00:00Z");
const DAY = 86_400_000;
const CHEF: MeProfile = {
  id: "mock-user-1",
  role: "chef",
  displayName: "Demo chef",
  country: "CA",
  currency: "CAD",
  language: "en",
};
const CUSTOMER: MeProfile = {
  ...CHEF,
  role: "customer",
  displayName: "Sam Customer",
};
const ADMIN: MeProfile = { ...CHEF, role: "admin", displayName: "Demo admin" };
const bid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function state(
  profile: MeProfile | null,
  over: {
    status?: "requested" | "accepted" | "completed" | "cancelled";
    completedAgoDays?: number;
    engagement?: EngagementState | null;
  } = {},
): EngagementMockState {
  const { rows } = seedChefBookings(CHEF, NOW);
  const mapped = rows.map((r) => ({
    ...r,
    detail: {
      ...r.detail,
      status: over.status ?? r.detail.status,
      completedAt:
        over.completedAgoDays === undefined
          ? r.detail.completedAt
          : new Date(NOW.getTime() - over.completedAgoDays * DAY).toISOString(),
    },
  }));
  return {
    profile,
    bookings: mapped,
    chefBookings: mapped,
    engagement: over.engagement ?? null,
  };
}

/** Runs one route and carries the saved engagement state forward, like the adapter does. */
function client(
  profile: MeProfile | null,
  over: Parameters<typeof state>[1] = {},
) {
  let s = state(profile, over);
  return {
    s: () => s,
    as(p: MeProfile) {
      s = { ...s, profile: p };
      return this;
    },
    async call(method: string, path: string, body?: unknown) {
      const r = engagementRoute(method, path, body ?? {}, s, NOW);
      if (!r) return { status: -1, data: null as unknown };
      if (r.next) s = { ...s, ...r.next };
      return { status: r.res.status, data: (await r.res.json()) as any };
    },
  };
}

describe("reviews", () => {
  const B = bid(9104);
  it("is not allowed before the booking is completed", async () => {
    const c = client(CHEF, { status: "accepted" });
    const r = await c.call("GET", `/api/bookings/${B}/reviews`);
    expect(r.status).toBe(200);
    expect(r.data.allowance).toEqual({
      allowed: false,
      reason: "not_completed",
      closesAt: null,
    });
    const p = await c.call("POST", `/api/bookings/${B}/reviews`, { rating: 5 });
    expect(p.status).toBe(409);
    expect(p.data.error.reason).toBe("not_completed");
  });

  it("is allowed after completion and closes 14 days later", async () => {
    const c = client(CHEF, { status: "completed", completedAgoDays: 2 });
    const r = await c.call("GET", `/api/bookings/${B}/reviews`);
    expect(r.data.allowance.allowed).toBe(true);
    expect(r.data.allowance.closesAt).toBe(
      new Date(NOW.getTime() - 2 * DAY + 14 * DAY).toISOString(),
    );
    const late = client(CHEF, { status: "completed", completedAgoDays: 15 });
    const l = await late.call("GET", `/api/bookings/${B}/reviews`);
    expect(l.data.allowance.reason).toBe("window_closed");
    const lp = await late.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 4,
    });
    expect(lp.status).toBe(409);
    expect(lp.data.error.reason).toBe("window_closed");
  });

  it("posts once, is final, and answers a retry with the same content", async () => {
    const c = client(CHEF, { status: "completed", completedAgoDays: 1 });
    const p = await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 4,
      comment: " Kind and neat ",
    });
    expect(p.status).toBe(201);
    expect(p.data).toMatchObject({
      rating: 4,
      comment: "Kind and neat",
      mine: true,
      authorRole: "chef",
    });
    const retry = await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 4,
      comment: "Kind and neat",
    });
    expect(retry.status).toBe(200);
    const edit = await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 1,
    });
    expect(edit.status).toBe(409);
    expect(edit.data.error.reason).toBe("already_reviewed");
    const g = await c.call("GET", `/api/bookings/${B}/reviews`);
    expect(g.data.allowance.reason).toBe("already_reviewed");
    expect(g.data.mine.id).toBe(p.data.id);
  });

  it("shows each party the other's review of them, and keeps the chef's out of the public list", async () => {
    const c = client(CHEF, { status: "completed", completedAgoDays: 1 });
    await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 3,
      comment: "Chef says",
    });
    const cust = await c.as(CUSTOMER).call("GET", `/api/bookings/${B}/reviews`);
    expect(cust.data.mine).toBeNull();
    expect(cust.data.other).toMatchObject({
      rating: 3,
      mine: false,
      authorRole: "chef",
    });
    const chefId = MOCK_CHEFS[0].id;
    const pub = await c
      .as(CUSTOMER)
      .call("GET", `/api/chefs/${chefId}/reviews?limit=50`);
    expect(JSON.stringify(pub.data)).not.toContain("Chef says");
  });

  it("checks the body: unknown keys, rating, comment length", async () => {
    const c = client(CHEF, { status: "completed", completedAgoDays: 1 });
    const post = (b: unknown) =>
      c.call("POST", `/api/bookings/${B}/reviews`, b);
    expect(
      (await post({ rating: 5, extra: 1 })).data.error.fields.extra,
    ).toBeTruthy();
    expect((await post({ rating: 6 })).data.error.fields.rating).toBeTruthy();
    expect((await post({ rating: 2.5 })).status).toBe(422);
    expect((await post({})).status).toBe(422);
    expect(
      (await post({ rating: 5, comment: "a".repeat(1001) })).data.error.fields
        .comment,
    ).toBeTruthy();
  });

  it("answers 404 for an unknown booking, 401 without a session and 403 for an admin", async () => {
    expect(
      (await client(CHEF).call("GET", `/api/bookings/${bid(1)}/reviews`))
        .status,
    ).toBe(404);
    expect(
      (await client(CHEF).call("GET", `/api/bookings/nope/reviews`)).status,
    ).toBe(404);
    expect(
      (await client(null).call("GET", `/api/bookings/${B}/reviews`)).status,
    ).toBe(401);
    expect(
      (await client(ADMIN).call("GET", `/api/bookings/${B}/reviews`)).status,
    ).toBe(403);
  });

  it("refuses contact details in a customer's comment with fields.comment, but not a chef's (v1.18)", async () => {
    const c = client(CUSTOMER, { status: "completed", completedAgoDays: 1 });
    const bad = await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 5,
      comment: "Call me on 416-555-0199",
    });
    expect(bad.status).toBe(422);
    expect(bad.data.error.code).toBe("CONTACT_DETAILS_NOT_ALLOWED");
    expect(bad.data.error.fields.comment).toBeTruthy();
    expect(c.s().engagement?.reviews ?? []).toHaveLength(0);
    const chef = client(CHEF, { status: "completed", completedAgoDays: 1 });
    const ok = await chef.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 4,
      comment: "Call me on 416-555-0199",
    });
    expect(ok.status).toBe(201);
  });

  it("sends ReviewView with exactly the contract keys (no chefId), in the POST and the GET", async () => {
    const KEYS = [
      "authorDisplayName",
      "authorRole",
      "bookingId",
      "comment",
      "createdAt",
      "id",
      "mine",
      "rating",
    ];
    const c = client(CUSTOMER, { status: "completed", completedAgoDays: 1 });
    const p = await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 5,
      comment: "Great",
    });
    expect(Object.keys(p.data).sort()).toEqual(KEYS);
    const g = await c.call("GET", `/api/bookings/${B}/reviews`);
    expect(Object.keys(g.data.mine).sort()).toEqual(KEYS);
  });

  it("puts a customer's review on the chef's public list with the first name only", async () => {
    const c = client(CUSTOMER, { status: "completed", completedAgoDays: 1 });
    const chefId = c.s().bookings.find((r) => r.detail.id === B)!.detail.chef
      .id;
    // The made-up chef of a seeded booking may not be one of the public MOCK chefs.
    await c.call("POST", `/api/bookings/${B}/reviews`, {
      rating: 5,
      comment: "Great",
    });
    const posted = c.s().engagement!.postedPublic[chefId][0];
    expect(posted.authorFirstName).toBe("Sam");
    expect(JSON.stringify(posted)).not.toContain("Customer");
    expect(Object.keys(posted).sort()).toEqual([
      "authorFirstName",
      "comment",
      "createdAt",
      "id",
      "rating",
    ]);
  });
});

describe("public chef reviews", () => {
  const chefId = MOCK_CHEFS[0].id;
  it("needs no session, pages, and sends no id of a person or booking", async () => {
    const c = client(null);
    const first = await c.call("GET", `/api/chefs/${chefId}/reviews?limit=10`);
    expect(first.status).toBe(200);
    expect(first.data.items).toHaveLength(10);
    expect(first.data.nextCursor).toBe("m10");
    for (const r of first.data.items) {
      expect(Object.keys(r).sort()).toEqual([
        "authorFirstName",
        "comment",
        "createdAt",
        "id",
        "rating",
      ]);
      expect(r.authorFirstName).not.toMatch(/\s/);
    }
    const rest = await c.call(
      "GET",
      `/api/chefs/${chefId}/reviews?limit=50&cursor=m10`,
    );
    expect(rest.data.items.length).toBe(14);
    expect(rest.data.nextCursor).toBeNull();
  });
  it("answers 404 for an unknown chef and 422 for a bad query", async () => {
    const c = client(null);
    expect((await c.call("GET", `/api/chefs/${bid(5)}/reviews`)).status).toBe(
      404,
    );
    expect(
      (await c.call("GET", `/api/chefs/${chefId}/reviews?limit=0`)).status,
    ).toBe(422);
    expect(
      (await c.call("GET", `/api/chefs/${chefId}/reviews?x=1`)).status,
    ).toBe(422);
  });
});

describe("problem reports", () => {
  const B = bid(9101); // a requested booking: reports are allowed in any status
  const CID = "11111111-1111-4111-8111-111111111111";
  const body = {
    clientId: CID,
    category: "safety",
    description: "Something was wrong",
  };

  it("can be filed on a booking in any status", async () => {
    const c = client(CUSTOMER, { status: "requested" });
    const r = await c.call("POST", `/api/bookings/${B}/reports`, body);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      status: "open",
      category: "safety",
      resolvedAt: null,
    });
    const done = client(CHEF, { status: "cancelled" });
    expect(
      (await done.call("POST", `/api/bookings/${B}/reports`, body)).status,
    ).toBe(201);
  });

  it("allows one open report per person: the server text, a retry and a reused id", async () => {
    const c = client(CUSTOMER);
    const a = await c.call("POST", `/api/bookings/${B}/reports`, body);
    const retry = await c.call("POST", `/api/bookings/${B}/reports`, body);
    expect(retry.status).toBe(200);
    expect(retry.data.id).toBe(a.data.id);
    const reused = await c.call("POST", `/api/bookings/${B}/reports`, {
      ...body,
      description: "Other",
    });
    expect(reused.data.error.reason).toBe("client_id_reused");
    const second = await c.call("POST", `/api/bookings/${B}/reports`, {
      ...body,
      clientId: "22222222-2222-4222-8222-222222222222",
    });
    expect(second.status).toBe(409);
    expect(second.data.error.reason).toBe("report_open");
    expect(second.data.error.message).toMatch(
      /already have a problem report open/,
    );
  });

  it("shows a person only their own reports; the other party sees none", async () => {
    const c = client(CUSTOMER);
    await c.call("POST", `/api/bookings/${B}/reports`, body);
    const mine = await c.call("GET", `/api/bookings/${B}/reports`);
    expect(mine.data.items).toHaveLength(1);
    const theirs = await c.as(CHEF).call("GET", `/api/bookings/${B}/reports`);
    expect(theirs.data).toEqual({ items: [] });
    // The chef may file their own on the same booking.
    const own = await c.call("POST", `/api/bookings/${B}/reports`, {
      ...body,
      clientId: "33333333-3333-4333-8333-333333333333",
    });
    expect(own.status).toBe(201);
    expect(
      (await c.call("GET", `/api/bookings/${B}/reports`)).data.items,
    ).toHaveLength(1);
  });

  it("never returns an admin note, a final status or a reporter", async () => {
    const c = client(CUSTOMER);
    const r = await c.call("POST", `/api/bookings/${B}/reports`, body);
    expect(Object.keys(r.data).sort()).toEqual([
      "bookingId",
      "category",
      "createdAt",
      "description",
      "id",
      "resolvedAt",
      "status",
    ]);
  });

  it("checks the body", async () => {
    const c = client(CUSTOMER);
    const post = (b: unknown) =>
      c.call("POST", `/api/bookings/${B}/reports`, b);
    expect(
      (await post({ ...body, description: " " })).data.error.fields.description,
    ).toBeTruthy();
    expect(
      (await post({ ...body, clientId: "ABC" })).data.error.fields.clientId,
    ).toBeTruthy();
    expect((await post({ ...body, category: "spam" })).status).toBe(422);
    expect((await post({ ...body, x: 1 })).data.error.fields.x).toBeTruthy();
    const noCat = await post({ clientId: CID, description: "Hi" });
    expect(noCat.data.category).toBe("other");
  });
});

describe("admin lists and decisions", () => {
  const admin = () => client(ADMIN);
  it("refuses everyone who is not an admin", async () => {
    for (const p of [CUSTOMER, CHEF]) {
      const c = client(p);
      for (const path of [
        "/api/admin/bookings",
        "/api/admin/reports",
        "/api/admin/free-trial-blocks",
      ])
        expect((await c.call("GET", path)).status).toBe(403);
    }
    expect((await client(null).call("GET", "/api/admin/reports")).status).toBe(
      401,
    );
  });

  it("pages the bookings and filters by status and open flag", async () => {
    const c = admin();
    const p1 = await c.call("GET", "/api/admin/bookings?limit=20");
    expect(p1.data.items).toHaveLength(20);
    expect(p1.data.nextCursor).toBe("m20");
    const p2 = await c.call("GET", "/api/admin/bookings?limit=20&cursor=m20");
    expect(p2.data.items.length).toBeGreaterThan(0);
    expect(p2.data.nextCursor).toBeNull();
    const flags = await c.call("GET", "/api/admin/bookings?flag=open");
    expect(flags.data.items.map((b: any) => b.flag.reason).sort()).toEqual([
      "chef_rejected",
      "no_day_cooked",
    ]);
    const cancelled = await c.call(
      "GET",
      "/api/admin/bookings?status=cancelled",
    );
    expect(cancelled.data.items).toHaveLength(1);
    expect(
      (await c.call("GET", "/api/admin/bookings?status=nope")).status,
    ).toBe(422);
  });

  it("lists active reports by default and carries no contact data", async () => {
    const c = admin();
    const r = await c.call("GET", "/api/admin/reports");
    expect(r.data.items.map((x: any) => x.status).sort()).toEqual([
      "open",
      "open",
      "reviewing",
    ]);
    expect(JSON.stringify(r.data)).not.toMatch(/phone|email|address/i);
    const all = await c.call("GET", "/api/admin/reports?status=all");
    expect(all.data.items).toHaveLength(4);
    expect(
      (await c.call("GET", "/api/admin/free-trial-blocks")).data.items,
    ).toHaveLength(3);
  });

  it("requires a final status to resolve a report on an accepted booking", async () => {
    const c = admin();
    const path = `/api/admin/reports/${ADMIN_IDS.firstReport}/resolve`;
    const none = await c.call("POST", path, { note: "Checked it" });
    expect(none.status).toBe(409);
    expect(none.data.error.reason).toBe("final_status_required");
    const short = await c.call("POST", path, {
      note: "ab",
      finalStatus: "cancelled",
    });
    expect(short.data.error.fields.note).toBeTruthy();
    const ok = await c.call("POST", path, {
      note: "Checked it",
      finalStatus: "cancelled",
    });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({
      booking: { status: "cancelled" },
      freeTrial: "released",
      decision: { kind: "report_resolved", finalStatus: "cancelled" },
    });
    // Decided once: a second answer is refused.
    const again = await c.call("POST", path, {
      note: "Checked it",
      finalStatus: "cancelled",
    });
    expect(again.data.error.reason).toBe("already_decided");
    const list = await c.call("GET", "/api/admin/bookings?status=cancelled");
    expect(list.data.items.map((b: any) => b.id)).toContain(
      ADMIN_IDS.acceptedWithReport,
    );
  });

  it("uses the shared free-trial rule for each final status", async () => {
    const run = async (final: string) => {
      const c = admin();
      const r = await c.call(
        "POST",
        `/api/admin/reports/${ADMIN_IDS.firstReport}/resolve`,
        {
          note: "Checked it",
          finalStatus: final,
        },
      );
      return r.data.freeTrial;
    };
    expect(await run("completed")).toBe("consumed");
    expect(await run("no_show_customer")).toBe("consumed");
    expect(await run("cancelled")).toBe("released"); // no day cooked
    expect(await run("no_show_chef")).toBe("released");
  });

  it("on a completed booking the status is optional and may be a cancel or a no-show (v1.18)", async () => {
    const path = `/api/admin/reports/${ADMIN_IDS.completedReport}/resolve`;
    const kept = await admin().call("POST", path, { note: "Checked it" });
    expect(kept.status).toBe(200);
    expect(kept.data.booking.status).toBe("completed");
    expect(kept.data.decision.finalStatus).toBeNull();
    const same = await admin().call("POST", path, {
      note: "Checked it",
      finalStatus: "completed",
    });
    expect(same.data.decision.finalStatus).toBeNull();
    const changed = await admin().call("POST", path, {
      note: "Checked it",
      finalStatus: "no_show_customer",
    });
    expect(changed.data.booking.status).toBe("no_show_customer");
    expect(changed.data.decision.finalStatus).toBe("no_show_customer");
  });

  it("moves the party's own copy of the booking too, and the reviews written stay", async () => {
    const c = admin();
    await c.call("GET", "/api/admin/reports");
    const a = c.s().engagement!.admin!;
    const bookingId = a.reports.find(
      (r) => r.id === ADMIN_IDS.completedReport,
    )!.bookingId;
    const base = c.s();
    const row = {
      ...base.bookings[0],
      detail: {
        ...base.bookings[0].detail,
        id: bookingId,
        status: "completed" as const,
      },
    };
    let s: EngagementMockState = {
      ...base,
      profile: ADMIN,
      bookings: [row],
      chefBookings: [row],
    };
    const r = engagementRoute(
      "POST",
      `/api/admin/reports/${ADMIN_IDS.completedReport}/resolve`,
      { note: "Checked it", finalStatus: "cancelled" },
      s,
      NOW,
    )!;
    expect(r.res.status).toBe(200);
    expect(r.next!.bookings![0].detail.status).toBe("cancelled");
    expect(r.next!.chefBookings![0].detail.status).toBe("cancelled");
    s = { ...s, ...r.next, profile: CUSTOMER };
    const got = engagementRoute(
      "GET",
      `/api/bookings/${bookingId}/reviews`,
      {},
      s,
      NOW,
    )!;
    expect(got.res.status).toBe(200);
  });

  it("refuses a status on a cancelled booking, but still closes the report", async () => {
    const c = admin();
    await c.call("GET", "/api/admin/reports");
    const a = c.s().engagement!.admin!;
    // MOCK: turn the seeded completed booking into a cancelled one.
    const rep = a.reports.find((r) => r.id === ADMIN_IDS.completedReport)!;
    a.bookings.find((x) => x.id === rep.bookingId)!.status = "cancelled";
    const path = `/api/admin/reports/${ADMIN_IDS.completedReport}/resolve`;
    const bad = await c.call("POST", path, {
      note: "Checked it",
      finalStatus: "no_show_chef",
    });
    expect(bad.data.error.reason).toBe("status_not_open");
    const ok = await c.call("POST", path, { note: "Checked it" });
    expect(ok.data.booking.status).toBe("cancelled");
  });

  it("dismisses without touching the booking", async () => {
    const c = admin();
    const d = await c.call(
      "POST",
      `/api/admin/reports/${ADMIN_IDS.reviewingReport}/dismiss`,
      {
        note: "Not a problem",
      },
    );
    expect(d.status).toBe(200);
    expect(d.data).toMatchObject({
      booking: { status: "accepted" },
      decision: { kind: "report_dismissed", finalStatus: null },
    });
    const x = await c.call(
      "POST",
      `/api/admin/reports/${ADMIN_IDS.reviewingReport}/dismiss`,
      {
        note: "Not a problem",
        finalStatus: "cancelled",
      },
    );
    expect(x.status).toBe(422);
  });

  it("resolves a flag with a final status and unfreezes", async () => {
    const c = admin();
    const path = `/api/admin/bookings/${ADMIN_IDS.flaggedRejected}/resolve-flag`;
    expect((await c.call("POST", path, { note: "Checked it" })).status).toBe(
      422,
    );
    const ok = await c.call("POST", path, {
      note: "Checked it",
      finalStatus: "cancelled",
    });
    expect(ok.status).toBe(200);
    expect(ok.data.freeTrial).toBe("consumed"); // a day was cooked
    const again = await c.call("POST", path, {
      note: "Checked it",
      finalStatus: "cancelled",
    });
    expect(again.data.error.reason).toBe("no_open_flag");
    const open = await c.call("GET", "/api/admin/bookings?flag=open");
    expect(open.data.items.map((b: any) => b.id)).not.toContain(
      ADMIN_IDS.flaggedRejected,
    );
  });

  it("reads a chat oldest first, read only, also for a hidden chat", async () => {
    const c = admin();
    const m = await c.call(
      "GET",
      `/api/admin/bookings/${ADMIN_IDS.acceptedWithReport}/messages`,
    );
    expect(m.data.items.map((x: any) => x.senderRole)).toEqual([
      "customer",
      "chef",
    ]);
    expect(
      (
        await c.call(
          "POST",
          `/api/admin/bookings/${ADMIN_IDS.acceptedWithReport}/messages`,
          {},
        )
      ).status,
    ).toBe(404);
    const hidden = await c.call(
      "GET",
      `/api/admin/bookings/${ADMIN_IDS.resolved}/messages`,
    );
    expect(hidden.data.items).toHaveLength(1);
    const big = await c.call(
      "GET",
      `/api/admin/bookings/${ADMIN_IDS.completedWithReport}/messages?limit=50`,
    );
    expect(big.data.items).toHaveLength(50);
    expect(big.data.nextCursor).toBe("m50");
    expect(
      (await c.call("GET", `/api/admin/bookings/${bid(1)}/messages`)).status,
    ).toBe(404);
  });

  it("answers a failure hook once", async () => {
    const c = admin();
    await c.call("GET", "/api/admin/reports");
    const s = c.s();
    const hooked = {
      ...s,
      engagement: { ...s.engagement!, hooks: { failNext: true } },
    };
    const r1 = engagementRoute(
      "POST",
      `/api/admin/reports/${ADMIN_IDS.firstReport}/dismiss`,
      { note: "Fine" },
      hooked,
      NOW,
    )!;
    expect(r1.res.status).toBe(500);
    const r2 = engagementRoute(
      "POST",
      `/api/admin/reports/${ADMIN_IDS.firstReport}/dismiss`,
      { note: "Fine" },
      { ...hooked, engagement: r1.next!.engagement },
      NOW,
    )!;
    expect(r2.res.status).toBe(200);
  });
});

it("EMPTY_ENGAGEMENT is not mutated by a read", () => {
  engagementRoute(
    "GET",
    "/api/admin/reports",
    {},
    { profile: ADMIN, bookings: [], engagement: null },
    NOW,
  );
  expect(EMPTY_ENGAGEMENT.admin).toBeNull();
});
