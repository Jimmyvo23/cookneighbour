import { describe, expect, it } from "vitest";
import {
  CHECKS_KEYS,
  KITCHEN_REVIEW_KEYS,
  REJECT_KEYS,
  decodeCursor,
  encodeCursor,
  parseChecksBody,
  parseKitchenReview,
  parseListQuery,
  parseReason,
} from "./admin-chefs";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const q = (s: string) => new URLSearchParams(s);

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    return (e as { extra: { fields: Record<string, string> } }).extra.fields;
  }
  throw new Error("expected a validation failure");
}

describe("parseListQuery", () => {
  it("defaults to pending, limit 20, no cursor, no checks filter", () => {
    expect(parseListQuery(q(""))).toEqual({
      status: "pending",
      checksPending: false,
      limit: 20,
      cursor: null,
    });
  });
  it("accepts every status and the checks filter", () => {
    for (const s of ["pending", "approved", "rejected", "all"])
      expect(parseListQuery(q(`status=${s}`)).status).toBe(s);
    expect(parseListQuery(q("checks=pending")).checksPending).toBe(true);
  });
  it("refuses unknown values with the field name", () => {
    expect(fieldsOf(() => parseListQuery(q("status=banana")))).toHaveProperty(
      "status",
    );
    expect(fieldsOf(() => parseListQuery(q("checks=verified")))).toHaveProperty(
      "checks",
    );
  });
  it("limit is an integer from 1 to 50", () => {
    expect(parseListQuery(q("limit=50")).limit).toBe(50);
    expect(parseListQuery(q("limit=1")).limit).toBe(1);
    for (const bad of ["0", "51", "-1", "2.5", "abc", "", "1e1"])
      expect(fieldsOf(() => parseListQuery(q(`limit=${bad}`)))).toHaveProperty(
        "limit",
      );
  });
  it("reports all bad values at once", () => {
    const f = fieldsOf(() => parseListQuery(q("status=x&limit=0&cursor=zz")));
    expect(Object.keys(f).sort()).toEqual(["cursor", "limit", "status"]);
  });
});

