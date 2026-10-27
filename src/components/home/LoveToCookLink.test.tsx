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
  it("customer and admin render no anchor at all (no empty link)", async () => {
    for (const role of ["customer", "admin"]) {
      apiFetch.mockResolvedValue(me(role));
      await mount();
      expect(host!.querySelectorAll("a").length).toBe(0);
      expect(host!.textContent).toBe("");
      act(() => root?.unmount());
      host?.remove();
    }
  });
  it("chef still in onboarding (any chef profile) goes to /chef/apply", async () => {
    apiFetch.mockResolvedValue({
      profile: { role: "chef", displayName: "X" },
      chef: { status: "pending" },
    });
    await mount();
    expect(link()?.getAttribute("href")).toBe("/chef/apply");
  });
  it("renders exactly one real, focusable anchor with an href for visitors and chefs", async () => {
    for (const m of [null, me("chef")]) {
      apiFetch.mockResolvedValue(m);
      await mount();
      const anchors = host!.querySelectorAll("a");
      expect(anchors.length).toBe(1);
      expect(anchors[0].getAttribute("href")).toMatch(/^\//);
      expect(anchors[0].hasAttribute("tabindex")).toBe(false);
      expect(anchors[0].getAttribute("aria-hidden")).toBeNull();
      act(() => root?.unmount());
      host?.remove();
    }
  });
  it("calls /api/me once", async () => {
    apiFetch.mockResolvedValue(null);
    await mount();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/me");
  });
  it("unmount before the session answers does not throw or update", async () => {
    let resolve!: (v: unknown) => void;
    apiFetch.mockReturnValue(new Promise((r) => (resolve = r)));
    await mount();
    act(() => root?.unmount());
    root = null;
    await act(async () => resolve(me("customer")));
    expect(host!.textContent).toBe("");
  });
});
