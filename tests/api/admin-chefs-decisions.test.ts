// T-035: approve and reject. The decision is one database transaction, so these tests check the
// rules, the races and the notifications. All ID, food-handler and kitchen "verified" statuses are
// MOCK outcomes recorded by an admin.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshLimits } from "./harness";
import {
  application,
  chefRow,
  idPath,
  newChef,
  postDoc,
  privRow,
  submit,
  svc,
  upload,
} from "./chef-helpers";
import { anonClient } from "./dish-helpers";
import {
  approvableChef,
  approveOf,
  checksOf,
  newAdmin,
  notificationsOf,
  rejectOf,
  submittedChef,
} from "./admin-helpers";

beforeEach(() => freshLimits());

async function broken<T>(
  table: string,
  keyColumn: string,
  id: string,
  patch: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const before = await svc
    .from(table)
    .select(Object.keys(patch).join(","))
    .eq(keyColumn, id)
    .single();
  expect(before.error).toBeNull();
  const upd = await svc.from(table).update(patch).eq(keyColumn, id);
  expect(upd.error).toBeNull();
  try {
    return await fn();
  } finally {
    await svc.from(table).update(before.data!).eq(keyColumn, id);
  }
}

describe("POST /api/admin/chefs/:id/approve", () => {
  it("approves a complete, verified, pending chef and tells the chef", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin, { name: "Happy Path" });
    await svc
      .from("chef_private")
      .update({ reject_reason: "old reason" })
      .eq("chef_id", chef.id);
    const info = vi.spyOn(console, "info");
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.application.status).toBe("approved");
    expect(r.body.application.rejectReason).toBeNull();
    expect(r.body.application.checks.id).toBe("verified"); // MOCK
    expect((await chefRow(chef.id)).status).toBe("approved");
    expect((await privRow(chef.id)).reject_reason).toBeNull();

    const n = await notificationsOf(chef.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      type: "chef_approved",
      title: "Your chef application was approved",
      booking_id: null,
      read_at: null,
    });
    // The log line names the admin and the chef and nothing else.
    const lines = info.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes(chef.id));
    expect(line).toContain(admin.id);
    expect(line).not.toContain(chef.email);
    vi.restoreAllMocks();
    // The chef sees it too, and a public (anonymous) read now finds the chef.
    expect((await application(chef.b)).status).toBe("approved");
    const pub = await anonClient()
      .from("chefs")
      .select("profile_id")
      .eq("profile_id", chef.id);
    expect(pub.data).toHaveLength(1);
  });

  it("does not switch on cooking at the chef's home (that is the kitchen review)", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin, { chefHome: true });
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(200);
    expect(r.body.application.chefHomeEnabled).toBe(false);
    expect((await privRow(chef.id)).kitchen_status).toBe("pending");
  });

  it("an incomplete application is 409 APPLICATION_INCOMPLETE with the same list the chef sees", async () => {
    const admin = await newAdmin();
    const chef = await newChef("Empty");
    const mine = (await application(chef.b)).missing as string[];
    expect(mine.length).toBeGreaterThan(5);
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("APPLICATION_INCOMPLETE");
    expect(r.body.error.missing).toEqual(mine);
    expect((await chefRow(chef.id)).status).toBe("pending");
    expect(await notificationsOf(chef.id)).toEqual([]);
  });

  const BREAKS: [string, string, string, Record<string, unknown>][] = [
    ["displayName", "chefs", "profile_id", { display_name: "New user" }],
    ["bio", "chefs", "profile_id", { bio: null }],
    ["photo", "chefs", "profile_id", { photo_path: null }],
    ["cuisines", "chefs", "profile_id", { cuisines: [] }],
    ["languages", "chefs", "profile_id", { languages: [] }],
    ["hourlyRate", "chefs", "profile_id", { hourly_rate_cents: null }],
    [
      "servicePostalPrefix",
      "chefs",
      "profile_id",
      { service_postal_prefix: null },
    ],
    ["idDocument", "chef_private", "chef_id", { id_document_path: null }],
    ["foodHandler", "chef_private", "chef_id", { food_handler_path: null }],
    [
      "allergenAcknowledgement",
      "chef_private",
      "chef_id",
      { allergen_ack_at: null },
    ],
    [
      "phoneVerified",
      "profile_private",
      "profile_id",
      { phone_verified: false },
    ],
    ["sampleDish", "dishes", "chef_id", { is_active: false }],
    [
      "kitchenAddress",
      "chef_private",
      "chef_id",
      { kitchen_address_line: null },
    ],
    ["kitchenPhotos", "chef_private", "chef_id", { kitchen_photo_paths: [] }],
    [
      "kitchenHygieneAcknowledgement",
      "chef_private",
      "chef_id",
      { kitchen_hygiene_ack_at: null },
    ],
  ];

  it("each rule refuses on its own, and the database list matches the TypeScript rules (computeMissing)", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin, { chefHome: true });
    for (const [item, table, key, patch] of BREAKS) {
      await broken(table, key, chef.id, patch, async () => {
        const r = await admin.b.call(approveOf(chef.id), {});
        expect(r.status, `${item}: ${r.text}`).toBe(409);
        expect(r.body.error.code, item).toBe("APPLICATION_INCOMPLETE");
        expect(r.body.error.missing, item).toEqual([item]);
        // Same answer as the chef's own application page (computeMissing).
        expect((await application(chef.b)).missing, item).toEqual([item]);
      });
    }
    // Everything restored: the chef is approvable again.
    const ok = await admin.b.call(approveOf(chef.id), {});
    expect(ok.status, ok.text).toBe(200);
  });

  it("everything broken at once: same items in the same order as computeMissing", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin, { chefHome: true });
    await svc
      .from("chefs")
      .update({
        display_name: "New user",
        bio: null,
        photo_path: null,
        cuisines: [],
        languages: [],
        hourly_rate_cents: null,
        service_postal_prefix: null,
      })
      .eq("profile_id", chef.id);
    await svc
      .from("chef_private")
      .update({
        id_document_path: null,
        food_handler_path: null,
        allergen_ack_at: null,
        kitchen_address_line: null,
        kitchen_photo_paths: [],
        kitchen_hygiene_ack_at: null,
      })
      .eq("chef_id", chef.id);
    await svc
      .from("profile_private")
      .update({ phone_verified: false })
      .eq("profile_id", chef.id);
    await svc
      .from("dishes")
      .update({ is_active: false })
      .eq("chef_id", chef.id);
    const mine = (await application(chef.b)).missing as string[];
    expect(mine).toHaveLength(15);
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status).toBe(409);
    expect(r.body.error.missing).toEqual(mine);
  });

  it("kitchen items are only required when chef's home is offered", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin); // customer's home only
    await svc
      .from("chef_private")
      .update({
        kitchen_address_line: null,
        kitchen_photo_paths: [],
        kitchen_hygiene_ack_at: null,
      })
      .eq("chef_id", chef.id);
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(200);
  });

  it("stored files must really exist: a missing ID file, photo, dish photo or kitchen photo is refused", async () => {
    const admin = await newAdmin();
    const cases: [
      string,
      string,
      (c: Awaited<ReturnType<typeof approvableChef>>) => Promise<unknown>,
    ][] = [
      [
        "idDocument",
        "chef-documents",
        async (c) => svc.storage.from("chef-documents").remove([c.idp]),
      ],
      [
        "foodHandler",
        "chef-documents",
        async (c) => svc.storage.from("chef-documents").remove([c.fhp]),
      ],
      [
        "photo",
        "profile-photos",
        async (c) => svc.storage.from("profile-photos").remove([c.photo]),
      ],
      [
        "kitchenPhotos",
        "kitchen-photos",
        async (c) => svc.storage.from("kitchen-photos").remove([c.kitchen!]),
      ],
      [
        "sampleDish",
        "dish-photos",
        async (c) => {
          const d = await svc
            .from("dishes")
            .select("photo_path")
            .eq("chef_id", c.id)
            .single();
          return svc.storage
            .from("dish-photos")
            .remove([d.data!.photo_path as string]);
        },
      ],
    ];
    for (const [item, , remove] of cases) {
      const chef = await approvableChef(admin, { chefHome: true });
      await remove(chef);
      const r = await admin.b.call(approveOf(chef.id), {});
      expect(r.status, `${item}: ${r.text}`).toBe(409);
      expect(r.body.error.code, item).toBe("APPLICATION_INCOMPLETE");
      expect(r.body.error.missing, item).toEqual([item]);
      expect((await chefRow(chef.id)).status).toBe("pending");
    }
  });

  it("both file checks must be verified: pending, failed and not_started are 409 INVALID_STATE", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    let r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect(r.body.error.message).toContain("ID and food handler");
    for (const status of ["failed", "not_started", "pending"]) {
      await svc
        .from("chef_private")
        .update({ id_check_status: "verified", food_handler_status: status })
        .eq("chef_id", chef.id);
      r = await admin.b.call(approveOf(chef.id), {});
      expect(r.status, status).toBe(409);
      expect(r.body.error.code).toBe("INVALID_STATE");
      expect(r.body.error.message).toContain("food handler");
      expect(r.body.error.message).not.toContain("ID and");
    }
    await svc
      .from("chef_private")
      .update({ id_check_status: "failed", food_handler_status: "verified" })
      .eq("chef_id", chef.id);
    r = await admin.b.call(approveOf(chef.id), {});
    expect(r.body.error.message).toMatch(/The ID check/);
    expect((await chefRow(chef.id)).status).toBe("pending");
    expect(await notificationsOf(chef.id)).toEqual([]);
  });

  it("only from pending: approved and rejected chefs are 409 INVALID_STATE", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    expect((await admin.b.call(approveOf(chef.id), {})).status).toBe(200);
    const again = await admin.b.call(approveOf(chef.id), {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_STATE");
    expect(await notificationsOf(chef.id)).toHaveLength(1);

    const rej = await approvableChef(admin);
    await svc
      .from("chefs")
      .update({ status: "rejected" })
      .eq("profile_id", rej.id);
    const r = await admin.b.call(approveOf(rej.id), {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect(r.body.error.message).toContain("submit it again");
  });

  it("a file swapped while pending cannot be approved (the check goes back to pending)", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    const oldPath = (await privRow(chef.id)).id_document_path as string;
    const swapped = idPath(chef.id);
    await upload("chef-documents", swapped);
    const reg = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: swapped },
    });
    expect(reg.status, reg.text).toBe(200);
    expect((await privRow(chef.id)).id_check_status).toBe("pending");

    let r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("INVALID_STATE");
    expect(r.body.error.message).toContain("ID");
    // The old verdict cannot be re-applied to the new file either.
    r = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: { idCheck: "verified", idDocumentPath: oldPath },
    });
    expect(r.status).toBe(409);
    // Reviewing the new file makes it approvable.
    r = await admin.b.call(checksOf(chef.id), {
      method: "PATCH",
      body: { idCheck: "verified", idDocumentPath: swapped },
    });
    expect(r.status, r.text).toBe(200);
    expect((await admin.b.call(approveOf(chef.id), {})).status).toBe(200);
  });

  it("a swap right after approval resets the check but the approval stands (accepted, N5)", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    expect((await admin.b.call(approveOf(chef.id), {})).status).toBe(200);
    const swapped = idPath(chef.id);
    await upload("chef-documents", swapped);
    const reg = await chef.b.call(postDoc, {
      body: { kind: "id_document", path: swapped },
    });
    expect(reg.status, reg.text).toBe(200);
    expect((await privRow(chef.id)).id_check_status).toBe("pending");
    expect((await chefRow(chef.id)).status).toBe("approved");
  });

  it("two approvals at once: one wins, one notification", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    const [a, b] = await Promise.all([
      admin.b.call(approveOf(chef.id), {}),
      admin.b.call(approveOf(chef.id), {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await notificationsOf(chef.id)).map((n) => n.type)).toEqual([
      "chef_approved",
    ]);
  });

  it("approve racing a file swap never leaves an approved chef with a verified check on a new file", async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 4; i++) {
      const chef = await approvableChef(admin);
      const oldPath = (await privRow(chef.id)).id_document_path as string;
      const swapped = idPath(chef.id);
      await upload("chef-documents", swapped);
      const [a, s] = await Promise.all([
        admin.b.call(approveOf(chef.id), {}),
        chef.b.call(postDoc, { body: { kind: "id_document", path: swapped } }),
      ]);
      expect([200, 409]).toContain(a.status);
      expect(s.status, s.text).toBe(200);
      const p = await privRow(chef.id);
      const c = await chefRow(chef.id);
      expect(p.id_document_path).toBe(swapped);
      if (c.status === "approved") {
        // Approved first, swapped after: the check was reset by the swap.
        expect(p.id_check_status, `round ${i}`).toBe("pending");
      } else {
        expect(a.status, `round ${i}`).toBe(409);
      }
      expect(oldPath).not.toBe(swapped);
    }
  });

  it("approve racing a reject: each outcome matches the notifications", async () => {
    const admin = await newAdmin();
    for (let i = 0; i < 3; i++) {
      const chef = await approvableChef(admin);
      const [a, r] = await Promise.all([
        admin.b.call(approveOf(chef.id), {}),
        admin.b.call(rejectOf(chef.id), {
          body: { reason: "Racing decision" },
        }),
      ]);
      expect([200, 409]).toContain(a.status);
      expect([200, 409]).toContain(r.status);
      expect(r.status, "reject from pending or approved always works").toBe(
        200,
      );
      const types = (await notificationsOf(chef.id)).map((n) => n.type);
      expect(types.filter((t) => t === "chef_rejected")).toHaveLength(1);
      expect(types.filter((t) => t === "chef_approved")).toHaveLength(
        a.status === 200 ? 1 : 0,
      );
      // Reject always ran last or alone, so the chef ends rejected.
      expect((await chefRow(chef.id)).status).toBe("rejected");
    }
  });
});

