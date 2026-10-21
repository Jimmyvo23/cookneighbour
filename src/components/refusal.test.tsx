// @vitest-environment jsdom
// T-087 (T-083 NIT-1): the full stop before the status sentence must not double or go missing when
// the refusal text ends with spaces. All text is made up.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useBookingRefusals } from "@/components/refusal";

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

async function refusalText(text: string): Promise<string> {
  function Page() {
    const { scope, alert } = useBookingRefusals(() => true);
    return (
      <div>
        <button onClick={() => scope.report(text)}>go</button>
        {alert}
      </div>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Page />));
  await act(async () => {
    host!.querySelector("button")!.click();
  });
  return host.querySelector('[data-testid="refusal"]')!.textContent ?? "";
}

const STATUS = "This page shows its current status.";

describe("refusal alert punctuation", () => {
  it("keeps one full stop when the text ends with punctuation and a space", async () => {
    expect(await refusalText("Already answered. ")).toBe(
      `Already answered. ${STATUS}`,
    );
  });
  it("adds a full stop when the text has none, even with trailing spaces", async () => {
    expect(await refusalText("Already answered  ")).toBe(
      `Already answered. ${STATUS}`,
    );
  });
  it("is unchanged with no trailing space", async () => {
    expect(await refusalText("Already answered.")).toBe(
      `Already answered. ${STATUS}`,
    );
    expect(await refusalText("Already answered")).toBe(
      `Already answered. ${STATUS}`,
    );
  });
  it("handles tabs and newlines at the end", async () => {
    expect(await refusalText("Already answered.\t\n")).toBe(
      `Already answered. ${STATUS}`,
    );
    expect(await refusalText("Already answered\n\t ")).toBe(
      `Already answered. ${STATUS}`,
    );
  });
  it("keeps a question mark or exclamation mark, with or without trailing space", async () => {
    expect(await refusalText("Is it done? ")).toBe(`Is it done? ${STATUS}`);
    expect(await refusalText("Too late!")).toBe(`Too late! ${STATUS}`);
    expect(await refusalText("Too late! \n")).toBe(`Too late! ${STATUS}`);
  });
  it("does not render trailing whitespace before the status sentence", async () => {
    expect(await refusalText("Already answered. \t ")).not.toMatch(/\s{2,}/);
  });
  // T-089 (T-087 LOW-1): empty or whitespace-only text gives just the status sentence.
  it("whitespace-only or empty text renders only the status sentence", async () => {
    expect(await refusalText("   ")).toBe(STATUS);
    expect(await refusalText("")).toBe(STATUS);
  });
});

// T-089 Tester: every kind of whitespace-only text gives just the status sentence.
describe("refusal alert with blank text (T-089)", () => {
  it.each([
    ["spaces", "     "],
    ["tab", "\t"],
    ["newlines", "\n\n"],
    ["CRLF", "\r\n"],
    ["no-break space", "\u00a0\u00a0"],
    ["mixed", " \t\n\u00a0 "],
  ])("%s only: no leading full stop or space", async (_n, text) => {
    expect(await refusalText(text)).toBe(STATUS);
  });
  it("a trailing no-break space after text still gets one full stop", async () => {
    expect(await refusalText("Already answered\u00a0")).toBe(
      `Already answered. ${STATUS}`,
    );
    expect(await refusalText("Done.\u00a0")).toBe(`Done. ${STATUS}`);
  });
  it("leading whitespace is kept as before (only the end is trimmed)", async () => {
    expect((await refusalText("  Hi")).trimStart()).toBe(`Hi. ${STATUS}`);
  });
});
