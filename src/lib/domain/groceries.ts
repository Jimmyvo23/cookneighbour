// Grocery options (T-044, CLAUDE.md 6.4 step 3). Pure functions, no I/O.
//   Option A "customer_buys": the customer buys the ingredients on the chef's shopping list. For a
//     chef's-home booking the customer delivers or sends them to the chef.
//   Option B "chef_shops": the chef buys the groceries, uploads a receipt, and the customer
//     reimburses AT COST (no markup, no grocery API). MOCK: nothing is charged.
//
// ASSUMPTION (open question for Jimmy): dishes only carry an estimated ingredient COST, not an
// ingredient list, so the shopping list is per dish (name, quantity, servings, estimated cost,
// allergens), not per ingredient.
import { isSafeStoragePath } from "../chef/dishes.ts";
import { hasUnsafeText } from "./text-safety.ts";

export type GroceryOptionKey = "customer_buys" | "chef_shops";
export type LocationKey = "customer_home" | "chef_home";

export const RECEIPT_KEYS = ["filePath", "amountCents"] as const;
export const RECEIPT_RESPOND_KEYS = ["action", "note"] as const;
/** Largest receipt accepted: $5,000.00 (a sanity bound; the amount is a whole number of cents). */
export const RECEIPT_MAX_CENTS = 500_000;
export const RECEIPT_EXTENSIONS = ["png", "jpg", "jpeg", "pdf"] as const;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NOTE_MIN = 3;
const NOTE_MAX = 300;

export interface ShoppingDish {
  name: string;
  quantity: number;
  servings: number;
  ingredientCostCents: number;
  allergens: string[];
}
export interface ShoppingDay {
  dayNumber: number;
  date: string;
  dishes: ShoppingDish[];
}
export interface ShoppingListDay {
  dayNumber: number;
  date: string;
  dishes: (ShoppingDish & { lineCostCents: number })[];
  estimatedCostCents: number;
}
export interface ShoppingList {
  days: ShoppingListDay[];
  /** Sum of every line: equals the booking's estimated ingredients. */
  estimatedCostCents: number;
}

/** Per-dish shopping list, with line costs = cost x quantity (the same sum as pricing.ts). */
export function buildShoppingList(days: ShoppingDay[]): ShoppingList {
  const out = days.map((d) => {
    const dishes = d.dishes.map((x) => ({
      ...x,
      lineCostCents: x.ingredientCostCents * x.quantity,
    }));
    return {
      dayNumber: d.dayNumber,
      date: d.date,
      dishes,
      estimatedCostCents: dishes.reduce((s, x) => s + x.lineCostCents, 0),
    };
  });
  return {
    days: out,
    estimatedCostCents: out.reduce((s, d) => s + d.estimatedCostCents, 0),
  };
}

export interface GroceryPlan {
  /** Who buys the ingredients. */
  buyer: "customer" | "chef";
  /** Where the ingredients must end up. */
  deliverTo: "customer_home" | "chef_home";
  /** True only for option A at the chef's home: the customer delivers or sends the ingredients. */
  customerDeliversToChef: boolean;
  /** Option B only: the chef uploads a receipt and the customer reimburses at cost (MOCK). */
  receiptRequired: boolean;
  note: string;
}

export function groceryPlan(
  option: GroceryOptionKey,
  location: LocationKey,
): GroceryPlan {
  const deliverTo = location;
  if (option === "customer_buys") {
    const toChef = location === "chef_home";
    return {
      buyer: "customer",
      deliverTo,
      customerDeliversToChef: toChef,
      receiptRequired: false,
      note: toChef
        ? "You buy the ingredients and deliver or send them to the chef's home before the cooking day."
        : "You buy the ingredients and have them at your home before the chef arrives.",
    };
  }
  return {
    buyer: "chef",
    deliverTo,
    customerDeliversToChef: false,
    receiptRequired: true,
    note:
      "The chef buys the groceries and uploads the receipt. You reimburse the cost of the groceries at cost, with no markup. " +
      "MOCK: no money moves in this prototype.",
  };
}

/** A receipt object path is `<booking id>/<file name>` in the receipts bucket. */
export function receiptPathError(
  bookingId: string,
  path: unknown,
): string | null {
  if (typeof path !== "string" || path === "") return "Enter the file path.";
  if (hasUnsafeText(path) || !isSafeStoragePath(path))
    return "This file path is not valid.";
  const parts = path.split("/");
  if (parts.length !== 2 || parts[0] !== bookingId)
    return "The receipt must be uploaded to this booking's own folder.";
  const name = parts[1];
  if (!FILE_NAME.test(name)) return "This file name is not valid.";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    !name.includes(".") ||
    !(RECEIPT_EXTENSIONS as readonly string[]).includes(ext)
  )
    return "The receipt must be a PNG, JPG or PDF file.";
  return null;
}

export function parseReceiptBody(
  bookingId: string,
  body: Record<string, unknown>,
):
  | { value: { filePath: string; amountCents: number } }
  | { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const pathErr = receiptPathError(bookingId, body.filePath);
  if (pathErr) fields.filePath = pathErr;
  const a = body.amountCents;
  if (typeof a !== "number" || !Number.isSafeInteger(a))
    fields.amountCents = "Enter the amount as a whole number of cents.";
  else if (a < 1 || a > RECEIPT_MAX_CENTS)
    fields.amountCents = `The amount must be between 1 and ${RECEIPT_MAX_CENTS} cents.`;
  if (Object.keys(fields).length) return { fields };
  return {
    value: { filePath: body.filePath as string, amountCents: a as number },
  };
}

export type ReceiptAnswer = {
  action: "confirm" | "dispute";
  note: string | null;
};

/** `confirm` needs no note; `dispute` needs a 3 to 300 character note (what is wrong). */
export function parseReceiptAnswer(
  body: Record<string, unknown>,
): { value: ReceiptAnswer } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const action = body.action;
  if (action !== "confirm" && action !== "dispute")
    fields.action = 'Use "confirm" or "dispute".';
  let note: string | null = null;
  const n = body.note;
  if (action === "dispute") {
    if (typeof n !== "string" || n.trim().length < NOTE_MIN)
      fields.note = `Say what is wrong (${NOTE_MIN} to ${NOTE_MAX} characters).`;
    else if (n.trim().length > NOTE_MAX)
      fields.note = `Use at most ${NOTE_MAX} characters.`;
    else if (hasUnsafeText(n.trim()))
      fields.note = "Remove control or invalid characters.";
    else note = n.trim();
  } else if (n !== undefined && n !== null && n !== "") {
    fields.note = "A note is only for a dispute.";
  }
  if (Object.keys(fields).length) return { fields };
  return { value: { action: action as "confirm" | "dispute", note } };
}

export const RECEIPT_REFUSALS: Record<string, string> = {
  not_chef_shops:
    "Receipts are only used when the chef shops for the groceries (option B).",
  wrong_status:
    "Receipts can only be added to an accepted or completed booking.",
  receipt_waiting: "A receipt is already waiting for the customer's answer.",
  receipt_confirmed:
    "The customer already confirmed a receipt for this booking.",
  path_used:
    "This file was already registered. Upload it again under a new name.",
  already_answered: "This receipt was already answered.",
  receipt_superseded: "This receipt was replaced by a newer one.",
  // T-064 (D-53): neutral, it does not say why.
  frozen:
    "This booking is on hold while an admin looks at it. Nothing can be changed until they decide.",
};
