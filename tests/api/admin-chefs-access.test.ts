// T-035: who may use the admin chef-queue routes, and what the read routes return.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshLimits } from "./harness";
import {
  Browser,
  chefRow,
  kitchenPath,
  newChef,
  newCustomer,
  privRow,
  svc,
  upload,
  uuid,
  type Chef,
  type Reply,
} from "./chef-helpers";
import {
  approveOf,
  checksOf,
  detailOf,
  kitchenOf,
  listWith,
  newAdmin,
  rejectOf,
  submittedChef,
  withAdminClaims,
} from "./admin-helpers";

beforeEach(() => freshLimits());

type Call = [
  string,
  (id: string) => Parameters<Browser["call"]>[0],
  string,
  unknown,
];
const ROUTES: Call[] = [
  ["GET list", () => listWith(), "GET", undefined],
  ["GET detail", detailOf, "GET", undefined],
  ["POST approve", approveOf, "POST", {}],
  ["POST reject", rejectOf, "POST", { reason: "Not enough detail" }],
  ["PATCH checks", checksOf, "PATCH", { policeCheck: "verified" }],
  [
    "POST kitchen-review",
    kitchenOf,
    "POST",
    {
      decision: "reject",
      note: "Dirty",
      reviewedPhotoPaths: [],
      reviewedAddress: null,
    },
  ],
];

async function expectUntouched(id: string, status = "pending") {
  expect((await chefRow(id)).status).toBe(status);
  const p = await privRow(id);
  expect(p.police_check_status).toBe("not_started");
  expect(p.reject_reason).toBeNull();
  const n = await svc.from("notifications").select("id").eq("user_id", id);
  expect(n.data).toEqual([]);
}

