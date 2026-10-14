// @vitest-environment jsdom
// Round 3 (L4): the same message twice in a row is announced and focused again.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness, type Harness } from "@/components/booking/testkit";
import { useAnnounce } from "@/components/booking/useAnnounce";

function Demo() {
  const { announce, notice } = useAnnounce();
  return (
    <div>
      <button type="button" onClick={() => announce("Saved.")}>
        Save
      </button>
      {notice("n", "box")}
    </div>
  );
}

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

describe("useAnnounce", () => {
  it("is silent at first and takes focus when there is a message", async () => {
    await h.mount(<Demo />);
    expect(h.q("n")?.className).toBe("sr-only");
    await h.click(h.button("Save"));
    expect(h.q("n")?.textContent).toBe("Saved.");
    expect(document.activeElement).toBe(h.q("n"));
  });
  it("focuses again for an identical message", async () => {
    await h.mount(<Demo />);
    await h.click(h.button("Save"));
    h.button("Save")!.focus();
    expect(document.activeElement).toBe(h.button("Save"));
    await h.click(h.button("Save"));
    expect(document.activeElement).toBe(h.q("n"));
  });
});
