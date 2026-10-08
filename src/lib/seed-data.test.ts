import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chefs, customers } from "../../scripts/seed-data";
import { parsePostalPrefixes, stableUuid } from "../../scripts/seed-lib";
import { addressHash, phoneHash } from "./domain/hash";
import { addressColumns, phoneColumns } from "./domain/private-rows";

const prefixes = parsePostalPrefixes(readFileSync("supabase/seed.sql", "utf8"));
const prefixSet = new Set(prefixes.map((p) => p.prefix));

describe("seed.sql postal prefixes", () => {
  it("covers Mississauga L4T to L5W and the other GTA cities", () => {
    const cities = new Set(prefixes.map((p) => p.city));
    for (const c of [
      "Mississauga",
      "Toronto",
      "Brampton",
      "Oakville",
      "Markham",
      "Vaughan",
      "Richmond Hill",
    ])
      expect(cities).toContain(c);
    const miss = prefixes.filter((p) => p.city === "Mississauga");
    expect(miss.length).toBe(23);
  });
  it("has unique, well-formed prefixes with plausible GTA coordinates", () => {
    expect(prefixSet.size).toBe(prefixes.length);
    for (const p of prefixes) {
      expect(p.prefix).toMatch(/^[A-Z][0-9][A-Z]$/);
      expect(p.lat).toBeGreaterThan(43.3);
      expect(p.lat).toBeLessThan(44.1);
      expect(p.lng).toBeGreaterThan(-80);
      expect(p.lng).toBeLessThan(-79);
    }
  });
});

describe("seed data", () => {
  it("has an approved Vietnamese chef in Mississauga offering both locations", () => {
    const miss = new Set(
      prefixes.filter((p) => p.city === "Mississauga").map((p) => p.prefix),
    );
    const c = chefs.find(
      (x) =>
        x.status === "approved" &&
        x.cuisines.includes("Vietnamese") &&
        miss.has(x.servicePrefix) &&
        x.locationOptions.includes("customer_home") &&
        x.locationOptions.includes("chef_home") &&
        x.chefHomeEnabled,
    );
    expect(c).toBeDefined();
  });
  it("has pending and rejected chefs, about ten in total", () => {
    expect(chefs.some((c) => c.status === "pending")).toBe(true);
    expect(chefs.filter((c) => c.status === "rejected")).toHaveLength(1);
    expect(chefs.length).toBeGreaterThanOrEqual(10);
    expect(customers.length).toBeGreaterThanOrEqual(2);
  });
  it("uses only fictional emails/phones and valid references", () => {
    const emails = new Set<string>();
    for (const p of [...chefs, ...customers]) {
      expect(p.email).toMatch(/@example\.com$/);
      expect(emails.has(p.email)).toBe(false);
      emails.add(p.email);
    }
    for (const c of customers) {
      expect(c.phone).toMatch(/^\+1[0-9]{3}555[0-9]{4}$/);
      expect(c.postalCode).toMatch(/^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/);
      expect(prefixSet.has(c.postalCode.slice(0, 3))).toBe(true);
    }
    for (const c of chefs) {
      expect(prefixSet.has(c.servicePrefix)).toBe(true);
      expect(c.dishes.length).toBeGreaterThan(0);
      if (c.locationOptions.includes("chef_home") && c.chefHomeEnabled)
        expect(c.kitchen).toBeDefined();
      if (c.chefHomeEnabled) expect(c.locationOptions).toContain("chef_home");
      if (c.status === "rejected") expect(c.rejectReason).toBeTruthy();
      for (const d of c.dishes) {
        expect(d.cookMinutes).toBeGreaterThan(0);
        expect(Number.isInteger(d.ingredientCostCents)).toBe(true);
        expect(d.servings).toBeGreaterThan(0);
        expect(d.shelfLifeDays).toBeGreaterThanOrEqual(0);
        expect(d.shelfLifeDays).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe("seed helpers", () => {
  it("stableUuid is deterministic, v-shaped and distinct per input", () => {
    expect(stableUuid("a")).toBe(stableUuid("a"));
    expect(stableUuid("a")).not.toBe(stableUuid("b"));
    expect(stableUuid("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("seed and app compute identical hashes for the demo customers", () => {
    const pepper = "test-pepper";
    for (const c of customers) {
      // What the seed writes (private-rows builders) versus what the app would compute from the
      // same input typed differently by a user.
      const seeded = {
        ...phoneColumns(c.phone, pepper),
        ...addressColumns(c.addressLine, c.city, c.postalCode, pepper),
      };
      expect(seeded.phone_hash).toBe(phoneHash(c.phone.slice(2), pepper));
      expect(seeded.phone_hash).toBe(
        phoneHash(
          `(${c.phone.slice(2, 5)}) ${c.phone.slice(5, 8)}-${c.phone.slice(8)}`,
          pepper,
        ),
      );
      const typed = `${c.addressLine.toUpperCase()}.`;
      const spaced =
        `${c.postalCode.slice(0, 3)} ${c.postalCode.slice(3)}`.toLowerCase();
      expect(seeded.address_hash).toBe(addressHash(typed, spaced, pepper));
      expect(seeded.postal_prefix).toBe(c.postalCode.slice(0, 3));
    }
  });
});
