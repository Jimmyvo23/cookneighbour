// @vitest-environment jsdom
// T-045: groceries on a booking against a stubbed network and a stubbed uploader. Option A shows
// the per-dish list and the plan note; option B lets the chef upload a receipt (fresh name, own
// session, never upsert) and the customer confirm or dispute it. Flagged receipts show the
// difference and the tolerance and need an explicit answer. Reimbursement always shows MOCK.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDetail, ReceiptList, ReceiptView } from "@/lib/api/types";
import { groceryPlan, buildShoppingList } from "@/lib/domain/groceries";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  seededBooking,
  seededReceipts,
  type Harness,
} from "@/components/booking/testkit";

const upload = vi.fn();
vi.mock("@/lib/chef/upload", async (orig) => ({
  ...(await orig<typeof import("@/lib/chef/upload")>()),
  browserUploader: async () => ({ upload }),
}));

import { GroceriesSection } from "@/components/booking/GroceriesSection";

let h: Harness;
beforeEach(() => {
  h = harness();
  upload.mockReset();
  upload.mockResolvedValue({ error: null });
});
afterEach(() => h.cleanup());

function listFor(b: BookingDetail) {
  const l = buildShoppingList(
    b.days.map((d) => ({
      dayNumber: d.dayNumber,
      date: d.date,
      dishes: d.dishes.map((x) => ({
        name: x.name,
        quantity: x.quantity,
        servings: x.servings,
        ingredientCostCents: x.ingredientCostCents,
        allergens: x.allergens,
      })),
    })),
  );
  return {
    bookingId: b.id,
    groceryOption: b.groceryOption,
    locationType: b.locationType,
    currency: "CAD",
    plan: groceryPlan(b.groceryOption, b.locationType),
    days: l.days,
    estimatedCostCents: l.estimatedCostCents,
  };
}
function receiptsFor(b: BookingDetail, items: ReceiptView[] = []): ReceiptList {
  return {
    bookingId: b.id,
    groceryOption: b.groceryOption,
    estimatedIngredientsCents: b.estimate.ingredientsCents,
    currency: "CAD",
    items,
  };
}
function flagged(b: BookingDetail): ReceiptView {
  const { filePath: _f, ...v } = seededReceipts()[b.id][0];
  void _f;
  return v;
}

async function open(
  b: BookingDetail,
  viewer: "chef" | "customer",
  items: ReceiptView[] = [],
  extra: Record<string, Parameters<typeof routes>[1][string]> = {},
) {
  routes(h.fetchMock, {
    [`GET /api/bookings/${b.id}/shopping-list`]: json(200, listFor(b)),
    [`GET /api/bookings/${b.id}/receipts`]: json(200, receiptsFor(b, items)),
    ...extra,
  });
  await h.mount(<GroceriesSection booking={b} viewer={viewer} />);
}

