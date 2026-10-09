import { beforeEach, describe, expect, it } from "vitest";
import type {
  AdminChefDetail,
  AdminChefListResponse,
  ApiError,
} from "@/lib/api/types";
import { mockFetch, resetMockState } from "@/lib/mocks/mock-adapter";

// The MOCK admin routes follow the order of checks in docs/api-contract.md section 6.
const H = { "Content-Type": "application/json" };
async function call(method: string, path: string, body?: unknown) {
  const res = await mockFetch(path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
const LINH = "00000000-0000-4000-8000-000000000901";
const IVY = "00000000-0000-4000-8000-000000000902";
const VERA = "00000000-0000-4000-8000-000000000903";
const TUAN = "00000000-0000-4000-8000-000000000904";
const ROSA = "00000000-0000-4000-8000-000000000905";

const logInAdmin = () =>
  call("POST", "/api/auth/login", {
    email: "admin@example.com",
    password: "longenough1",
  });
const detail = async (id: string) =>
  (await call("GET", `/api/admin/chefs/${id}`)).data as AdminChefDetail;
const err = (r: { data: unknown }) => (r.data as ApiError).error;

beforeEach(() => resetMockState());

describe("MOCK admin: access", () => {
  it("needs a session", async () => {
    expect((await call("GET", "/api/admin/chefs")).status).toBe(401);
  });
  it("is for admins only, for every route and even unknown ids", async () => {
    await call("POST", "/api/auth/signup", {
      email: "c@example.com",
      password: "longenough1",
      role: "customer",
      displayName: "Cathy",
    });
    for (const [m, p] of [
      ["GET", "/api/admin/chefs"],
      ["GET", `/api/admin/chefs/${LINH}`],
      ["GET", "/api/admin/chefs/nope"],
      ["POST", `/api/admin/chefs/${LINH}/approve`],
      ["POST", `/api/admin/chefs/${LINH}/reject`],
      ["PATCH", `/api/admin/chefs/${LINH}/checks`],
      ["POST", `/api/admin/chefs/${LINH}/kitchen-review`],
    ] as const)
      expect((await call(m, p, {})).status, `${m} ${p}`).toBe(403);
  });
});

describe("MOCK admin: list", () => {
  it("defaults to pending, newest first, 20 per page, and pages with a cursor", async () => {
    await logInAdmin();
    const first = (await call("GET", "/api/admin/chefs"))
      .data as AdminChefListResponse;
    expect(first.items).toHaveLength(20);
    expect(first.items[0].displayName).toBe("Linh Nguyen");
    expect(first.items.every((i) => i.status === "pending")).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    const dates = first.items.map((i) => i.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    const second = (
      await call("GET", `/api/admin/chefs?cursor=${first.nextCursor}`)
    ).data as AdminChefListResponse;
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((i) => i.id));
    expect(ids.size).toBe(first.items.length + second.items.length);
  });
  it("filters by status and by checks pending (police ignored)", async () => {
    await logInAdmin();
    const rejected = (await call("GET", "/api/admin/chefs?status=rejected"))
      .data as AdminChefListResponse;
    expect(rejected.items.map((i) => i.id)).toEqual([ROSA]);
    const waiting = (
      await call("GET", "/api/admin/chefs?status=all&checks=pending")
    ).data as AdminChefListResponse;
    expect(waiting.items.map((i) => i.id).sort()).toEqual(
      [IVY, LINH, ROSA, VERA].sort(),
    );
  });
  it("rejects a bad query with 422 and a bad cursor", async () => {
    await logInAdmin();
    const a = await call("GET", "/api/admin/chefs?status=nope&limit=0");
    expect(a.status).toBe(422);
    expect(Object.keys(err(a).fields!)).toEqual(["status", "limit"]);
    const b = await call("GET", "/api/admin/chefs?cursor=abc");
    expect(b.status).toBe(422);
    expect(err(b).fields!.cursor).toBeTruthy();
  });
  it("lists no private fields", async () => {
    await logInAdmin();
    const raw = JSON.stringify(
      (await call("GET", "/api/admin/chefs?status=all")).data,
    );
    expect(raw).not.toMatch(/email|path|reason/i);
  });
});

describe("MOCK admin: detail", () => {
  it("404 for a non-uuid or unknown id", async () => {
    await logInAdmin();
    expect((await call("GET", "/api/admin/chefs/nope")).status).toBe(404);
    expect(
      (
        await call(
          "GET",
          "/api/admin/chefs/00000000-0000-4000-8000-000000000001",
        )
      ).status,
    ).toBe(404);
  });
  it("gives signed links for listed files and leaves out a vanished one", async () => {
    await logInAdmin();
    const linh = await detail(LINH);
    expect(linh.documents.map((d) => d.kind).sort()).toEqual([
      "food_handler",
      "id_document",
      "kitchen_photo",
      "kitchen_photo",
    ]);
    expect(linh.documents.every((d) => d.expiresInSeconds === 300)).toBe(true);
    const vera = await detail(VERA);
    expect(vera.application.documents.idDocumentPath).toBeTruthy();
    expect(vera.documents.map((d) => d.kind)).toEqual(["food_handler"]);
  });
});

describe("MOCK admin: approve", () => {
  it("404 before anything else, 409 for a chef that is not pending", async () => {
    await logInAdmin();
    expect((await call("POST", "/api/admin/chefs/nope/approve")).status).toBe(
      404,
    );
    const a = await call("POST", `/api/admin/chefs/${TUAN}/approve`);
    expect(a.status).toBe(409);
    expect(err(a).code).toBe("INVALID_STATE");
    const r = await call("POST", `/api/admin/chefs/${ROSA}/approve`);
    expect(err(r).message).toMatch(/rejected/);
  });
  it("lists what is missing for an incomplete application", async () => {
    await logInAdmin();
    const r = await call("POST", `/api/admin/chefs/${IVY}/approve`);
    expect(r.status).toBe(409);
    expect(err(r).code).toBe("APPLICATION_INCOMPLETE");
    expect(err(r).missing).toEqual(
      expect.arrayContaining([
        "bio",
        "foodHandler",
        "phoneVerified",
        "sampleDish",
      ]),
    );
  });
  it("names a vanished file as missing although the chef's own list is empty", async () => {
    await logInAdmin();
    expect((await detail(VERA)).application.missing).toEqual([]);
    const r = await call("POST", `/api/admin/chefs/${VERA}/approve`);
    expect(r.status).toBe(409);
    expect(err(r).missing).toEqual(["idDocument"]);
  });
  it("needs both checks verified, then approves", async () => {
    await logInAdmin();
    const no = await call("POST", `/api/admin/chefs/${LINH}/approve`);
    expect(no.status).toBe(409);
    expect(err(no).code).toBe("INVALID_STATE");
    const d = await detail(LINH);
    const ok = await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {
      idCheck: "verified",
      idDocumentPath: d.application.documents.idDocumentPath,
      foodHandlerCheck: "verified",
      foodHandlerPath: d.application.documents.foodHandlerPath,
    });
    expect(ok.status).toBe(200);
    const done = await call("POST", `/api/admin/chefs/${LINH}/approve`);
    expect(done.status).toBe(200);
    expect(done.data.application.status).toBe("approved");
    expect(done.data.application.rejectReason).toBeNull();
    expect(
      (await call("POST", `/api/admin/chefs/${LINH}/approve`)).status,
    ).toBe(409);
    // It left the default (pending) list.
    const pending = (await call("GET", "/api/admin/chefs"))
      .data as AdminChefListResponse;
    expect(pending.items.find((i) => i.id === LINH)).toBeUndefined();
  });
});

describe("MOCK admin: reject", () => {
  it("422 for a short, long or unsafe reason, and for unknown keys on their own", async () => {
    await logInAdmin();
    for (const reason of ["no", "x".repeat(501), "bad\u0000text"]) {
      const r = await call("POST", `/api/admin/chefs/${LINH}/reject`, {
        reason,
      });
      expect(r.status).toBe(422);
      expect(err(r).fields!.reason).toBeTruthy();
    }
    const u = await call("POST", `/api/admin/chefs/${LINH}/reject`, {
      reason: "x",
      extra: 1,
    });
    expect(Object.keys(err(u).fields!)).toEqual(["extra"]);
  });
  it("rejects with a reason, and 409 the second time", async () => {
    await logInAdmin();
    const r = await call("POST", `/api/admin/chefs/${LINH}/reject`, {
      reason: "  The ID is unreadable.  ",
    });
    expect(r.status).toBe(200);
    expect(r.data.application.status).toBe("rejected");
    expect(r.data.application.rejectReason).toBe("The ID is unreadable.");
    expect(
      (
        await call("POST", `/api/admin/chefs/${LINH}/reject`, {
          reason: "again ok",
        })
      ).status,
    ).toBe(409);
  });
  it("can reject an approved chef", async () => {
    await logInAdmin();
    const r = await call("POST", `/api/admin/chefs/${TUAN}/reject`, {
      reason: "Complaint.",
    });
    expect(r.status).toBe(200);
  });
});

describe("MOCK admin: checks", () => {
  it("needs at least one check, and a path with every ID or certificate check", async () => {
    await logInAdmin();
    expect(
      (await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {})).status,
    ).toBe(422);
    const a = await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {
      idCheck: "verified",
    });
    expect(err(a).fields!.idDocumentPath).toBeTruthy();
    const b = await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {
      policeCheck: "bogus",
    });
    expect(err(b).fields!.policeCheck).toBeTruthy();
  });
  it("saves nothing at all when a reviewed path is stale (409)", async () => {
    await logInAdmin();
    const d = await detail(LINH);
    const r = await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {
      idCheck: "verified",
      idDocumentPath: `${LINH}/id-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`,
      policeCheck: "verified",
    });
    expect(r.status).toBe(409);
    expect(err(r).code).toBe("INVALID_STATE");
    const after = await detail(LINH);
    expect(after.application.checks).toEqual(d.application.checks);
  });
  it("the police check needs no file", async () => {
    await logInAdmin();
    const r = await call("PATCH", `/api/admin/chefs/${LINH}/checks`, {
      policeCheck: "verified",
    });
    expect(r.status).toBe(200);
    expect(r.data.application.checks.police).toBe("verified");
  });
});

