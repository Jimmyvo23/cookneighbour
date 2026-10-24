// @vitest-environment jsdom
// T-069 recheck (L3): the global error boundary moves focus to its message when it appears.
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import AppError from "@/app/error";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("app error boundary", () => {
  it("focuses the alert message on mount and retries on click", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const reset = vi.fn();
    await act(async () => {
      root.render(<AppError error={new Error("x")} reset={reset} />);
    });
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(document.activeElement).toBe(alert);
    expect(alert.getAttribute("tabindex")).toBe("-1");
    expect(alert.textContent).toContain("Something went wrong");
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(reset).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
});