describe("option A: the shopping list", () => {
  it("shows the list per dish, the total and the plan note (customer's wording for the customer)", async () => {
    const b = seededBooking(9103, "customer"); // option A at the chef's home
    await open(b, "customer");
    expect(h.qa("shopping-dish")).toHaveLength(1);
    expect(h.q("shopping-list")?.textContent).toContain("Bun cha");
    expect(h.q("shopping-total")?.textContent).toContain("$22.00");
    expect(h.q("plan-note")?.textContent).toBe(listFor(b).plan.note);
    expect(h.q("plan-note")?.textContent).toContain(
      "deliver or send them to the chef's home",
    );
    expect(h.q("receipts")).toBeNull();
    expect(callsTo(h.fetchMock, "/receipts")).toHaveLength(0);
  });

  it("tells the chef the same facts in the chef's words", async () => {
    const b = seededBooking(9103, "chef");
    await open(b, "chef");
    const note = h.q("plan-note")?.textContent ?? "";
    expect(note).toContain(
      "The customer buys the ingredients and delivers or sends them to your home",
    );
    expect(note).not.toContain("You buy");
    expect(h.text()).toContain("Option A: the customer buys the ingredients.");
  });

  it("option A at the customer's home", async () => {
    await open(seededBooking(9101, "chef"), "chef");
    expect(h.q("plan-note")?.textContent).toContain("has them at their home");
  });

  it("is hidden for a declined booking", async () => {
    await open(
      seededBooking(9101, "chef", (x) => ({ ...x, status: "declined" })),
      "chef",
    );
    expect(h.q("groceries")).toBeNull();
    expect(callsTo(h.fetchMock, "/shopping-list")).toHaveLength(0);
  });

  it("a reply of the wrong shape is an error with Try again, not a broken page", async () => {
    const b = seededBooking(9101, "chef");
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}/shopping-list`]: json(200, { hello: 1 }),
    });
    await h.mount(<GroceriesSection booking={b} viewer="chef" />);
    expect(h.q("groceries-error")).not.toBeNull();
    expect(h.button("Try again")).not.toBeNull();
  });
});

describe("option B: the chef's receipt", () => {
  const FILE = () =>
    new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" });
  async function pick(file: File | null) {
    const input = h.host.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: file ? [file] : [],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await h.flush();
  }

  it("shows the upload form for an accepted option B booking with no receipt", async () => {
    const b = seededBooking(9104, "chef");
    await open(b, "chef");
    expect(h.q("no-receipt")?.textContent).toContain("not added a receipt yet");
    expect(h.q("receipt-form")).not.toBeNull();
    expect(h.text()).toContain("PNG, JPEG or PDF, up to 10 MB");
    expect(h.text()).toContain("no markup");
  });

  it("no file and no amount: nothing is uploaded, both fields are marked, focus goes to the first", async () => {
    const b = seededBooking(9104, "chef");
    await open(b, "chef");
    await h.click(h.button("Send receipt"));
    expect(upload).not.toHaveBeenCalled();
    expect(
      callsTo(h.fetchMock, "/receipts").filter((c) => c[1] === "POST"),
    ).toHaveLength(0);
    const file = h.host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(file);
    expect(h.text()).toContain("Choose the receipt file first.");
    expect(h.text()).toContain("Enter the amount you paid");
  });

  it("uploads to receipts/<booking id>/<fresh name> without upsert, then registers path and cents", async () => {
    const b = seededBooking(9104, "chef");
    const sent: ReceiptView = {
      ...flagged(seededBooking(9106, "chef")),
      id: "r-new",
      bookingId: b.id,
      status: "waiting",
      mismatchFlagged: false,
    };
    await open(b, "chef", [], {
      [`POST /api/bookings/${b.id}/receipts`]: json(201, sent),
    });
    await pick(FILE());
    await h.type(h.host.querySelector('input[inputmode="decimal"]'), "$68.50");
    expect(h.q("receipt-preview")?.textContent).toContain(
      "close to the estimate",
    );
    await h.click(h.button("Send receipt"));
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, , options] = upload.mock.calls[0];
    expect(bucket).toBe("receipts");
    expect(path).toMatch(new RegExp(`^${b.id}/[0-9a-f-]{36}\\.png$`));
    expect(options).toEqual({ upsert: false, contentType: "image/png" });
    const post = callsTo(h.fetchMock, "/receipts").filter(
      (c) => c[1] === "POST",
    );
    expect(post).toHaveLength(1);
    expect(post[0][2]).toEqual({ filePath: path, amountCents: 6850 });
    expect(document.activeElement).toBe(h.q("groceries-notice"));
    expect(h.q("groceries-notice")?.textContent).toContain("Receipt sent");
  });

  it("previews that a far-off amount will be flagged", async () => {
    await open(seededBooking(9104, "chef"), "chef");
    await h.type(h.host.querySelector('input[inputmode="decimal"]'), "120");
    expect(h.q("receipt-preview")?.textContent).toContain("will be flagged");
  });

  it("every attempt uses a new file name", async () => {
    const b = seededBooking(9104, "chef");
    await open(b, "chef", [], {
      [`POST /api/bookings/${b.id}/receipts`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason: "path_used" },
      ),
    });
    for (let i = 0; i < 2; i++) {
      await pick(FILE());
      await h.type(h.host.querySelector('input[inputmode="decimal"]'), "50");
      await h.click(h.button("Send receipt"));
    }
    expect(upload.mock.calls[0][1]).not.toBe(upload.mock.calls[1][1]);
  });

  it("a failed upload sends nothing to the API and focuses the alert", async () => {
    const b = seededBooking(9104, "chef");
    upload.mockResolvedValue({ error: { message: "bucket policy secret" } });
    await open(b, "chef");
    await pick(FILE());
    await h.type(h.host.querySelector('input[inputmode="decimal"]'), "50");
    await h.click(h.button("Send receipt"));
    expect(
      callsTo(h.fetchMock, "/receipts").filter((c) => c[1] === "POST"),
    ).toHaveLength(0);
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Could not upload the file");
    expect(alert.textContent).not.toContain("policy");
    expect(document.activeElement).toBe(alert);
  });

  it.each([
    ["not_chef_shops", "option B"],
    ["wrong_status", "accepted or completed"],
    ["receipt_waiting", "already waiting"],
    ["receipt_confirmed", "already confirmed"],
    ["path_used", "new name"],
  ])(
    "409 reason %s is shown in words and focus goes to the alert",
    async (reason, words) => {
      const b = seededBooking(9104, "chef");
      await open(b, "chef", [], {
        [`POST /api/bookings/${b.id}/receipts`]: apiError(
          409,
          "INVALID_STATE",
          "server",
          { reason },
        ),
      });
      await pick(FILE());
      await h.type(h.host.querySelector('input[inputmode="decimal"]'), "50");
      await h.click(h.button("Send receipt"));
      const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
      expect(alert.textContent).toContain(words);
      expect(document.activeElement).toBe(alert);
    },
  );

  it("a 422 for the amount is shown on the amount field", async () => {
    const b = seededBooking(9104, "chef");
    await open(b, "chef", [], {
      [`POST /api/bookings/${b.id}/receipts`]: apiError(
        422,
        "VALIDATION_FAILED",
        "Check",
        {
          fields: {
            amountCents: "The amount must be between 1 and 500000 cents.",
          },
        },
      ),
    });
    await pick(FILE());
    await h.type(h.host.querySelector('input[inputmode="decimal"]'), "50");
    await h.click(h.button("Send receipt"));
    const amount = h.host.querySelector(
      'input[inputmode="decimal"]',
    ) as HTMLInputElement;
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(amount);
  });

  it("a waiting receipt hides the form and says it waits for the customer", async () => {
    const b = seededBooking(9106, "chef");
    await open(b, "chef", [flagged(b)]);
    expect(h.q("receipt-form")).toBeNull();
    expect(h.q("receipt-status")?.textContent).toContain(
      "Waiting for the customer to confirm",
    );
  });

  it("after a dispute the chef sees the note and the form again", async () => {
    const b = seededBooking(9106, "chef");
    const disputed: ReceiptView = {
      ...flagged(b),
      status: "disputed",
      customerDisputedAt: new Date().toISOString(),
      disputeNote: "The total looks too high",
    };
    await open(b, "chef", [disputed]);
    expect(h.q("dispute-note")?.textContent).toContain(
      "The total looks too high",
    );
    expect(h.q("receipt-form")).not.toBeNull();
    expect(h.text()).toContain("Upload a new receipt");
  });

  it("earlier (replaced) receipts are listed apart", async () => {
    const b = seededBooking(9106, "chef");
    const old: ReceiptView = {
      ...flagged(b),
      id: "old",
      status: "superseded",
      fileUrl: null,
    };
    const cur: ReceiptView = { ...flagged(b), id: "cur" };
    await open(b, "chef", [old, cur]);
    expect(h.q("earlier-receipts")?.textContent).toContain(
      "replaced by a newer receipt",
    );
    expect(h.qa("receipt")).toHaveLength(1);
  });

  it("no form for the customer, and none while the booking is only requested", async () => {
    await open(seededBooking(9104, "customer"), "customer");
    expect(h.q("receipt-form")).toBeNull();
    h.cleanup();
    h = harness();
    await open(seededBooking(9102, "chef"), "chef");
    expect(h.q("receipt-form")).toBeNull();
    expect(h.q("no-receipt")?.textContent).toContain(
      "once the booking is accepted",
    );
  });
});

describe("the customer answers a receipt", () => {
  it("a flagged receipt shows the difference and the tolerance and needs an answer", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [flagged(b)]);
    const flag = h.q("receipt-flag")?.textContent ?? "";
    expect(flag).toContain("different from the estimate");
    expect(flag).toContain("$22.00 more than the estimate");
    expect(flag).toContain("$6.00");
    expect(flag).toContain("needs your answer");
    expect(h.q("receipt-status")?.textContent).toContain(
      "Waiting for your answer",
    );
    expect(h.button("Confirm this amount")).not.toBeNull();
    expect(h.button("Dispute this receipt")).not.toBeNull();
  });

  it("MOCK shows wherever reimbursement appears and nothing is claimed as collected", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [flagged(b)]);
    const r = h.q("reimbursement")!;
    expect(r.querySelector('[data-testid="mock-badge"]')).not.toBeNull();
    expect(r.textContent).toContain("Not recorded yet");
    expect(r.textContent).toContain("Nothing is collected");
    // The answer form also carries a MOCK badge.
    expect(
      h.q("receipt-answer")?.querySelector('[data-testid="mock-badge"]'),
    ).not.toBeNull();
  });

  it("confirm posts {action:'confirm'} and announces the MOCK reimbursement", async () => {
    const b = seededBooking(9106, "customer");
    const r = flagged(b);
    const confirmed: ReceiptView = {
      ...r,
      status: "confirmed",
      customerConfirmedAt: new Date().toISOString(),
      reimbursement: {
        mock: true,
        collected: false,
        amountCents: r.amountCents,
      },
    };
    await open(b, "customer", [r], {
      [`POST /api/bookings/${b.id}/receipts/${r.id}/respond`]: json(
        200,
        confirmed,
      ),
    });
    // After the answer the list is read again and now holds the confirmed receipt.
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}/shopping-list`]: json(200, listFor(b)),
      [`GET /api/bookings/${b.id}/receipts`]: json(
        200,
        receiptsFor(b, [confirmed]),
      ),
      [`POST /api/bookings/${b.id}/receipts/${r.id}/respond`]: json(
        200,
        confirmed,
      ),
    });
    await h.click(h.button("Confirm this amount"));
    expect(callsTo(h.fetchMock, "/respond")[0][2]).toEqual({
      action: "confirm",
    });
    expect(h.q("receipt-status")?.textContent).toContain(
      "You confirmed this receipt",
    );
    expect(h.q("reimbursement")?.textContent).toContain("Recorded: $62.00");
    expect(h.q("reimbursement")?.textContent).toContain(
      "Nothing was collected",
    );
    expect(h.q("receipt-answer")).toBeNull();
    expect(document.activeElement).toBe(h.q("groceries-notice"));
  });

  it("dispute needs a note of 3 to 300 characters before anything is sent", async () => {
    const b = seededBooking(9106, "customer");
    const r = flagged(b);
    await open(b, "customer", [r], {
      [`POST /api/bookings/${b.id}/receipts/${r.id}/respond`]: json(200, {
        ...r,
        status: "disputed",
      }),
    });
    await h.click(h.button("Dispute this receipt"));
    const area = h.host.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    await h.click(h.button("Send dispute"));
    expect(callsTo(h.fetchMock, "/respond")).toHaveLength(0);
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(area);
    await h.type(area, "ab");
    await h.click(h.button("Send dispute"));
    expect(callsTo(h.fetchMock, "/respond")).toHaveLength(0);
    await h.type(area, "  The total looks too high  ");
    await h.click(h.button("Send dispute"));
    expect(callsTo(h.fetchMock, "/respond")[0][2]).toEqual({
      action: "dispute",
      note: "The total looks too high",
    });
  });

  it("'Go back' leaves the dispute form without sending", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [flagged(b)]);
    await h.click(h.button("Dispute this receipt"));
    await h.click(h.button("Go back"));
    expect(h.host.querySelector("textarea")).toBeNull();
    expect(callsTo(h.fetchMock, "/respond")).toHaveLength(0);
  });

  it.each([
    ["already_answered", "already answered"],
    ["receipt_superseded", "replaced"],
    ["wrong_status", "accepted or completed"],
  ])("409 %s is shown in words", async (reason, words) => {
    const b = seededBooking(9106, "customer");
    const r = flagged(b);
    await open(b, "customer", [r], {
      [`POST /api/bookings/${b.id}/receipts/${r.id}/respond`]: apiError(
        409,
        "INVALID_STATE",
        "x",
        { reason },
      ),
    });
    await h.click(h.button("Confirm this amount"));
    const alert = h.host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain(words);
    expect(document.activeElement).toBe(alert);
  });
});

