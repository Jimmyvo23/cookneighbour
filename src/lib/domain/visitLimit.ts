// The 6-hour soft limit per visit (CLAUDE.md 6.5). Soft means: warn, and require the customer to
// remove dishes or split the work across days; the limit itself is configurable (config.ts).
import { VISIT_SOFT_LIMIT_MINUTES } from "./config.ts";

export interface VisitLimitWarning {
  code: "VISIT_OVER_SOFT_LIMIT";
  /** Zero-based index of the booking day. */
  dayIndex: number;
  minutes: number;
  overByMinutes: number;
}

/** One warning for each day whose total cook time is strictly over the limit. */
export function checkVisitLimits(
  minutesPerDay: readonly number[],
  limitMinutes: number = VISIT_SOFT_LIMIT_MINUTES,
): VisitLimitWarning[] {
  const out: VisitLimitWarning[] = [];
  minutesPerDay.forEach((minutes, dayIndex) => {
    if (minutes > limitMinutes)
      out.push({
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex,
        minutes,
        overByMinutes: minutes - limitMinutes,
      });
  });
  return out;
}
