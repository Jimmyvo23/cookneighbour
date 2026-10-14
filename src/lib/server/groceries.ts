// Server side of the grocery routes (T-044, contract section 7B).
//
// Authorization (contract section 2): the role comes from profiles.role (requireChefParty /
// requireCustomer / requireBookingParty in bookings.ts; admins get 403). The booking id from the
// URL is matched against the caller's OWN rows (customer_id or chef_id = the session user); someone
// else's booking and a missing one give the same 404. The route parses the JSON body first
// (400 for malformed JSON), but no field of it is looked at before the ownership check. Reads
// use the caller's user-scoped client, so row-level security is a second line of defence (bookings,
// booking_days, receipts and the receipts bucket are readable by the two parties and admin only).
// Writes are the database functions submit_receipt / answer_receipt: the booking row is locked FOR
// UPDATE and the state is re-checked under that lock, in one transaction.
//
// Upload flow: the chef's browser uploads the file to the `receipts` bucket at
// `<booking id>/<new file name>` with the chef's own session (storage policy: only the booking's
// chef, only while accepted or completed, insert only, no update or delete), then calls
// POST /api/bookings/:id/receipts to register it. The route checks the path shape, that the object
// really exists, and the database refuses a path that was registered before (a new name per upload).
//
// MOCK: reimbursement is recorded and shown, never collected. No markup, no grocery API.
import "server-only";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import { rejectUnknownKeys } from "@/lib/api/request";
import type {
  ReceiptList,
  ReceiptView,
  ShoppingListResponse,
} from "@/lib/api/types";
import { isUuid } from "@/lib/domain/admin-chefs";
import {
  RECEIPT_KEYS,
  RECEIPT_REFUSALS,
  RECEIPT_RESPOND_KEYS,
  buildShoppingList,
  groceryPlan,
  parseReceiptAnswer,
  parseReceiptBody,
} from "@/lib/domain/groceries";
import { checkReceipt } from "@/lib/domain/receipt";
import type { BookingCaller } from "@/lib/server/bookings";
import { objectExists } from "@/lib/server/storage";

type Row = Record<string, unknown>;

const notFound = () => new ApiFailure("NOT_FOUND", "Booking not found.");
const SIGNED_URL_SECONDS = 600;

const BOOKING_COLS =
  "id, customer_id, chef_id, status, location_type, grocery_option, est_ingredients_cents, currency";

/** The booking as the caller sees it (RLS), and only if the caller is its customer or its chef. */
async function loadOwn(caller: BookingCaller, id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound();
  const r = await caller.supabase
    .from("bookings")
    .select(BOOKING_COLS)
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw new Error("booking lookup failed");
  const b = r.data as Row | null;
  // RLS also shows an admin every booking; the routes refuse admins, but never rely on that alone.
  if (!b || (b.customer_id !== caller.userId && b.chef_id !== caller.userId))
    throw notFound();
  return b;
}