describe("admin only (checked before any query)", () => {
  it("no session: 401 on every route", async () => {
    const chef = await newChef();
    for (const [name, h, method, body] of ROUTES) {
      const r = await new Browser().call(h(chef.id), { method, body });
      expect(r.status, name).toBe(401);
      expect(r.body.error.code).toBe("UNAUTHENTICATED");
      expect(r.headers.get("cache-control"), name).toBe("no-store");
    }
    await expectUntouched(chef.id);
  });

  it("customer and chef: 403 on every route, even for an id that does not exist", async () => {
    const chef = await newChef();
    for (const who of [await newCustomer(), await newChef("Other Chef")]) {
      for (const [name, h, method, body] of ROUTES) {
        for (const id of [chef.id, uuid(), "not-a-uuid"]) {
          const r = await who.b.call(h(id), { method, body });
          expect(r.status, `${name} ${id}`).toBe(403);
          expect(r.body.error.code).toBe("FORBIDDEN");
          expect(r.headers.get("cache-control")).toBe("no-store");
        }
      }
    }
    await expectUntouched(chef.id);
  });

  it("a customer or chef whose JWT metadata says 'admin' is still refused", async () => {
    const chef = await newChef();
    for (const who of [await newCustomer(), await newChef("Meta Chef")]) {
      const b = await withAdminClaims(who);
      for (const [name, h, method, body] of ROUTES) {
        const r = await b.call(h(chef.id), { method, body });
        expect(r.status, name).toBe(403);
      }
    }
    await expectUntouched(chef.id);
  });

  it("a real admin (profiles.role) works even when the metadata says customer", async () => {
    const admin = await newAdmin("customer");
    const r = await admin.b.call(listWith("status=all&limit=1"), {
      method: "GET",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("an admin with the content type missing gets 400 on the state-changing routes", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    for (const [name, h, method] of ROUTES.slice(2)) {
      const r = await admin.b.call(h(chef.id), {
        method,
        contentType: null,
        noBody: true,
      });
      expect(r.status, name).toBe(400);
    }
    await expectUntouched(chef.id);
  });

  it("an unknown or malformed chef id is 404 on every route", async () => {
    const admin = await newAdmin();
    for (const [name, h, method, body] of ROUTES.slice(1)) {
      for (const id of [uuid(), "not-a-uuid", "0".repeat(40)]) {
        const r = await admin.b.call(h(id), { method, body });
        expect(r.status, `${name} ${id}`).toBe(404);
        expect(r.body.error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("the 404 comes before body validation", async () => {
    const admin = await newAdmin();
    const r = await admin.b.call(rejectOf(uuid()), {
      body: { reason: "x" },
    });
    expect(r.status).toBe(404);
  });
});

describe("GET /api/admin/chefs", () => {
  async function ids(admin: Chef, qs: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | null = null;
    do {
      const r: Reply = await admin.b.call(
        listWith(`${qs}&limit=50${cursor ? `&cursor=${cursor}` : ""}`),
        { method: "GET" },
      );
      expect(r.status, r.text).toBe(200);
      out.push(...r.body.items.map((i: { id: string }) => i.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    return out;
  }

  it("defaults to pending; filters by status; 'all' has everyone; newest first", async () => {
    const admin = await newAdmin();
    const a = await newChef("List A");
    const b = await newChef("List B");
    const c = await newChef("List C");
    await svc
      .from("chefs")
      .update({ status: "approved" })
      .eq("profile_id", b.id);
    await svc
      .from("chefs")
      .update({ status: "rejected" })
      .eq("profile_id", c.id);

    const def = await admin.b.call(listWith(), { method: "GET" });
    expect(def.status, def.text).toBe(200);
    const pend = await ids(admin, "status=pending");
    expect(pend).toContain(a.id);
    expect(pend).not.toContain(b.id);
    expect(pend).not.toContain(c.id);
    expect(
      def.body.items.every((i: { status: string }) => i.status === "pending"),
    ).toBe(true);
    expect(await ids(admin, "status=approved")).toContain(b.id);
    expect(await ids(admin, "status=approved")).not.toContain(a.id);
    expect(await ids(admin, "status=rejected")).toContain(c.id);

    const all = await ids(admin, "status=all");
    for (const x of [a, b, c]) expect(all).toContain(x.id);
    // Newest first: created a, b, c in that order, so they appear c, b, a.
    expect(all.indexOf(c.id)).toBeLessThan(all.indexOf(b.id));
    expect(all.indexOf(b.id)).toBeLessThan(all.indexOf(a.id));
    expect(new Set(all).size).toBe(all.length); // no duplicates across pages
  });

  // D-21(a) (T-061)
  it("flags an approved chef with a failed MOCK check, and only that chef", async () => {
    const admin = await newAdmin();
    const bad = await newChef("Flag bad");
    const fine = await newChef("Flag fine");
    const pending = await newChef("Flag pending");
    for (const c of [bad, fine])
      await svc
        .from("chefs")
        .update({ status: "approved" })
        .eq("profile_id", c.id);
    await svc
      .from("chef_private")
      .update({ police_check_status: "failed" })
      .in("chef_id", [bad.id, pending.id]);
    const r = await admin.b.call(listWith("status=all&limit=50"), {
      method: "GET",
    });
    expect(r.status, r.text).toBe(200);
    const by = (id: string) =>
      r.body.items.find((i: { id: string }) => i.id === id);
    expect(by(bad.id)).toMatchObject({
      flagged: true,
      failedChecks: ["police"],
    });
    expect(by(fine.id)).toMatchObject({ flagged: false, failedChecks: [] });
    // A pending chef with a failed check is not flagged (the admin is still deciding).
    expect(by(pending.id)).toMatchObject({
      flagged: false,
      failedChecks: ["police"],
    });
  });

  it("paginates with an opaque cursor: no gaps, no repeats, nextCursor null at the end", async () => {
    const admin = await newAdmin();
    const made: Chef[] = [];
    for (let i = 0; i < 5; i++) made.push(await newChef(`Page ${i}`));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Reply = await admin.b.call(
        listWith(`status=all&limit=2${cursor ? `&cursor=${cursor}` : ""}`),
        { method: "GET" },
      );
      expect(r.status, r.text).toBe(200);
      expect(r.body.items.length).toBeLessThanOrEqual(2);
      if (r.body.nextCursor) expect(r.body.items).toHaveLength(2);
      seen.push(...r.body.items.map((i: { id: string }) => i.id));
      cursor = r.body.nextCursor;
      pages++;
      if (pages > 400) throw new Error("pagination does not end");
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    const total = await svc
      .from("chef_private")
      .select("chef_id", { count: "exact", head: true });
    expect(total.error).toBeNull();
    expect(seen.length).toBe(total.count);
    // The five new chefs come out in reverse creation order.
    const order = made.map((m) => seen.indexOf(m.id));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual([...order].reverse());
  });

  it("limit is 1 to 50; bad query values are 422 with the field name", async () => {
    const admin = await newAdmin();
    const one = await admin.b.call(listWith("status=all&limit=1"), {
      method: "GET",
    });
    expect(one.body.items).toHaveLength(1);
    expect(one.body.nextCursor).toEqual(expect.any(String));
    for (const [qs, field] of [
      ["status=banana", "status"],
      ["limit=0", "limit"],
      ["limit=51", "limit"],
      ["limit=abc", "limit"],
      ["checks=verified", "checks"],
      ["cursor=garbage", "cursor"],
      [
        `cursor=${Buffer.from(JSON.stringify({ t: "2026-01-01T00:00:00Z),status.eq.approved,(x", id: uuid() })).toString("base64url")}`,
        "cursor",
      ],
    ] as const) {
      const r = await admin.b.call(listWith(qs), { method: "GET" });
      expect(r.status, qs).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(r.body.error.fields, qs).toHaveProperty(field);
    }
  });

  it("checks=pending lists only chefs with an ID, food handler or kitchen check still pending", async () => {
    const admin = await newAdmin();
    const none = await newChef("No pending checks");
    const idp = await newChef("Pending ID");
    const fhp = await newChef("Pending FH");
    const kp = await newChef("Pending kitchen");
    const verified = await newChef("All verified");
    const set = (c: Chef, p: Record<string, string>) =>
      svc.from("chef_private").update(p).eq("chef_id", c.id);
    await set(idp, { id_check_status: "pending" });
    await set(fhp, { food_handler_status: "pending" });
    await set(kp, { kitchen_status: "pending" });
    await set(verified, {
      id_check_status: "verified",
      food_handler_status: "verified",
      kitchen_status: "verified",
      police_check_status: "pending", // the police check does not count
    });
    const got = await ids(admin, "status=all&checks=pending");
    for (const c of [idp, fhp, kp]) expect(got).toContain(c.id);
    for (const c of [none, verified]) expect(got).not.toContain(c.id);
    // Combined with a status filter.
    await svc
      .from("chefs")
      .update({ status: "approved" })
      .eq("profile_id", idp.id);
    const pendingOnly = await ids(admin, "status=pending&checks=pending");
    expect(pendingOnly).not.toContain(idp.id);
    expect(pendingOnly).toContain(fhp.id);
    // Pagination keeps the filter.
    const r: Reply = await admin.b.call(
      listWith("status=all&checks=pending&limit=1"),
      { method: "GET" },
    );
    expect(r.body.items).toHaveLength(1);
    expect(["pending"]).toContain(
      [
        r.body.items[0].checks.id,
        r.body.items[0].checks.foodHandler,
        r.body.items[0].checks.kitchen,
      ].find((x) => x === "pending"),
    );
  });

  it("items carry the summary and MOCK check statuses, and no private data", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef({ chefHome: true, name: "Summary Chef" });
    await svc
      .from("chef_private")
      .update({ police_check_status: "pending" })
      .eq("chef_id", chef.id);
    const all: Reply["body"][] = [];
    let cursor: string | null = null;
    do {
      const r: Reply = await admin.b.call(
        listWith(`status=pending&limit=50${cursor ? `&cursor=${cursor}` : ""}`),
        { method: "GET" },
      );
      all.push(...r.body.items);
      cursor = r.body.nextCursor;
    } while (cursor);
    const item = all.find((i) => i.id === chef.id);
    expect(item).toEqual({
      id: chef.id,
      displayName: "Summary Chef",
      status: "pending",
      cuisines: ["Vietnamese"],
      createdAt: expect.any(String),
      checks: {
        id: "pending",
        foodHandler: "pending",
        kitchen: "pending",
        police: "pending",
      },
      failedChecks: [],
      flagged: false,
      chefHomeEnabled: false,
      locationOptions: ["customer_home", "chef_home"],
    });
    const text = JSON.stringify(all);
    for (const secret of [
      "hash",
      "phone",
      "kitchen_address",
      "reject",
      "documents",
      chef.email,
    ])
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
  });
});

describe("GET /api/admin/chefs/:id", () => {
  it("returns the application, the email and 300-second signed links to the private files", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef({ chefHome: true, name: "Detail Chef" });
    const info = vi.spyOn(console, "info");
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const r = await admin.b.call(detailOf(chef.id), { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.email).toBe(chef.email);
    expect(r.body.application.displayName).toBe("Detail Chef");
    expect(r.body.application.status).toBe("pending");
    expect(r.body.application.checks).toEqual({
      id: "pending",
      foodHandler: "pending",
      kitchen: "pending",
      police: "not_started",
    });
    expect(r.body.application.missing).toEqual([]);

    const docs = r.body.documents as {
      kind: string;
      path: string;
      url: string;
      expiresInSeconds: number;
    }[];
    expect(docs.map((d) => d.kind).sort()).toEqual([
      "food_handler",
      "id_document",
      "kitchen_photo",
    ]);
    for (const d of docs) {
      expect(d.expiresInSeconds).toBe(300);
      expect(d.path.startsWith(`${chef.id}/`)).toBe(true);
      const bucket =
        d.kind === "kitchen_photo" ? "kitchen-photos" : "chef-documents";
      expect(d.url).toContain(`/${bucket}/${d.path}`);
      const token = new URL(d.url).searchParams.get("token")!;
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
      const left = claims.exp - Math.floor(Date.now() / 1000);
      expect(left).toBeGreaterThan(280);
      expect(left).toBeLessThanOrEqual(300);
      const file = await fetch(d.url);
      expect(file.status, d.kind).toBe(200);
      await file.arrayBuffer();
    }
    // Nothing about the links or the documents reached the server log.
    const logged = JSON.stringify([
      ...info.mock.calls,
      ...log.mock.calls,
      ...err.mock.calls,
      ...warn.mock.calls,
    ]);
    expect(logged).not.toContain("token=");
    expect(logged).not.toContain(chef.idp);
    vi.restoreAllMocks();
    // No hashes anywhere in the body.
    expect(
      JSON.stringify({ ...r.body, documents: [] }).toLowerCase(),
    ).not.toContain("hash");
  });

  it("never signs a stored path that is not one of our file names, or a file in the wrong bucket", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef({ chefHome: true });
    // A kitchen path whose object exists only in chef-documents (wrong bucket for a kitchen photo).
    const wrongBucket = kitchenPath(chef.id);
    await upload("chef-documents", wrongBucket);
    // A stored ID path with a profile-photo style name.
    const oddName = `${chef.id}/photo-${uuid()}.png`;
    await upload("profile-photos", oddName);
    const p = await privRow(chef.id);
    await svc
      .from("chef_private")
      .update({
        id_document_path: oddName,
        kitchen_photo_paths: [...p.kitchen_photo_paths, wrongBucket],
      })
      .eq("chef_id", chef.id);
    const r = await admin.b.call(detailOf(chef.id), { method: "GET" });
    expect(r.status, r.text).toBe(200);
    const paths = r.body.documents.map((d: { path: string }) => d.path);
    expect(paths).not.toContain(oddName);
    expect(paths).not.toContain(wrongBucket);
    expect(paths).toContain(chef.fhp);
    expect(paths).toContain(chef.kitchen);
    // The application still lists what is stored, so the admin can see something is off.
    expect(r.body.application.documents.idDocumentPath).toBe(oddName);
  });

  it("a chef with nothing uploaded has no documents; email is shown to the admin only", async () => {
    const admin = await newAdmin();
    const chef = await newChef("Empty Chef");
    const r = await admin.b.call(detailOf(chef.id), { method: "GET" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.documents).toEqual([]);
    expect(r.body.email).toBe(chef.email);
    expect(r.body.application.missing.length).toBeGreaterThan(0);
  });

  it("a signed-in customer id is not a chef application: 404", async () => {
    const admin = await newAdmin();
    const customer = await newCustomer();
    const r = await admin.b.call(detailOf(customer.id), { method: "GET" });
    expect(r.status).toBe(404);
  });
});
