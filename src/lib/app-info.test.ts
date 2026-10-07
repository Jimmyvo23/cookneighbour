import { describe, expect, it } from "vitest";
import { APP_NAME, pageTitle } from "./app-info";

describe("app-info", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("CookNeighbour");
  });
  it("builds the placeholder page title", () => {
    expect(pageTitle()).toBe("CookNeighbour — prototype");
  });
});