// ---------------------------------------------------------------------------
// GET /api/bookings/:id/shopping-list   (customer or chef of the booking)
// ---------------------------------------------------------------------------
export async function getShoppingList(
  caller: BookingCaller,
  id: string,
): Promise<ShoppingListResponse> {
  const b = await loadOwn(caller, id);
  const days = await caller.supabase
    .from("booking_days")
    .select("id, day_number, visit_date")
    .eq("booking_id", id)
    .order("day_number");
  if (days.error) throw new Error("shopping list: days failed");
  const dayIds = (days.data as Row[]).map((d) => d.id as string);
  const dishes = dayIds.length
    ? await caller.supabase
        .from("booking_day_dishes")
        .select(
          "booking_day_id, dish_name, quantity, servings, ingredient_cost_cents, allergens, created_at, id",
        )
        .in("booking_day_id", dayIds)
        .order("created_at")
        .order("id")
    : { data: [] as Row[], error: null };
  if (dishes.error) throw new Error("shopping list: dishes failed");
  const list = buildShoppingList(
    (days.data as Row[]).map((d) => ({
      dayNumber: d.day_number as number,
      date: String(d.visit_date),
      dishes: (dishes.data as Row[])
        .filter((x) => x.booking_day_id === d.id)
        .map((x) => ({
          name: x.dish_name as string,
          quantity: x.quantity as number,
          servings: x.servings as number,
          ingredientCostCents: x.ingredient_cost_cents as number,
          allergens: (x.allergens as string[]) ?? [],
        })),
    })),
  );
  return {
    bookingId: id,
    groceryOption: b.grocery_option as "customer_buys" | "chef_shops",
    locationType: b.location_type as "customer_home" | "chef_home",
    currency: b.currency as string,
    plan: groceryPlan(
      b.grocery_option as "customer_buys" | "chef_shops",
      b.location_type as "customer_home" | "chef_home",
    ),
    ...list,
  };
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
const RECEIPT_COLS =
  "id, booking_id, file_path, amount_cents, currency, mismatch_flagged, customer_confirmed_at, customer_disputed_at, dispute_note, superseded_at, created_at";

const isoOrNull = (v: unknown) =>
  v ? new Date(v as string).toISOString() : null;

function receiptView(
  r: Row,
  estimated: number,
  fileUrl: string | null,
): ReceiptView {
  const check = checkReceipt(estimated, r.amount_cents as number);
  const confirmed = r.customer_confirmed_at != null;
  const disputed = r.customer_disputed_at != null;
  const superseded = r.superseded_at != null;
  return {
    id: r.id as string,
    bookingId: r.booking_id as string,
    amountCents: r.amount_cents as number,
    currency: r.currency as string,
    estimatedIngredientsCents: estimated,
    differenceCents: check.differenceCents,
    toleranceCents: check.toleranceCents,
    mismatchFlagged: r.mismatch_flagged as boolean,
    status: superseded
      ? "superseded"
      : confirmed
        ? "confirmed"
        : disputed
          ? "disputed"
          : "waiting",
    customerConfirmedAt: isoOrNull(r.customer_confirmed_at),
    customerDisputedAt: isoOrNull(r.customer_disputed_at),
    disputeNote: (r.dispute_note as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    fileUrl,
    // MOCK: the customer reimburses the receipt amount at cost once confirmed; nothing is charged.
    reimbursement: {
      mock: true,
      collected: false,
      amountCents: confirmed ? (r.amount_cents as number) : null,
    },
  };
}

async function signedUrl(
  caller: BookingCaller,
  path: string,
): Promise<string | null> {
  try {
    const r = await caller.supabase.storage
      .from("receipts")
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    return r.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// GET /api/bookings/:id/receipts   (customer or chef of the booking)
export async function listReceipts(
  caller: BookingCaller,
  id: string,
): Promise<ReceiptList> {
  const b = await loadOwn(caller, id);
  const r = await caller.supabase
    .from("receipts")
    .select(RECEIPT_COLS)
    .eq("booking_id", id)
    .order("created_at")
    .order("id");
  if (r.error) throw new Error("receipts read failed");
  const estimated = b.est_ingredients_cents as number;
  const items = await Promise.all(
    (r.data as Row[]).map(async (row) =>
      receiptView(
        row,
        estimated,
        row.superseded_at
          ? null
          : await signedUrl(caller, row.file_path as string),
      ),
    ),
  );
  return {
    bookingId: id,
    groceryOption: b.grocery_option as "customer_buys" | "chef_shops",
    estimatedIngredientsCents: estimated,
    currency: b.currency as string,
    items,
  };
}

// POST /api/bookings/:id/receipts   (the booking's chef)
export async function submitReceipt(
  caller: BookingCaller,
  id: string,
  body: Record<string, unknown>,
): Promise<ReceiptView> {
  const b = await loadOwn(caller, id);
  if (b.chef_id !== caller.userId) throw notFound();
  rejectUnknownKeys(body, [...RECEIPT_KEYS]);
  const p = parseReceiptBody(id, body);
  if ("fields" in p) throw validationFailed(p.fields);
  const { filePath, amountCents } = p.value;
  // Cheap early refusals with a clear reason; the database function re-checks all of them under
  // the booking lock.
  if (b.grocery_option !== "chef_shops") throw refusal("not_chef_shops");
  if (b.status !== "accepted" && b.status !== "completed")
    throw refusal("wrong_status");
  // A client cannot register a path it never uploaded.
  if (!(await objectExists(caller.admin, "receipts", filePath)))
    throw validationFailed({
      filePath: "Upload the file first, then register it.",
    });
  const estimated = b.est_ingredients_cents as number;
  const check = checkReceipt(estimated, amountCents);
  const r = await caller.admin.rpc("submit_receipt", {
    p_booking: id,
    p_chef: caller.userId,
    p_path: filePath,
    p_amount: amountCents,
    p_mismatch: check.mismatch,
  });
  if (r.error) throw new Error(`submit_receipt failed: ${r.error.message}`);
  const out = r.data as Row;
  if (out.result === "not_found") throw notFound();
  if (out.result === "invalid_state") throw refusal(String(out.reason));
  if (out.result !== "ok") throw new Error("submit_receipt: unknown result");
  return readOne(caller, id, out.receipt_id as string, estimated);
}

// POST /api/bookings/:id/receipts/:receiptId/respond   (the booking's customer)
export async function answerReceipt(
  caller: BookingCaller,
  id: string,
  receiptId: string,
  body: Record<string, unknown>,
): Promise<ReceiptView> {
  const b = await loadOwn(caller, id);
  if (b.customer_id !== caller.userId) throw notFound();
  if (!isUuid(receiptId))
    throw new ApiFailure("NOT_FOUND", "Receipt not found.");
  rejectUnknownKeys(body, [...RECEIPT_RESPOND_KEYS]);
  const p = parseReceiptAnswer(body);
  if ("fields" in p) throw validationFailed(p.fields);
  const r = await caller.admin.rpc("answer_receipt", {
    p_booking: id,
    p_customer: caller.userId,
    p_receipt: receiptId,
    p_action: p.value.action,
    p_note: p.value.note,
  });
  if (r.error) throw new Error(`answer_receipt failed: ${r.error.message}`);
  const out = r.data as Row;
  if (out.result === "not_found")
    throw new ApiFailure("NOT_FOUND", "Receipt not found.");
  if (out.result === "invalid_state") throw refusal(String(out.reason));
  if (out.result !== "ok") throw new Error("answer_receipt: unknown result");
  return readOne(caller, id, receiptId, b.est_ingredients_cents as number);
}

function refusal(reason: string): ApiFailure {
  return new ApiFailure(
    "INVALID_STATE",
    RECEIPT_REFUSALS[reason] ?? RECEIPT_REFUSALS.wrong_status,
    { reason },
  );
}

async function readOne(
  caller: BookingCaller,
  bookingId: string,
  receiptId: string,
  estimated: number,
): Promise<ReceiptView> {
  const r = await caller.supabase
    .from("receipts")
    .select(RECEIPT_COLS)
    .eq("id", receiptId)
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (r.error || !r.data) throw new Error("receipt read failed");
  const row = r.data as Row;
  return receiptView(
    row,
    estimated,
    row.superseded_at ? null : await signedUrl(caller, row.file_path as string),
  );
}