describe("MOCK admin: kitchen review", () => {
  const body = async (over: Record<string, unknown> = {}) => {
    const d = await detail(LINH);
    return {
      decision: "approve",
      reviewedPhotoPaths: d.application.documents.kitchenPhotoPaths,
      reviewedAddress: d.application.kitchenAddress,
      ...over,
    };
  };
  it("422 without the reviewed values, and a rejection needs a note", async () => {
    await logInAdmin();
    const a = await call("POST", `/api/admin/chefs/${LINH}/kitchen-review`, {
      decision: "approve",
    });
    expect(Object.keys(err(a).fields!)).toEqual([
      "reviewedPhotoPaths",
      "reviewedAddress",
    ]);
    const b = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      await body({ decision: "reject" }),
    );
    expect(err(b).fields!.note).toBeTruthy();
  });
  it("409 when the photos differ from the stored ones (set equality, order free)", async () => {
    await logInAdmin();
    const b = await body();
    const stale = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      {
        ...b,
        reviewedPhotoPaths: (b.reviewedPhotoPaths as string[]).slice(1),
      },
    );
    expect(stale.status).toBe(409);
    const reordered = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      {
        ...b,
        reviewedPhotoPaths: [...(b.reviewedPhotoPaths as string[])].reverse(),
      },
    );
    expect(reordered.status).toBe(200);
  });
  it("approving turns chef's home on; rejecting turns it off", async () => {
    await logInAdmin();
    const ok = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      await body(),
    );
    expect(ok.data.application.chefHomeEnabled).toBe(true);
    expect(ok.data.application.checks.kitchen).toBe("verified");
    const no = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      await body({ decision: "reject", note: "Photos are too dark." }),
    );
    expect(no.data.application.chefHomeEnabled).toBe(false);
    expect(no.data.application.checks.kitchen).toBe("failed");
  });
  it("accepts reviewedAddress null only when no address is stored", async () => {
    await logInAdmin();
    const r = await call(
      "POST",
      `/api/admin/chefs/${LINH}/kitchen-review`,
      await body({ reviewedAddress: null }),
    );
    expect(r.status).toBe(409);
    const ivy = await call("POST", `/api/admin/chefs/${IVY}/kitchen-review`, {
      decision: "approve",
      reviewedPhotoPaths: [],
      reviewedAddress: null,
    });
    expect(ivy.status).toBe(409);
    expect(err(ivy).message).toMatch(/does not offer/);
  });
});
