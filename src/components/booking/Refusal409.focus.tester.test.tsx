// @vitest-environment jsdom
// T-083 round 2 tester: when the closing sentence arrives after the refetch, it must not pull
// focus back from where the user moved in the meantime.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useBookingRefusals } from "@/components/refusal";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("T-083 round 2: late sentence and focus", () => {
  // BUG (LOW) found by Tester: the effect in useBookingRefusals depends on `last`, which changes
  // when the sentence arrives, so focus is pulled back to the alert. Remove `.fails` when fixed.
  it.fails(
    "does not steal focus back when the refetch finishes later",
    async () => {
      let finish: (ok: boolean) => void = () => {};
      const pending = new Promise<boolean>((r) => (finish = r));
      let report: (t: string) => void = () => {};
      function Page() {
        const { scope, alert } = useBookingRefusals(() => pending);
        report = scope.report;
        return (
          <div>
            {alert}
            <button id="other">other</button>
          </div>
        );
      }
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => root.render(<Page />));
      await act(async () => report("Not possible."));
      const alert = host.querySelector('[role="alert"]') as HTMLElement;
      expect(document.activeElement).toBe(alert);
      const other = host.querySelector("#other") as HTMLElement;
      other.focus();
      expect(document.activeElement).toBe(other);
      await act(async () => finish(true));
      expect(alert.textContent).toContain("current status");
      expect(document.activeElement).toBe(other);
      await act(async () => root.unmount());
      host.remove();
    },
  );
});