describe("the receipt file link", () => {
  const withUrl = (b: BookingDetail, url: string | null) => ({
    ...flagged(b),
    fileUrl: url,
  });
  it("opens an https link in a new tab without an opener", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [
      withUrl(b, "https://files.example/receipt.pdf?token=abc"),
    ]);
    const a = h.host.querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toContain("files.example");
    expect(a.rel).toContain("noopener");
    expect(h.text()).toContain("10 minutes");
  });
  it("never renders a javascript: link", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [withUrl(b, "javascript:alert(1)")]);
    expect(h.host.querySelector('a[target="_blank"]')).toBeNull();
    expect(h.q("no-file-link")).not.toBeNull();
  });
  it("without a link in real mode asks the user to reload; the page builds no storage URL", async () => {
    const b = seededBooking(9106, "customer");
    await open(b, "customer", [withUrl(b, null)]);
    expect(h.q("no-file-link")?.textContent).toContain("Reload the page");
    expect(h.host.innerHTML).not.toContain("/storage/v1/");
  });
  it("reads the receipts again before the signed link runs out", async () => {
    const timer = vi.spyOn(globalThis, "setInterval");
    const b = seededBooking(9106, "customer");
    routes(h.fetchMock, {
      [`GET /api/bookings/${b.id}/shopping-list`]: json(200, listFor(b)),
      [`GET /api/bookings/${b.id}/receipts`]: json(
        200,
        receiptsFor(b, [flagged(b)]),
      ),
    });
    await h.mount(<GroceriesSection booking={b} viewer="customer" />);
    const refresh = timer.mock.calls.find((c) => c[1] === 8 * 60 * 1000);
    expect(refresh, "a refresh timer shorter than 10 minutes").toBeTruthy();
    const before = callsTo(h.fetchMock, "/receipts").length;
    await act(async () => {
      (refresh![0] as () => void)();
    });
    await h.flush();
    expect(callsTo(h.fetchMock, "/receipts").length).toBe(before + 1);
    timer.mockRestore();
  });
});
