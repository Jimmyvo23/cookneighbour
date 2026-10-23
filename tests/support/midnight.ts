// T-115: make a test safe across Toronto midnight. A test that ticks chef days relative to
// "today" and later asks the API (which reads its own "today") can straddle midnight: the days were
// ticked for yesterday's window and the API answers for today's. If the body fails AND the Toronto
// date changed while it ran, the failure is a clock artefact: run the body once more, on the new
// day, from scratch. A failure on a steady date is rethrown untouched, so nothing is weakened.
import { torontoToday } from "@/lib/domain/dishes";

export async function retryIfDayRolled<T>(
  body: () => Promise<T>,
  now: () => string = () => torontoToday(),
): Promise<T> {
  const before = now();
  try {
    return await body();
  } catch (e) {
    if (now() === before) throw e;
    return await body(); // the date rolled over: one clean attempt on the new day
  }
}
