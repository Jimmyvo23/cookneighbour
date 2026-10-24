// The home-page pot: pure timeline maths (T-126). No three.js and no DOM in this file, so it is
// unit tested on its own. The numbers come from the approved prototype
// (docs/design/t126-prototype/index.html). One cycle is 10 seconds; the pot runs 2 cycles, then rests.

export const CYCLE_SECONDS = 10;
export const CYCLES = 2;
/** The spoon stirs between these two moments of a cycle (seconds). */
export const STIR_START = 2.6;
export const STIR_END = 6.4;
/** Seconds for one lap of the spoon around the pot. */
export const STIR_LAP = 1.5;

/** Cubic ease-out, clamped to 0..1. */
export function ease(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return 1 - Math.pow(1 - c, 3);
}
/** Eased progress of t between a and b. */
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export interface LidPose {
  x: number;
  y: number;
  rotZ: number;
}
const ON: LidPose = { x: 0, y: 1.66, rotZ: 0 };
const UP: LidPose = { x: 0, y: 3.0, rotZ: 0.12 };
const ASIDE: LidPose = { x: 2.1, y: 0.95, rotZ: -1.15 };
const lerpLid = (a: LidPose, b: LidPose, k: number): LidPose => ({
  x: mix(a.x, b.x, k),
  y: mix(a.y, b.y, k),
  rotZ: mix(a.rotZ, b.rotZ, k),
});

/** Where the lid is t seconds into a cycle: on, up, leaning behind the pot, up, back on with a clink. */
export function lidPose(t: number): LidPose {
  if (t < 0.8) return { ...ON };
  if (t < 1.3) return lerpLid(ON, UP, seg(t, 0.8, 1.3));
  if (t < 1.9) return lerpLid(UP, ASIDE, seg(t, 1.3, 1.9));
  if (t < 7.3) return { ...ASIDE };
  if (t < 7.9) return lerpLid(ASIDE, UP, seg(t, 7.3, 7.9));
  if (t < 8.3) return lerpLid(UP, ON, seg(t, 7.9, 8.3));
  const k = t - 8.3;
  return {
    ...ON,
    y: ON.y + 0.06 * Math.exp(-k * 7) * Math.abs(Math.sin(k * 22)),
  };
}

export type SpoonPhaseName = "rest" | "in" | "stir" | "out";
export interface SpoonPhase {
  phase: SpoonPhaseName;
  /** Eased progress 0..1 inside "in" and "out"; 0 otherwise. */
  k: number;
  /** Angle round the pot while stirring (radians); 0 otherwise. */
  theta: number;
}
const SPOON_IN = 1.8;
const SPOON_BACK = 7.2;

export function spoonPhase(t: number): SpoonPhase {
  if (t < SPOON_IN || t >= SPOON_BACK) return { phase: "rest", k: 0, theta: 0 };
  if (t < STIR_START)
    return { phase: "in", k: seg(t, SPOON_IN, STIR_START), theta: 0 };
  if (t < STIR_END)
    return {
      phase: "stir",
      k: 0,
      theta: ((t - STIR_START) * Math.PI * 2) / STIR_LAP,
    };
  return { phase: "out", k: seg(t, STIR_END, SPOON_BACK), theta: 0 };
}

/** The angle the stir ends on, where the spoon leaves the pot. */
export const STIR_END_THETA =
  ((STIR_END - STIR_START) * Math.PI * 2) / STIR_LAP;
/** How high the spoon arcs between the cloth and the pot (scene units). */
export const SPOON_ARC_HEIGHT = 2.2;
export const spoonArcLift = (k: number) =>
  Math.sin(Math.PI * k) * SPOON_ARC_HEIGHT;

/** Spoon bowl position inside the pot (pot-local) for an angle round it. */
export function stirPosition(theta: number): [number, number, number] {
  return [Math.cos(theta) * 0.75, 1.05, Math.sin(theta) * 0.6];
}

export interface Clock {
  active: boolean;
  cycle: number;
  cycleT: number;
}
/** Maps elapsed seconds to the cycle. After the last cycle (or with reduced motion) it is at rest. */
export function clock(elapsed: number, reduced = false): Clock {
  const active = !reduced && elapsed >= 0 && elapsed < CYCLE_SECONDS * CYCLES;
  return {
    active,
    cycle: Math.floor(Math.max(0, elapsed) / CYCLE_SECONDS),
    cycleT: active ? elapsed % CYCLE_SECONDS : 0,
  };
}

/** Steam puffs per second: none under the lid, gentle when open, strongest while stirring. */
export function steamRate(cycleT: number, active: boolean): number {
  if (!active || !(cycleT > 1.0 && cycleT < 7.6)) return 0;
  return cycleT > STIR_START && cycleT < STIR_END ? 16 : 6;
}

/** Small seeded random numbers, so a frozen test frame looks the same every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
