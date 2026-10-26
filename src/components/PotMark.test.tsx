// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PotMark } from "./Ornaments";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe("PotMark", () => {
  it("renders the happy pot", () => {
    const el = mount(<PotMark />);
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("viewBox")).toBe("0 -8 52 56");
    expect(el.querySelectorAll(".pot-lid")).toHaveLength(1);
    expect(el.querySelectorAll(".pot-steam")).toHaveLength(1);
    expect(el.querySelector('[data-part="smile"]')).not.toBeNull();
    expect(el.querySelector("text")).toBeNull();
  });

  it("keeps the className prop", () => {
    const el = mount(<PotMark className="size-20" />);
    expect(el.querySelector("svg")!.getAttribute("class")).toContain("size-20");
  });
});
