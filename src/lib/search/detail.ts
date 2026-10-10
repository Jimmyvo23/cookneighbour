// Pure helpers for the public chef page (T-041). The server stays the authority (contract section
// 7); these only format what GET /api/chefs/:id returned. No network, no DOM, no browser clock.
import type { LocationType } from "@/lib/api/types";
import { isRealDate } from "@/lib/domain/dishes";

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export interface MonthGroup {
  /** YYYY-MM. */
  month: string;
  /** For example "October 2026". */
  label: string;
  dates: string[];
}

/** Bookable dates grouped by month. Sorted, de-duplicated; anything that is not a real date is dropped. */
export function groupDatesByMonth(dates: readonly string[]): MonthGroup[] {
  const clean = [...new Set(dates.filter((d) => isRealDate(d)))].sort();
  const groups: MonthGroup[] = [];
  for (const d of clean) {
    const month = d.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.month !== month) {
      g = {
        month,
        label: new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC",
          month: "long",
          year: "numeric",
        }).format(noon(d)),
        dates: [],
      };
      groups.push(g);
    }
    g.dates.push(d);
  }
  return groups;
}

/** For example "Mon, Oct 12". Dates are Toronto calendar days, so no time-zone shift is applied. */
export function shortDayLabel(day: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(noon(day));
}

/** Allergens as plain words. An empty list says only that the chef listed none: never "free". */
export function allergenText(allergens: readonly string[]): string {
  return allergens.length
    ? `Contains: ${allergens.join(", ")}`
    : "No allergens listed by the chef";
}

const LOCATION_LABEL: Record<LocationType, string> = {
  customer_home: "At your home",
  chef_home: "At the chef's home",
};

/** Labels for exactly the options the API returned (it already hides an unapproved chef's home). */
export function locationLabels(options: readonly LocationType[]): string[] {
  return options.map((o) => LOCATION_LABEL[o]);
}

/** A chef with no visible location option cannot be booked yet (Q-21 is open). */
export const isBookable = (options: readonly LocationType[]): boolean =>
  options.length > 0;

export function windowText(today: string, last: string): string {
  return `Dates from ${shortDayLabel(today)} to ${shortDayLabel(last, true)}.`;
}
