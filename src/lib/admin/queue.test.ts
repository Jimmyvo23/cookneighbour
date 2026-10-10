import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import type {
  AdminChefListItem,
  ChefApplication,
  SignedDocumentUrl,
} from "@/lib/api/types";
import {
  buildChecksBody,
  buildKitchenBody,
  describeAdminError,
  filesSignature,
  foodHandlerRow,
  idRow,
  isImagePath,
  kitchenRows,
  linksNeedRefresh,
  listPath,
  mergeItems,
  reasonProblem,
  refreshDelayMs,
} from "@/lib/admin/queue";

const CHEF = "00000000-0000-4000-8000-000000000901";
function app(over: Partial<ChefApplication> = {}): ChefApplication {
  return {
    status: "pending",
    displayName: "Linh",
    bio: "Bio",
    photoPath: `${CHEF}/photo-x.png`,
    cuisines: ["Vietnamese"],
    languages: ["English"],
    hourlyRateCents: 2800,
    servicePostalPrefix: "L5B",
    serviceRadiusKm: 20,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: false,
    country: "CA",
    currency: "CAD",
    language: "en",
    rejectReason: null,
    checks: {
      id: "pending",
      foodHandler: "pending",
      kitchen: "pending",
      police: "not_started",
    },
    documents: {
      idDocumentPath: `${CHEF}/id-a.png`,
      foodHandlerPath: `${CHEF}/food-handler-a.pdf`,
      kitchenPhotoPaths: [`${CHEF}/kitchen-a.png`, `${CHEF}/kitchen-b.png`],
    },
    kitchenAddress: {
      line: "1 Fictional Street",
      city: "Mississauga",
      postalCode: "L5B1A1",
    },
    allergenAckAt: null,
    kitchenHygieneAckAt: null,
    missing: [],
    ...over,
  };
}
const url = (
  kind: SignedDocumentUrl["kind"],
  path: string,
): SignedDocumentUrl => ({
  kind,
  path,
  url: `https://files.example/${path}`,
  expiresInSeconds: 300,
});
const ALL = (a: ChefApplication) => [
  url("id_document", a.documents.idDocumentPath!),
  url("food_handler", a.documents.foodHandlerPath!),
  ...a.documents.kitchenPhotoPaths.map((p) => url("kitchen_photo", p)),
];

describe("listPath", () => {
  it("defaults to the first pending page of 20", () => {
    expect(listPath({ status: "pending", checksPending: false })).toBe(
      "/api/admin/chefs?status=pending&limit=20",
    );
  });
  it("adds checks=pending and the cursor", () => {
    expect(listPath({ status: "all", checksPending: true }, "abc_-")).toBe(
      "/api/admin/chefs?status=all&limit=20&checks=pending&cursor=abc_-",
    );
  });
  it("encodes a cursor", () => {
    expect(listPath({ status: "all", checksPending: false }, "a&b")).toContain(
      "cursor=a%26b",
    );
  });
});

