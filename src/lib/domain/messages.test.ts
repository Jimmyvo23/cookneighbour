import { describe, expect, it } from "vitest";
import {
  CHAT_OPEN_STATUSES,
  MESSAGE_MAX_LENGTH,
  contactBlockedBeforeAcceptance,
  isChatOpenStatus,
  parseMessageBody,
} from "./messages";

const ID = "6f1c1c1e-0000-4000-8000-000000000001";

describe("chat status rule (D-94)", () => {
  it("is open for requested, accepted and completed only", () => {
    expect([...CHAT_OPEN_STATUSES]).toEqual([
      "requested",
      "accepted",
      "completed",
    ]);
    for (const s of [
      "declined",
      "cancelled",
      "expired",
      "no_show_customer",
      "no_show_chef",
    ])
      expect(isChatOpenStatus(s), s).toBe(false);
    for (const s of CHAT_OPEN_STATUSES) expect(isChatOpenStatus(s)).toBe(true);
  });
});

describe("parseMessageBody", () => {
  it("accepts and trims a normal message", () => {
    expect(parseMessageBody({ clientId: ID, body: "  Hi there  " })).toEqual({
      ok: true,
      clientId: ID,
      text: "Hi there",
    });
  });
  it("allows line breaks and tabs", () => {
    const r = parseMessageBody({ clientId: ID, body: "line 1\nline 2\tx" });
    expect(r.ok).toBe(true);
  });
  it("counts 2000 characters after trimming as the limit", () => {
    expect(
      parseMessageBody({
        clientId: ID,
        body: ` ${"a".repeat(MESSAGE_MAX_LENGTH)} `,
      }).ok,
    ).toBe(true);
    const r = parseMessageBody({
      clientId: ID,
      body: "a".repeat(MESSAGE_MAX_LENGTH + 1),
    });
    expect(r.ok ? null : Object.keys(r.fields)).toEqual(["body"]);
  });
  it("refuses empty, whitespace only, missing and non-string bodies", () => {
    for (const body of ["", "   \n ", undefined, 5, null])
      expect(parseMessageBody({ clientId: ID, body }).ok, String(body)).toBe(
        false,
      );
  });
  it("refuses control characters and lone surrogates", () => {
    for (const body of ["a\u0000b", "a\u0007b", "x\ud800y", "x\udc00y"])
      expect(parseMessageBody({ clientId: ID, body }).ok).toBe(false);
  });
  it("requires a lower-case UUID clientId", () => {
    for (const clientId of [undefined, "", "abc", ID.toUpperCase(), 7, null]) {
      const r = parseMessageBody({ clientId, body: "hi" });
      expect(r.ok ? null : Object.keys(r.fields), String(clientId)).toEqual([
        "clientId",
      ]);
    }
  });
  it("refuses unknown fields", () => {
    const r = parseMessageBody({ clientId: ID, body: "hi", senderId: "x" });
    expect(r.ok ? null : r.fields).toEqual({ senderId: "Unknown field." });
  });
});

describe("contact details before acceptance", () => {
  it("blocks a phone number, email and link while the booking is requested", () => {
    for (const t of [
      "call me on 416 555 0199",
      "me@example.com",
      "see www.example.com",
    ])
      expect(contactBlockedBeforeAcceptance("requested", t), t).toBe(true);
  });
  it("allows the same text once the booking is accepted or completed", () => {
    for (const s of ["accepted", "completed"])
      expect(contactBlockedBeforeAcceptance(s, "call me on 416 555 0199")).toBe(
        false,
      );
  });
  it("allows ordinary text while requested", () => {
    expect(
      contactBlockedBeforeAcceptance(
        "requested",
        "Is Tuesday at 6 ok? 2 dishes",
      ),
    ).toBe(false);
  });
});
