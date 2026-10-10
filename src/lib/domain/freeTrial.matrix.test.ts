// Tester (T-038): an independently written A-16 table, checked against transitionFreeTrial for every
// event from every state, plus a guard that no second copy of the outcome table exists.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transitionFreeTrial, type FreeTrialState } from "./freeTrial";
import type { FreeTrialEvent } from "./cancellation";

// Written from PLAN A-16 and CLAUDE.md 6.6, not copied from the code.
const OUTCOME: Record<FreeTrialEvent, "hold" | "consume" | "release"> = {
  requested: "hold",
  accepted: "hold",
  declined: "release",
  expired: "release",
  cancelled: "release",
  no_show_chef: "release",
  completed: "consume",
  no_show_customer: "consume",
};
const STATES: FreeTrialState[] = ["held", "consumed", "released"];
const TARGET = { consume: "consumed", release: "released" } as const;

describe("transitionFreeTrial: every event from every state (A-16)", () => {
  for (const state of STATES)
    for (const [event, outcome] of Object.entries(OUTCOME) as [
      FreeTrialEvent,
      "hold" | "consume" | "release",
    ][]) {
      it(`${state} + ${event} (${outcome})`, () => {
        const t = transitionFreeTrial(state, event);
        if (outcome === "hold")
          expect(t.kind).toBe(state === "held" ? "noop" : "invalid");
        else if (state === "held")
          expect(t).toEqual({
            kind: "change",
            from: "held",
            to: TARGET[outcome],
          });
        else if (state === TARGET[outcome])
          expect(t).toEqual({ kind: "noop", state });
        else expect(t).toEqual({ kind: "invalid", state });
      });
    }

  it("only held ever produces a change", () => {
    for (const state of STATES)
      for (const e of Object.keys(OUTCOME) as FreeTrialEvent[])
        expect(transitionFreeTrial(state, e).kind === "change").toBe(
          state === "held" && OUTCOME[e] !== "hold",
        );
  });
});

describe("single source for the outcome table (A-16)", () => {
  it("freeTrial.ts and free-trial.ts contain no status-to-outcome mapping of their own", () => {
    for (const f of [
      "src/lib/domain/freeTrial.ts",
      "src/lib/server/free-trial.ts",
    ]) {
      const src = readFileSync(f, "utf8")
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/["']no_show_customer["']/);
      expect(src, f).not.toMatch(/["']completed["']/);
      expect(src, f).not.toMatch(/["']no_show_chef["']/);
      expect(src, f).not.toMatch(/["']declined["']/);
      if (f.endsWith("domain/freeTrial.ts"))
        expect(src).toContain("freeTrialEffect(");
      else expect(src).toContain("transitionFreeTrial(");
    }
  });
});
