// Eat-by date (A-7): cook date + the dish's shelf-life days (default 2, 0 to 7 by D-16).
// The real safe window must be confirmed against Ontario public-health guidance before any real
// launch (Q-10); this is not a food-safety claim.
import { addDays, isRealDate, SHELF_LIFE_MAX_DAYS } from "./dishes.ts";

export function eatByDate(cookDate: string, shelfLifeDays: number): string {
  if (!isRealDate(cookDate))
    throw new RangeError("cookDate must be YYYY-MM-DD");
  if (
    !Number.isInteger(shelfLifeDays) ||
    shelfLifeDays < 0 ||
    shelfLifeDays > SHELF_LIFE_MAX_DAYS
  )
    throw new RangeError("shelfLifeDays must be a whole number from 0 to 7");
  return addDays(cookDate, shelfLifeDays);
}
