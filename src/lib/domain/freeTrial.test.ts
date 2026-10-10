import { describe, expect, it } from "vitest";
import {
  evaluateFreeTrial,
  transitionFreeTrial,
  type ClaimSummary,
  type FreeTrialState,
} from "./freeTrial";
import { freeTrialEffect, type FreeTrialEvent } from "./cancellation";

const me = { customerId: "c1", phoneHash: "p1", addressHash: "a1" };
const claim = (over: Partial<ClaimSummary> = {}): ClaimSummary => ({
  customerId: "other",
  phoneHash: "px",
  addressHash: "ax",
  state: "held",
  ...over,
});

describe("evaluateFreeTrial (CLAUDE.md 6.6, R-4)", () => {
  it("is eligible with no claims", () => {
    expect(evaluateFreeTrial(me, [])).toEqual({ eligible: true });
  });
  it("ignores unrelated claims", () => {
    expect(
      evaluateFreeTrial(me, [claim(), claim({ state: "consumed" })]),
    ).toEqual({ eligible: true });
  });
  it.each(["held", "consumed"] as const)(
    "blocks on a %s claim by the same customer, phone or address",
    (state) => {
      expect(
        evaluateFreeTrial(me, [claim({ customerId: "c1", state })]),
      ).toEqual({ eligible: false, reason: "customer" });
      expect(
        evaluateFreeTrial(me, [claim({ phoneHash: "p1", state })]),
      ).toEqual({ eligible: false, reason: "phone" });
      expect(
        evaluateFreeTrial(me, [claim({ addressHash: "a1", state })]),
      ).toEqual({ eligible: false, reason: "address" });
    },
  );
  it("a released claim never blocks", () => {
    expect(
      evaluateFreeTrial(me, [
        claim({
          customerId: "c1",
          phoneHash: "p1",
          addressHash: "a1",
          state: "released",
        }),
      ]),
    ).toEqual({ eligible: true });
  });
  it("reports customer before phone before address", () => {
    const all = claim({ customerId: "c1", phoneHash: "p1", addressHash: "a1" });
    expect(evaluateFreeTrial(me, [all])).toMatchObject({ reason: "customer" });
    expect(
      evaluateFreeTrial(me, [
        claim({ addressHash: "a1" }),
        claim({ phoneHash: "p1" }),
      ]),
    ).toMatchObject({ reason: "phone" });
  });
  it("a released claim does not hide a live one", () => {
    expect(
      evaluateFreeTrial(me, [
        claim({ customerId: "c1", state: "released" }),
        claim({ addressHash: "a1" }),
      ]),
    ).toEqual({ eligible: false, reason: "address" });
  });
});

const EVENTS: FreeTrialEvent[] = [
  "requested",
  "accepted",
  "declined",
  "cancelled",
  "completed",
  "no_show_customer",
  "no_show_chef",
  "expired",
];
const STATES: FreeTrialState[] = ["held", "consumed", "released"];

describe("transitionFreeTrial uses freeTrialEffect as the single source (A-16)", () => {
  it("from held: consume and release change the state, hold keeps it", () => {
    for (const e of EVENTS) {
      const effect = freeTrialEffect(e);
      const t = transitionFreeTrial("held", e);
      if (effect === "hold") expect(t).toEqual({ kind: "noop", state: "held" });
      if (effect === "consume")
        expect(t).toEqual({ kind: "change", from: "held", to: "consumed" });
      if (effect === "release")
        expect(t).toEqual({ kind: "change", from: "held", to: "released" });
    }
  });
  it("A-16 table: decline, expiry, chef no-show and cancel release; completed and customer no-show consume", () => {
    for (const e of [
      "declined",
      "expired",
      "no_show_chef",
      "cancelled",
    ] as const)
      expect(transitionFreeTrial("held", e)).toMatchObject({ to: "released" });
    for (const e of ["completed", "no_show_customer"] as const)
      expect(transitionFreeTrial("held", e)).toMatchObject({ to: "consumed" });
  });
  it("repeating the same outcome is a harmless no-op (idempotent)", () => {
    for (const e of EVENTS) {
      const effect = freeTrialEffect(e);
      if (effect === "consume")
        expect(transitionFreeTrial("consumed", e)).toEqual({
          kind: "noop",
          state: "consumed",
        });
      if (effect === "release")
        expect(transitionFreeTrial("released", e)).toEqual({
          kind: "noop",
          state: "released",
        });
    }
  });
  it("only held can move: consumed and released are final, opposite outcomes are invalid", () => {
    for (const e of EVENTS) {
      const effect = freeTrialEffect(e);
      if (effect === "consume")
        expect(transitionFreeTrial("released", e).kind).toBe("invalid");
      if (effect === "release")
        expect(transitionFreeTrial("consumed", e).kind).toBe("invalid");
      if (effect === "hold")
        for (const s of ["consumed", "released"] as const)
          expect(transitionFreeTrial(s, e).kind).toBe("invalid");
    }
  });
  it("covers every event from every state without throwing", () => {
    for (const s of STATES)
      for (const e of EVENTS)
        expect(["noop", "change", "invalid"]).toContain(
          transitionFreeTrial(s, e).kind,
        );
  });
});
