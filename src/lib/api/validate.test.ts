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

// T-059 tester: verdict table for display name / address text. The client rule on T-033
// (displayNameProblem: trim, 1 to 80 characters, hasUnsafeText) must give the same answers.
describe("Fields.text verdict table (matches the T-033 client rule)", () => {
  const table: [string, string, boolean][] = [
    ["plain", "Mai", true],
    ["accents", "Nguyễn Thị Mai", true],
    ["apostrophe and hyphen", "O'Brien-Smith", true],
    ["emoji surrogate pair", "Zoë 👩‍🍳 🏠", true],
    ["exactly 80", "x".repeat(80), true],
    ["81 characters", "x".repeat(81), false],
    ["empty", "", false],
    ["spaces only", "   ", false],
    ["NUL", "Mai\u0000", false],
    ["tab inside", "Ma\ti", false],
    ["newline inside", "Ma\ni", false],
    ["DEL", "Ma\u007fi", false],
    ["lone high surrogate", "Mai\ud83d", false],
    ["lone low surrogate", "\udc00Mai", false],
    ["high surrogate then ASCII", "\ud83dx", false],
    ["trailing newline is trimmed away", "Mai\n", true],
    ["C1 control is not refused (same as the client)", "Ma\u0085i", true],
  ];
  it.each(table)("%s", (_n, value, accepted) => {
    const f = new Fields();
    f.text({ n: value }, "n", 1, 80);
    expect("n" in f.errors).toBe(!accepted);
  });
});
