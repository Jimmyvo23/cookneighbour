// T-126 v2 fix 1: /search?city=&cuisine= prefills the form (the home map link). Invalid values are
// ignored without an error. All values are made up.
import { describe, expect, it } from "vitest";
import { searchPrefill } from "./search";

const CITIES = ["Brampton", "Mississauga", "Toronto"];

describe("searchPrefill", () => {
  it("reads a city and a cuisine", () => {
    expect(
      searchPrefill("?city=Mississauga&cuisine=Vietnamese", CITIES),
    ).toEqual({ city: "Mississauga", cuisine: "Vietnamese" });
  });
  it("matches the city ignoring case and gives the canonical name", () => {
    expect(searchPrefill("?city=toronto", CITIES)).toEqual({ city: "Toronto" });
  });
  it("ignores an unknown city but keeps a valid cuisine", () => {
    expect(searchPrefill("?city=Atlantis&cuisine=Indian", CITIES)).toEqual({
      cuisine: "Indian",
    });
  });
  it("ignores a bad cuisine (too long, control characters, blank)", () => {
    expect(searchPrefill(`?cuisine=${"a".repeat(41)}`, CITIES)).toBeNull();
    expect(searchPrefill("?cuisine=a%00b", CITIES)).toBeNull();
    expect(searchPrefill("?cuisine=%20%20", CITIES)).toBeNull();
  });
  it("returns null when nothing is usable", () => {
    expect(searchPrefill("", CITIES)).toBeNull();
    expect(searchPrefill("?foo=bar", CITIES)).toBeNull();
  });
  it("ignores a repeated parameter", () => {
    expect(searchPrefill("?city=Toronto&city=Brampton", CITIES)).toBeNull();
  });
});
