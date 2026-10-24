import { describe, expect, it } from "vitest";
import {
  CYCLES,
  CYCLE_SECONDS,
  STIR_END,
  STIR_START,
  clock,
  ease,
  lidPose,
  mulberry32,
  spoonPhase,
  steamRate,
  stirPosition,
} from "./pot-timeline";

describe("ease", () => {
  it("runs 0 to 1 and clamps outside", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5); // decelerating
  });
});

describe("lidPose", () => {
  it("starts on the pot", () => {
    expect(lidPose(0)).toEqual({ x: 0, y: 1.66, rotZ: 0 });
  });
  it("lifts straight up first, then leans aside behind the pot", () => {
    const up = lidPose(1.3);
    expect(up.y).toBeCloseTo(3.0);
    expect(up.x).toBeCloseTo(0);
    const aside = lidPose(1.9);
    expect(aside.x).toBeCloseTo(2.1);
    expect(aside.y).toBeCloseTo(0.95);
    expect(aside.rotZ).toBeCloseTo(-1.15);
  });
  it("stays aside while the spoon works", () => {
    expect(lidPose(4)).toEqual(lidPose(7));
  });
  it("goes back on and clinks, then settles", () => {
    expect(lidPose(8.3).y).toBeCloseTo(1.66);
    const clink = lidPose(8.4);
    expect(clink.y).toBeGreaterThan(1.66);
    expect(lidPose(9.9).y).toBeCloseTo(1.66, 2);
    expect(lidPose(9.9).x).toBe(0);
  });
  it("never moves the lid below the pot rim", () => {
    for (let t = 0; t <= CYCLE_SECONDS; t += 0.05)
      expect(lidPose(t).y).toBeGreaterThanOrEqual(0.94);
  });
});

describe("spoonPhase", () => {
  it("rests before and after the stir", () => {
    expect(spoonPhase(0).phase).toBe("rest");
    expect(spoonPhase(1.7).phase).toBe("rest");
    expect(spoonPhase(7.2).phase).toBe("rest");
    expect(spoonPhase(9).phase).toBe("rest");
  });
  it("arcs in, stirs, arcs out", () => {
    expect(spoonPhase(2).phase).toBe("in");
    expect(spoonPhase(STIR_START).phase).toBe("stir");
    expect(spoonPhase(STIR_END - 0.01).phase).toBe("stir");
    expect(spoonPhase(6.8).phase).toBe("out");
  });
  it("makes one full lap in 1.5 seconds while stirring", () => {
    const a = spoonPhase(STIR_START + 1.5).theta;
    expect(a).toBeCloseTo(Math.PI * 2);
  });
  it("progress k stays within 0..1", () => {
    for (let t = 0; t <= CYCLE_SECONDS; t += 0.05) {
      const { k } = spoonPhase(t);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });
});

describe("stirPosition", () => {
  it("stays inside the pot opening", () => {
    for (let th = 0; th < 7; th += 0.2) {
      const [x, y, z] = stirPosition(th);
      expect(Math.hypot(x / 0.75, z / 0.6)).toBeCloseTo(1);
      expect(y).toBeLessThan(1.66);
    }
  });
});

describe("clock", () => {
  it("is active for 2 cycles then rests", () => {
    expect(CYCLES).toBe(2);
    expect(clock(0)).toMatchObject({ active: true, cycle: 0, cycleT: 0 });
    expect(clock(12.5)).toMatchObject({ active: true, cycle: 1 });
    expect(clock(12.5).cycleT).toBeCloseTo(2.5);
    expect(clock(20)).toMatchObject({ active: false, cycleT: 0 });
    expect(clock(500).active).toBe(false);
  });
  it("is never active with reduced motion", () => {
    expect(clock(3, true).active).toBe(false);
  });
});

describe("steamRate", () => {
  it("is zero while the lid is on", () => {
    expect(steamRate(0.5, true)).toBe(0);
    expect(steamRate(9, true)).toBe(0);
  });
  it("is gentle with the lid off and strongest while stirring", () => {
    const open = steamRate(2, true);
    const stirring = steamRate(4, true);
    expect(open).toBeGreaterThan(0);
    expect(stirring).toBeGreaterThan(open);
  });
  it("is zero when not active", () => {
    expect(steamRate(4, false)).toBe(0);
  });
});

describe("mulberry32", () => {
  it("is deterministic and in [0,1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
