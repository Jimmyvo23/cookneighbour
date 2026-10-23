import { describe, expect, it } from "vitest";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { retryIfDayRolled } from "./midnight";

/** A clock that returns the given dates in order, then repeats the last one. */
const clock = (...dates: string[]) => {
  let i = 0;
  return () => dates[Math.min(i++, dates.length - 1)];
};

describe("retryIfDayRolled (T-115)", () => {
  it("reproduces the flake: ticked days from before midnight vs the API's today after", () => {
    // 03:59 UTC = 23:59 Toronto on 2026-10-22; 04:00 UTC = 00:00 on 2026-10-23.
    const before = new Date("2026-10-23T03:59:30Z");
    const after = new Date("2026-10-23T04:00:30Z");
    expect(torontoToday(before)).toBe("2026-10-22");
    expect(torontoToday(after)).toBe("2026-10-23");
    const ticked = [0, 1, 2, 3].map((n) => addDays(torontoToday(before), n));
    const apiWindow = ticked.filter((d) => d > torontoToday(after));
    const expected = [1, 2, 3].map((n) => addDays(torontoToday(after), n));
    expect(apiWindow).not.toEqual(expected); // the CI failure: two days, not three
  });

  it("runs once and returns when nothing fails", async () => {
    let n = 0;
    expect(await retryIfDayRolled(async () => ++n, clock("a"))).toBe(1);
  });

  it("retries once, on the new day, when the body fails and the date rolled", async () => {
    let n = 0;
    const r = await retryIfDayRolled(
      async () => {
        if (++n === 1) throw new Error("window straddled midnight");
        return "ok";
      },
      clock("2026-10-22", "2026-10-23"),
    );
    expect(r).toBe("ok");
    expect(n).toBe(2);
  });

  it("rethrows a failure on a steady date without retrying", async () => {
    let n = 0;
    await expect(
      retryIfDayRolled(async () => {
        n++;
        throw new Error("real bug");
      }, clock("2026-10-22")),
    ).rejects.toThrow("real bug");
    expect(n).toBe(1);
  });

  it("does not hide a real failure that repeats after the roll", async () => {
    let n = 0;
    await expect(
      retryIfDayRolled(
        async () => {
          n++;
          throw new Error("real bug");
        },
        clock("2026-10-22", "2026-10-23"),
      ),
    ).rejects.toThrow("real bug");
    expect(n).toBe(2);
  });
});
