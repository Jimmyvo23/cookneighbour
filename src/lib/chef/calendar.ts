// Pure date helpers for the availability calendar (T-034). Dates are YYYY-MM-DD strings in the
// server's America/Toronto calendar. Nothing here reads the browser clock: `today` and the last
// bookable day always come from GET /api/chef/availability (contract 5B).
import { addDays } from "@/lib/domain/dishes";

export { addDays };

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** First day of the month containing `day`. */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

export function addMonths(day: string, n: number): string {
  const d = noon(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function monthLabel(day: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(noon(day));
}

/** For example "Thursday, October 8, 2026". */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(noon(day));
}

/** 0 = Sunday ... 6 = Saturday. */
export const weekday = (day: string) => noon(day).getUTCDay();

export const dayNumber = (day: string) => Number(day.slice(8, 10));

export function daysInMonth(day: string): number {
  const d = noon(monthStart(addMonths(day, 1)));
  d.setUTCDate(0);
  return d.getUTCDate();
}

/** The month as weeks (Sunday first). Cells outside the month are null. */
export function monthGrid(day: string): (string | null)[][] {
  const first = monthStart(day);
  const cells: (string | null)[] = Array(weekday(first)).fill(null);
  for (let i = 0; i < daysInMonth(first); i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const inWindow = (day: string, today: string, last: string) =>
  day >= today && day <= last;

export type CalendarKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

/**
 * Where the keyboard focus goes from `day` for a grid navigation key, kept inside the bookable
 * window (it stays put at the edges). Home/End jump to the start/end of the week row.
 */
export function moveFocus(
  day: string,
  key: CalendarKey,
  today: string,
  last: string,
): string {
  let next = day;
  switch (key) {
    case "ArrowLeft":
      next = addDays(day, -1);
      break;
    case "ArrowRight":
      next = addDays(day, 1);
      break;
    case "ArrowUp":
      next = addDays(day, -7);
      break;
    case "ArrowDown":
      next = addDays(day, 7);
      break;
    case "Home":
      next = addDays(day, -weekday(day));
      break;
    case "End":
      next = addDays(day, 6 - weekday(day));
      break;
    case "PageUp":
    case "PageDown": {
      const target = addMonths(day, key === "PageUp" ? -1 : 1);
      const n = Math.min(dayNumber(day), daysInMonth(target));
      next = `${target.slice(0, 8)}${String(n).padStart(2, "0")}`;
      break;
    }
  }
  if (next < today) return key === "Home" || key === "PageUp" ? today : day;
  if (next > last) return key === "End" || key === "PageDown" ? last : day;
  return next;
}

/** What to send: dates newly ticked (`add`) and dates cleared (`remove`). Sorted. */
export function diffDays(
  saved: readonly string[],
  draft: readonly string[],
): { add: string[]; remove: string[] } {
  const s = new Set(saved);
  const d = new Set(draft);
  return {
    add: [...d].filter((x) => !s.has(x)).sort(),
    remove: [...s].filter((x) => !d.has(x)).sort(),
  };
}

/** The message for a refused clear of booked dates (409 DATE_BOOKED, D-22). Nothing was saved. */
export function bookedDatesMessage(dates: readonly string[]): string {
  if (dates.length === 0)
    return "You cannot clear a day that has a booking. Nothing was saved.";
  const list = dates.map(dayLabel).join("; ");
  return `Nothing was saved. You cannot clear ${dates.length === 1 ? "a day that has" : "days that have"} a booking: ${list}. Keep ${dates.length === 1 ? "it" : "them"} ticked.`;
}
