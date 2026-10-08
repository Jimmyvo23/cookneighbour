import { describe, expect, it } from "vitest";
import { Fields } from "./validate";

describe("Fields.text", () => {
  it("accepts normal and accented names, and trims", () => {
    const f = new Fields();
    expect(f.text({ n: "  Nguyễn Thị Mai " }, "n", 1, 80)).toBe(
      "Nguyễn Thị Mai",
    );
    expect(f.text({ n: "Zoë 👩‍🍳" }, "n", 1, 80)).toBe("Zoë 👩‍🍳");
    expect(f.errors).toEqual({});
  });
  it.each([
    ["NUL", "Mai\u0000"],
    ["tab inside", "Ma\ti"],
    ["newline", "Ma\ni"],
    ["DEL", "Ma\u007fi"],
    ["lone high surrogate", "Mai\ud83d"],
    ["lone low surrogate", "\udc00Mai"],
  ])("rejects %s", (_n, v) => {
    const f = new Fields();
    f.text({ n: v }, "n", 1, 80);
    expect(f.errors.n).toBe("Remove control or invalid characters.");
  });
  it("keeps the length and type messages", () => {
    const f = new Fields();
    f.text({ n: "" }, "n", 1, 80);
    f.text({}, "m", 1, 80);
    expect(f.errors).toEqual({
      n: "Enter 1 to 80 characters.",
      m: "Required.",
    });
  });
  it("Fields.string is unchanged (no unsafe-text rule)", () => {
    const f = new Fields();
    f.string({ n: "a\u0000b" }, "n", 1, 80);
    expect(f.errors).toEqual({});
  });
});
