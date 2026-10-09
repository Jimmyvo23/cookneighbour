import { describe, expect, it } from "vitest";
import { centreForPostal, distanceMetres, haversineKm } from "./distance";

const centres = new Map([
  ["L5B", { lat: 43.5934, lng: -79.6446 }], // Mississauga City Centre (approx.)
  ["M5V", { lat: 43.6426, lng: -79.3871 }], // Toronto downtown (approx.)
  ["L5N", { lat: 43.5963, lng: -79.7559 }],
]);

describe("haversineKm", () => {
  it("is zero for the same point and symmetric", () => {
    const a = centres.get("L5B")!;
    const b = centres.get("M5V")!;
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
  it("matches a known distance (Mississauga centre to downtown Toronto is about 21 km)", () => {
    const km = haversineKm(centres.get("L5B")!, centres.get("M5V")!);
    expect(km).toBeGreaterThan(20);
    expect(km).toBeLessThan(23);
  });
  it("one degree of latitude is about 111.2 km", () => {
    expect(
      haversineKm({ lat: 43, lng: -79 }, { lat: 44, lng: -79 }),
    ).toBeCloseTo(111.2, 1);
  });
  it("returns whole metres", () => {
    const m = distanceMetres(centres.get("L5B")!, centres.get("L5N")!);
    expect(Number.isInteger(m)).toBe(true);
    expect(m).toBeGreaterThan(8000);
    expect(m).toBeLessThan(10000);
  });
});

describe("centreForPostal", () => {
  it("accepts a full postal code in any case or spacing, or a prefix", () => {
    expect(centreForPostal(centres, "l5b 1m2")).toEqual(centres.get("L5B"));
    expect(centreForPostal(centres, "L5B1M2")).toEqual(centres.get("L5B"));
    expect(centreForPostal(centres, " l5b ")).toEqual(centres.get("L5B"));
  });
  it("rejects non-GTA and malformed codes (CLAUDE.md 10)", () => {
    expect(centreForPostal(centres, "V6B 1A1")).toBeNull(); // Vancouver
    expect(centreForPostal(centres, "12345")).toBeNull();
    expect(centreForPostal(centres, "")).toBeNull();
    expect(centreForPostal(centres, "L5B 1M")).toBeNull();
    expect(centreForPostal(centres, "D5B 1M2")).toBeNull(); // D is not a valid letter but shape matches; not in table
  });
});