describe("cursor", () => {
  const t = "2026-10-08T12:34:56.123456+00:00";
  it("round-trips and keeps microseconds", () => {
    const c = encodeCursor(t, ID);
    expect(decodeCursor(c)).toEqual({
      createdAt: t.replace("+00:00", "Z"),
      id: ID,
    });
  });
  it("is opaque url-safe text", () => {
    expect(encodeCursor(t, ID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("rejects garbage, wrong shapes and filter-injection attempts", () => {
    const enc = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    for (const bad of [
      "",
      "not base64 !!",
      enc({}),
      enc({ t: "x", id: ID }),
      enc({ t: "2026-10-08T12:00:00Z", id: "nope" }),
      enc({ t: "2026-10-08T12:00:00Z),status.eq.approved,(x", id: ID }),
      enc({ t: "2026-10-08T12:00:00Z", id: `${ID},status.eq.approved` }),
      enc([1, 2]),
      enc("text"),
    ])
      expect(decodeCursor(bad)).toBeNull();
  });
  it("parseListQuery turns a bad cursor into 422 and keeps a good one", () => {
    expect(fieldsOf(() => parseListQuery(q("cursor=abc")))).toHaveProperty(
      "cursor",
    );
    const c = encodeCursor(t, ID);
    expect(parseListQuery(q(`cursor=${c}`)).cursor).toEqual({
      createdAt: t.replace("+00:00", "Z"),
      id: ID,
    });
  });
});

describe("parseReason", () => {
  it("trims and accepts 3 to 500 characters", () => {
    expect(parseReason({ reason: "  No food certificate  " }, "reason")).toBe(
      "No food certificate",
    );
    expect(parseReason({ reason: "abc" }, "reason")).toBe("abc");
    expect(parseReason({ reason: "a".repeat(500) }, "reason")).toHaveLength(
      500,
    );
  });
  it("refuses short, long, blank, missing, non-string and unsafe text", () => {
    for (const bad of ["ab", "  a  ", "a".repeat(501), "", 5, null, undefined])
      expect(
        fieldsOf(() => parseReason({ reason: bad }, "reason")),
      ).toHaveProperty("reason");
    expect(
      fieldsOf(() => parseReason({ reason: "bad\u0000text" }, "reason")),
    ).toEqual({ reason: "Remove control or invalid characters." });
    expect(
      fieldsOf(() =>
        parseReason({ reason: "lone \ud800 surrogate" }, "reason"),
      ),
    ).toHaveProperty("reason");
  });
  it("lists the allowed keys", () => {
    expect(REJECT_KEYS).toEqual(["reason"]);
  });
});

describe("parseChecksBody", () => {
  const p = `${ID}/id-${ID}.png`;
  it("accepts a check with the path the admin viewed", () => {
    expect(parseChecksBody({ idCheck: "verified", idDocumentPath: p })).toEqual(
      { idCheck: "verified", idDocumentPath: p },
    );
    expect(parseChecksBody({ policeCheck: "failed" })).toEqual({
      policeCheck: "failed",
    });
  });
  it("needs at least one check", () => {
    expect(fieldsOf(() => parseChecksBody({}))).toHaveProperty("idCheck");
    expect(
      fieldsOf(() => parseChecksBody({ idDocumentPath: p })),
    ).toHaveProperty("idCheck");
  });
  it("a check without its reviewed path is 422 on the path", () => {
    expect(fieldsOf(() => parseChecksBody({ idCheck: "verified" }))).toEqual({
      idDocumentPath: "Send the path you reviewed.",
    });
    expect(
      fieldsOf(() => parseChecksBody({ foodHandlerCheck: "failed" })),
    ).toHaveProperty("foodHandlerPath");
  });
  it("a path without its check is 422", () => {
    expect(
      fieldsOf(() =>
        parseChecksBody({ policeCheck: "pending", foodHandlerPath: p }),
      ),
    ).toHaveProperty("foodHandlerCheck");
  });
  it("refuses unknown statuses, police values on file checks and bad paths", () => {
    expect(
      fieldsOf(() => parseChecksBody({ idCheck: "ok", idDocumentPath: p })),
    ).toHaveProperty("idCheck");
    expect(
      fieldsOf(() => parseChecksBody({ policeCheck: "verified2" })),
    ).toHaveProperty("policeCheck");
    expect(
      fieldsOf(() =>
        parseChecksBody({ idCheck: "verified", idDocumentPath: 5 }),
      ),
    ).toHaveProperty("idDocumentPath");
    expect(
      fieldsOf(() =>
        parseChecksBody({
          idCheck: "verified",
          idDocumentPath: "a".repeat(201),
        }),
      ),
    ).toHaveProperty("idDocumentPath");
  });
  it("lists the allowed keys", () => {
    expect([...CHECKS_KEYS].sort()).toEqual(
      [
        "foodHandlerCheck",
        "foodHandlerPath",
        "idCheck",
        "idDocumentPath",
        "policeCheck",
      ].sort(),
    );
  });
});

describe("parseKitchenReview", () => {
  const photo = `${ID}/kitchen-${ID}.png`;
  const addr = {
    line: "1 Fictional Street",
    city: "Mississauga",
    postalCode: "L5B1A1",
  };
  it("approve needs decision, photos and address (or null)", () => {
    expect(
      parseKitchenReview({
        decision: "approve",
        reviewedPhotoPaths: [photo],
        reviewedAddress: addr,
      }),
    ).toEqual({
      decision: "approve",
      note: null,
      reviewedPhotoPaths: [photo],
      reviewedAddress: addr,
    });
    expect(
      parseKitchenReview({
        decision: "approve",
        reviewedPhotoPaths: [],
        reviewedAddress: null,
      }).reviewedAddress,
    ).toBeNull();
  });
  it("reject needs a note of 3 to 500 characters", () => {
    expect(
      fieldsOf(() =>
        parseKitchenReview({
          decision: "reject",
          reviewedPhotoPaths: [photo],
          reviewedAddress: addr,
        }),
      ),
    ).toHaveProperty("note");
    expect(
      parseKitchenReview({
        decision: "reject",
        note: " Dirty counters ",
        reviewedPhotoPaths: [photo],
        reviewedAddress: addr,
      }).note,
    ).toBe("Dirty counters");
  });
  it("an optional approve note is still validated", () => {
    expect(
      fieldsOf(() =>
        parseKitchenReview({
          decision: "approve",
          note: "x",
          reviewedPhotoPaths: [photo],
          reviewedAddress: addr,
        }),
      ),
    ).toHaveProperty("note");
  });
  it("requires both reviewed values on approve and reject", () => {
    const f = fieldsOf(() => parseKitchenReview({ decision: "approve" }));
    expect(f).toHaveProperty("reviewedPhotoPaths");
    expect(f).toHaveProperty("reviewedAddress");
  });
  it("refuses a bad decision, bad lists and bad addresses", () => {
    expect(
      fieldsOf(() =>
        parseKitchenReview({
          decision: "maybe",
          reviewedPhotoPaths: [],
          reviewedAddress: null,
        }),
      ),
    ).toHaveProperty("decision");
    for (const bad of [
      "x",
      [5],
      Array(11).fill(photo),
      [photo, photo],
      [""],
      ["a".repeat(201)],
    ])
      expect(
        fieldsOf(() =>
          parseKitchenReview({
            decision: "approve",
            reviewedPhotoPaths: bad,
            reviewedAddress: null,
          }),
        ),
      ).toHaveProperty("reviewedPhotoPaths");
    for (const bad of [
      "x",
      [],
      { line: "a" },
      { ...addr, extra: 1 },
      { ...addr, postalCode: 5 },
    ])
      expect(
        fieldsOf(() =>
          parseKitchenReview({
            decision: "approve",
            reviewedPhotoPaths: [],
            reviewedAddress: bad,
          }),
        ),
      ).toHaveProperty("reviewedAddress");
  });
  it("lists the allowed keys", () => {
    expect([...KITCHEN_REVIEW_KEYS].sort()).toEqual(
      ["decision", "note", "reviewedAddress", "reviewedPhotoPaths"].sort(),
    );
  });
});