describe("mergeItems", () => {
  const item = (id: string): AdminChefListItem => ({
    id,
    displayName: id,
    status: "pending",
    cuisines: [],
    createdAt: "2026-10-01T00:00:00Z",
    checks: app().checks,
    failedChecks: [],
    flagged: false,
    chefHomeEnabled: false,
    locationOptions: ["customer_home"],
  });
  it("appends new chefs and never shows one twice", () => {
    expect(
      mergeItems([item("a"), item("b")], [item("b"), item("c")]).map(
        (i) => i.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("describeAdminError", () => {
  const e = (code: ApiClientError["code"], message = "m", extra = {}) =>
    new ApiClientError(409, code, message, extra);
  it("explains missing items in plain words, including a vanished file", () => {
    const t = describeAdminError(
      e("APPLICATION_INCOMPLETE", "x", { missing: ["bio", "idDocument"] }),
      "approve",
    );
    expect(t).toContain("the bio");
    expect(t).toContain("the government ID file");
    expect(t).toMatch(/vanished from storage/);
    expect(t).not.toContain("idDocument");
  });
  it("does not mention storage when only non-file items are missing", () => {
    expect(
      describeAdminError(
        e("APPLICATION_INCOMPLETE", "x", { missing: ["bio"] }),
        "approve",
      ),
    ).not.toMatch(/storage/);
  });
  it("tells the admin to reload on INVALID_STATE and that nothing was saved", () => {
    const t = describeAdminError(
      e("INVALID_STATE", "The ID check is not verified."),
      "approve",
    );
    expect(t).toContain("The ID check is not verified.");
    expect(t).toMatch(/Nothing was saved/);
    expect(t).toMatch(/Reload this application/);
  });
  it("covers the other codes", () => {
    expect(describeAdminError(e("NOT_FOUND"))).toMatch(/no longer exists/);
    expect(describeAdminError(e("FORBIDDEN"))).toMatch(/Only admins/);
    expect(describeAdminError(e("UNAUTHENTICATED"))).toMatch(/Log in again/);
    expect(
      describeAdminError(
        new ApiClientError(422, "VALIDATION_FAILED", "Check.", {
          fields: { reason: "Too short." },
        }),
      ),
    ).toBe("Check. Too short.");
    expect(describeAdminError(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("reasonProblem (the server's shared rule)", () => {
  it("accepts 3 to 500 characters after trimming", () => {
    expect(reasonProblem("abc")).toBeNull();
    expect(reasonProblem("  abc  ")).toBeNull();
    expect(reasonProblem("x".repeat(500))).toBeNull();
  });
  it("refuses too short, too long and blank", () => {
    expect(reasonProblem("ab")).toBeTruthy();
    expect(reasonProblem("   ")).toBeTruthy();
    expect(reasonProblem("x".repeat(501))).toBeTruthy();
  });
  it("refuses control characters and lone surrogates", () => {
    expect(reasonProblem("bad\u0000text")).toMatch(/invalid characters/);
    expect(reasonProblem("bad\u0007text")).toBeTruthy();
    expect(reasonProblem("lone \ud800 surrogate")).toBeTruthy();
  });
  it("allows ordinary punctuation and emoji", () => {
    expect(reasonProblem("Blurry <ID>, retake it \u{1F642}")).toBeNull();
  });
  it("names the key it was asked about", () => {
    expect(reasonProblem("a", "note")).toBeTruthy();
  });
});

describe("document rows", () => {
  it("matches a link by kind and path", () => {
    const a = app();
    expect(idRow(a, ALL(a))!.url).toContain("id-a.png");
    expect(foodHandlerRow(a, ALL(a))!.url).toContain("food-handler-a.pdf");
    expect(kitchenRows(a, ALL(a)).map((r) => r.label)).toEqual([
      "Kitchen photo 1",
      "Kitchen photo 2",
    ]);
  });
  it("a listed file with no link has url null", () => {
    const a = app();
    const docs = ALL(a).filter((d) => d.kind !== "id_document");
    expect(idRow(a, docs)!.url).toBeNull();
  });
  it("a link for the wrong kind does not match", () => {
    const a = app();
    expect(
      idRow(a, [url("food_handler", a.documents.idDocumentPath!)])!.url,
    ).toBeNull();
  });
  it("no path, no row", () => {
    const a = app({
      documents: {
        idDocumentPath: null,
        foodHandlerPath: null,
        kitchenPhotoPaths: [],
      },
    });
    expect(idRow(a, [])).toBeNull();
    expect(foodHandlerRow(a, [])).toBeNull();
    expect(kitchenRows(a, [])).toEqual([]);
  });
  it("recognises images by extension", () => {
    expect(isImagePath("a/b.PNG")).toBe(true);
    expect(isImagePath("a/b.jpeg")).toBe(true);
    expect(isImagePath("a/b.pdf")).toBe(false);
  });
});

describe("signed link refresh", () => {
  it("refreshes a minute before the 300 seconds are up", () => {
    expect(linksNeedRefresh(0, 239_000)).toBe(false);
    expect(linksNeedRefresh(0, 240_000)).toBe(true);
    expect(linksNeedRefresh(0, 600_000)).toBe(true);
  });
  it("delay follows what the server said, never below 30 seconds", () => {
    expect(refreshDelayMs([url("id_document", "a")])).toBe(240_000);
    expect(refreshDelayMs([])).toBe(240_000);
    expect(
      refreshDelayMs([{ ...url("id_document", "a"), expiresInSeconds: 20 }]),
    ).toBe(30_000);
  });
});

describe("filesSignature", () => {
  it("changes when a file, a kitchen photo or the address changes, not when the order does", () => {
    const a = app();
    const same = app({
      documents: {
        ...a.documents,
        kitchenPhotoPaths: [...a.documents.kitchenPhotoPaths].reverse(),
      },
    });
    expect(filesSignature(same)).toBe(filesSignature(a));
    expect(
      filesSignature(
        app({
          documents: { ...a.documents, idDocumentPath: `${CHEF}/id-b.png` },
        }),
      ),
    ).not.toBe(filesSignature(a));
    expect(filesSignature(app({ kitchenAddress: null }))).not.toBe(
      filesSignature(a),
    );
    expect(
      filesSignature(
        app({ documents: { ...a.documents, kitchenPhotoPaths: [] } }),
      ),
    ).not.toBe(filesSignature(a));
  });
});

describe("buildChecksBody sends exactly what was reviewed", () => {
  it("sends the ID check with the stored ID path and nothing else", () => {
    const a = app();
    const r = buildChecksBody(a, { id: "verified" }, ALL(a));
    expect(r.body).toEqual({
      idCheck: "verified",
      idDocumentPath: a.documents.idDocumentPath,
    });
  });
  it("sends both file checks with both paths, and the police check without a path", () => {
    const a = app();
    const r = buildChecksBody(
      a,
      { id: "failed", foodHandler: "verified", police: "pending" },
      ALL(a),
    );
    expect(r.body).toEqual({
      idCheck: "failed",
      idDocumentPath: a.documents.idDocumentPath,
      foodHandlerCheck: "verified",
      foodHandlerPath: a.documents.foodHandlerPath,
      policeCheck: "pending",
    });
  });
  it("leaves out a status that did not change", () => {
    const a = app();
    const r = buildChecksBody(a, { id: "pending", police: "verified" }, ALL(a));
    expect(r.body).toEqual({ policeCheck: "verified" });
  });
  it("asks for a change when nothing changed", () => {
    const a = app();
    expect(buildChecksBody(a, {}, ALL(a)).errors.form).toBeTruthy();
    expect(buildChecksBody(a, { id: "pending" }, ALL(a)).body).toBeUndefined();
  });
  it("cannot verify a file that could not be opened, but can fail it", () => {
    const a = app();
    const docs = ALL(a).filter((d) => d.kind !== "id_document");
    expect(buildChecksBody(a, { id: "verified" }, docs).errors.id).toMatch(
      /could not open/,
    );
    expect(buildChecksBody(a, { id: "failed" }, docs).body).toEqual({
      idCheck: "failed",
      idDocumentPath: a.documents.idDocumentPath,
    });
  });
  it("cannot mark a file check when no file exists", () => {
    const a = app({
      documents: {
        idDocumentPath: null,
        foodHandlerPath: null,
        kitchenPhotoPaths: [],
      },
    });
    expect(buildChecksBody(a, { id: "verified" }, []).errors.id).toBeTruthy();
    expect(
      buildChecksBody(a, { foodHandler: "failed" }, []).errors.foodHandler,
    ).toBeTruthy();
  });
});

describe("buildKitchenBody sends exactly the stored photos and address", () => {
  it("approve without a note", () => {
    const a = app();
    expect(buildKitchenBody(a, "approve", "").body).toEqual({
      decision: "approve",
      reviewedPhotoPaths: a.documents.kitchenPhotoPaths,
      reviewedAddress: a.kitchenAddress,
    });
  });
  it("sends null when no address is stored, and [] when no photo", () => {
    const a = app({
      kitchenAddress: null,
      documents: {
        idDocumentPath: null,
        foodHandlerPath: null,
        kitchenPhotoPaths: [],
      },
    });
    const b = buildKitchenBody(a, "approve", "").body!;
    expect(b.reviewedAddress).toBeNull();
    expect(b.reviewedPhotoPaths).toEqual([]);
  });
  it("reject needs a safe note of 3 to 500 characters", () => {
    const a = app();
    expect(buildKitchenBody(a, "reject", "").error).toBeTruthy();
    expect(buildKitchenBody(a, "reject", "no").error).toBeTruthy();
    expect(buildKitchenBody(a, "reject", "bad\u0000").error).toBeTruthy();
    expect(buildKitchenBody(a, "reject", "Photos are dark.").body?.note).toBe(
      "Photos are dark.",
    );
  });
  it("an approval note is optional but must be safe when given", () => {
    const a = app();
    expect(buildKitchenBody(a, "approve", "ok").error).toBeTruthy();
    expect(buildKitchenBody(a, "approve", "Looks clean.").body?.note).toBe(
      "Looks clean.",
    );
  });
  it("does not share the application's array", () => {
    const a = app();
    const b = buildKitchenBody(a, "approve", "").body!;
    expect(b.reviewedPhotoPaths).not.toBe(a.documents.kitchenPhotoPaths);
  });
});
