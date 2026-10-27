// @vitest-environment jsdom
// T-136: the "I love to cook" link depends on who is signed in (D-209). Session is stubbed.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

import { LoveToCookLink } from "./LoveToCookLink";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<LoveToCookLink />));
}
const link = () =>
  Array.from(host!.querySelectorAll("a")).find(
    (a) => a.textContent === "I love to cook",
  );

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  apiFetch.mockReset();
});

const me = (role: string) => ({ profile: { role, displayName: "X" } });

describe("LoveToCookLink", () => {
  it("signed out goes to /signup", async () => {
    apiFetch.mockResolvedValue(null);
    await mount();
    expect(link()?.getAttribute("href")).toBe("/signup");
    expect(link()?.className).toContain("home-love");
  });
  it("chef goes to /chef/apply", async () => {
    apiFetch.mockResolvedValue(me("chef"));
    await mount();
    expect(link()?.getAttribute("href")).toBe("/chef/apply");
  });
  it("customer sees no link", async () => {
    apiFetch.mockResolvedValue(me("customer"));
    await mount();
    expect(link()).toBeUndefined();
  });
  it("admin sees no link", async () => {
    apiFetch.mockResolvedValue(me("admin"));
    await mount();
    expect(link()).toBeUndefined();
  });
  it("while loading shows the signed-out link", async () => {
    apiFetch.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(link()?.getAttribute("href")).toBe("/signup");
  });
  it("on error shows the signed-out link", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    await mount();
    expect(link()?.getAttribute("href")).toBe("/signup");
  });
});