describe("POST /api/admin/chefs/:id/reject", () => {
  it("rejects a pending chef with a reason, notifies the chef and keeps the reason private to chef and admin", async () => {
    const admin = await newAdmin();
    const chef = await submittedChef();
    const info = vi.spyOn(console, "info");
    const r = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "  The certificate is unreadable.  " },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body.application.status).toBe("rejected");
    expect(r.body.application.rejectReason).toBe(
      "The certificate is unreadable.",
    );
    expect((await chefRow(chef.id)).status).toBe("rejected");
    const n = await notificationsOf(chef.id);
    expect(n).toEqual([
      {
        type: "chef_rejected",
        title: "Your chef application was not approved",
        body: "The certificate is unreadable.",
        booking_id: null,
        read_at: null,
      },
    ]);
    const mine = await application(chef.b);
    expect(mine.status).toBe("rejected");
    expect(mine.rejectReason).toBe("The certificate is unreadable.");
    // The log line has ids only, never the reason.
    const line = info.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes(chef.id));
    expect(line).toContain(admin.id);
    expect(line).not.toContain("certificate");
    vi.restoreAllMocks();
    // Never public.
    const pub = await anonClient()
      .from("chefs")
      .select("profile_id")
      .eq("profile_id", chef.id);
    expect(pub.data).toEqual([]);
  });

  it("rejecting an approved chef takes the chef out of public view at once", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    expect((await admin.b.call(approveOf(chef.id), {})).status).toBe(200);
    const anon = anonClient();
    expect(
      (await anon.from("chefs").select("profile_id").eq("profile_id", chef.id))
        .data,
    ).toHaveLength(1);
    const r = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "Complaint upheld" },
    });
    expect(r.status, r.text).toBe(200);
    expect(
      (await anon.from("chefs").select("profile_id").eq("profile_id", chef.id))
        .data,
    ).toEqual([]);
    expect((await notificationsOf(chef.id)).map((n) => n.type)).toEqual([
      "chef_approved",
      "chef_rejected",
    ]);
  });

  it("an already rejected chef is 409 INVALID_STATE and nothing changes", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    expect(
      (
        await admin.b.call(rejectOf(chef.id), {
          body: { reason: "First reason" },
        })
      ).status,
    ).toBe(200);
    const again = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "Second reason" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_STATE");
    expect((await privRow(chef.id)).reject_reason).toBe("First reason");
    expect(await notificationsOf(chef.id)).toHaveLength(1);
  });

  it("the reason is 3 to 500 characters of safe text (422 on fields.reason, nothing saved)", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    const bad: unknown[] = [
      undefined,
      null,
      42,
      "",
      "  ab ",
      "a".repeat(501),
      "bad\u0000reason",
      "tab\there",
      "lone \ud800 surrogate",
    ];
    for (const reason of bad) {
      const r = await admin.b.call(rejectOf(chef.id), { body: { reason } });
      expect(r.status, JSON.stringify(reason)).toBe(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(r.body.error.fields).toHaveProperty("reason");
    }
    const unknown = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "Fine reason", status: "approved" },
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.fields).toEqual({ status: "Unknown field." });
    expect((await chefRow(chef.id)).status).toBe("pending");
    expect(await notificationsOf(chef.id)).toEqual([]);
    // The limits themselves are allowed.
    const ok = await admin.b.call(rejectOf(chef.id), {
      body: { reason: "a".repeat(500) },
    });
    expect(ok.status, ok.text).toBe(200);
  });

  it("malformed JSON and a wrong content type are 400", async () => {
    const admin = await newAdmin();
    const chef = await newChef();
    let r = await admin.b.call(rejectOf(chef.id), { raw: "{nope" });
    expect(r.status).toBe(400);
    r = await admin.b.call(rejectOf(chef.id), {
      contentType: "text/plain",
      body: { reason: "Fine reason" },
    });
    expect(r.status).toBe(400);
    r = await admin.b.call(rejectOf(chef.id), { raw: "[1]" });
    expect(r.status).toBe(400);
  });

  it("a rejected chef can fix the application and submit again, then be approved", async () => {
    const admin = await newAdmin();
    const chef = await approvableChef(admin);
    expect(
      (
        await admin.b.call(rejectOf(chef.id), {
          body: { reason: "Please add a bio" },
        })
      ).status,
    ).toBe(200);
    const s = await chef.b.call(submit, { body: {} });
    expect(s.status, s.text).toBe(200);
    expect(s.body.application.status).toBe("pending");
    expect(s.body.application.rejectReason).toBeNull();
    const r = await admin.b.call(approveOf(chef.id), {});
    expect(r.status, r.text).toBe(200); // checks stayed verified: nothing was swapped
  });
});
