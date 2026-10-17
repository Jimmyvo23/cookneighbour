// @vitest-environment jsdom
// T-080 round 2 Tester: the receipts reload after a refusal. A receipt UPLOAD 409 reloads once; a
// non-409 receipt error does not; StrictMode neither reloads on mount nor doubles the reload.
// Booking from the MOCK seed (lessons-learned section 3).
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail } from "@/lib/api/types";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  seededBooking,
  type Harness,
} from "@/components/booking/testkit";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
const upload = vi.fn();
vi.mock("@/lib/chef/upload", async (orig) => ({
  ...(await orig<typeof import("@/lib/chef/upload")>()),
  browserUploader: async () => ({ upload }),
}));

import { ChefBookingView } from "@/components/booking/ChefBookingView";

let h: Harness;
beforeEach(() => {
  h = harness();
  upload.mockReset();
  upload.mockResolvedValue({ error: null });
});
afterEach(() => h.cleanup());

const gets = (b: BookingDetail, tail = "") =>
  callsTo(h.fetchMock, `/api/bookings/${b.id}${tail}`).filter(
    (c) => c[1] === "GET",
  ).length;

async function setup(post: ReturnType<typeof apiError>, strict = false) {
  const b = seededBooking(9104, "chef");
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}`]: json(200, b),
    [`GET /api/bookings/${b.id}/shopping-list`]: json(200, {
      bookingId: b.id,
      groceryOption: b.groceryOption,
      locationType: b.locationType,
      currency: "CAD",
      plan: {
        buyer: "chef",
        deliverTo: b.locationType,
        customerDeliversToChef: false,
        receiptRequired: true,
        note: "x",
      },
      days: [],
      estimatedCostCents: 0,
    }),
    [`GET /api/bookings/${b.id}/receipts`]: json(200, {
      bookingId: b.id,
      groceryOption: b.groceryOption,
      estimatedIngredientsCents: b.estimate.ingredientsCents,
      currency: "CAD",
      items: [],
    }),
    [`POST /api/bookings/${b.id}/receipts`]: post,
  });
  await h.mount(
    strict ? (
      <StrictMode>
        <ChefBookingView id={b.id} />
      </StrictMode>
    ) : (
      <ChefBookingView id={b.id} />
    ),
  );
  await h.flush();
  const input = h.host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [
      new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" }),
    ],
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await h.flush();
  await h.type(h.host.querySelector('input[inputmode="decimal"]'), "$68.50");
  return b;
}

describe("receipts reload after a refusal", () => {
  it("an upload 409 reloads the receipts once, keeps the page alert focused, no loop", async () => {
    const b = await setup(
      apiError(409, "INVALID_STATE", "x", { reason: "receipt_waiting" }),
    );
    const before = gets(b, "/receipts");
    await h.click(h.button("Send receipt"));
    await h.flush();
    expect(gets(b, "/receipts")).toBe(before + 1);
    expect(h.qa("refusal")).toHaveLength(1);
    expect(document.activeElement).toBe(h.q("refusal"));
    await h.flush();
    expect(gets(b, "/receipts")).toBe(before + 1);
  });

  it("a 422 on the upload does not reload and keeps the section alert", async () => {
    const b = await setup(apiError(422, "VALIDATION_ERROR", "bad amount"));
    const before = gets(b, "/receipts");
    const bookingBefore = gets(b);
    await h.click(h.button("Send receipt"));
    await h.flush();
    expect(gets(b, "/receipts")).toBe(before);
    expect(gets(b)).toBe(bookingBefore);
    expect(h.q("refusal")).toBeNull();
  });

  it("StrictMode: no reload from mounting; one reload per refusal", async () => {
    const b = await setup(
      apiError(409, "INVALID_STATE", "x", { reason: "receipt_waiting" }),
      true,
    );
    const afterMount = gets(b, "/receipts");
    await h.flush();
    expect(gets(b, "/receipts")).toBe(afterMount);
    await h.click(h.button("Send receipt"));
    await h.flush();
    expect(gets(b, "/receipts")).toBe(afterMount + 1);
    expect(h.qa("refusal")).toHaveLength(1);
    expect(document.activeElement).toBe(h.q("refusal"));
  });
});
