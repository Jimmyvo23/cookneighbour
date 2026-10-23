"use client";
// Groceries on a booking (T-045, contract section 7B), shown to both parties.
//   Option A (customer buys): the shopping list, per dish (D-46), and who delivers what where.
//   Option B (chef shops): the same list as an estimate, then the chef's receipt: the chef uploads
//   the file with their own session and registers it with the amount; the customer confirms or
//   disputes it. A receipt that differs from the estimate by more than the tolerance is flagged
//   and needs an explicit answer. Reimbursement is at cost and MOCK: nothing is collected.
//
// Privacy: the shopping list and receipts carry no address or phone number. The receipt file link
// is signed, valid 10 minutes, and made for the signed-in party only, so it is refetched before
// it expires. In MOCK mode no storage URL is ever built (the API gives `fileUrl: null`).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch, isMockEnabled } from "@/lib/api/client";
import { useClearRefusal, useRefusalCount } from "@/components/refusal";
import type {
  BookingDetail,
  ReceiptList,
  ReceiptView,
  ShoppingListResponse,
} from "@/lib/api/types";
import {
  FILE_URL_REFRESH_MS,
  RECEIPT_ALLOWED_TEXT,
  RECEIPT_BUCKET,
  currentReceipt,
  differenceText,
  newReceiptPath,
  receiptErrorText,
  safeFileUrl,
  validateReceiptFile,
} from "@/lib/booking/changes";
import { dollarsToCents } from "@/lib/chef/form";
import { formatDollars } from "@/lib/chef/dishes";
import { checkReceipt } from "@/lib/domain/receipt";
import { allergenText, shortDayLabel } from "@/lib/search/detail";
import { formatWhen } from "@/lib/booking/form";
import { useAnnounce } from "@/components/booking/useAnnounce";
import { MockBadge } from "@/components/MockBadge";
import {
  Alert,
  Notice,
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";
import {
  FieldScopeProvider,
  Input,
  TextArea,
  errCls,
  inputCls,
  infoBoxCls,
  warnBoxCls,
  useDomId,
} from "@/components/booking/parts";
import { browserUploader, mockUploader } from "@/lib/chef/upload";

type Viewer = "customer" | "chef";

/** Statuses where groceries still matter. A declined, cancelled or expired booking has none. */
function showsGroceries(status: BookingDetail["status"]): boolean {
  return !["declined", "cancelled", "expired"].includes(status);
}

function isShoppingList(v: unknown): v is ShoppingListResponse {
  const o = v as Partial<ShoppingListResponse> | null;
  return (
    !!o &&
    typeof o === "object" &&
    Array.isArray(o.days) &&
    typeof o.plan === "object" &&
    o.plan !== null &&
    typeof o.estimatedCostCents === "number"
  );
}
function isReceiptList(v: unknown): v is ReceiptList | null {
  const o = v as Partial<ReceiptList> | null;
  return (
    !!o &&
    typeof o === "object" &&
    Array.isArray(o.items) &&
    typeof o.estimatedIngredientsCents === "number"
  );
}

const dishWord = (n: number) => (n === 1 ? "dish" : "dishes");

export function GroceriesSection({
  booking: b,
  viewer,
}: {
  booking: BookingDetail;
  viewer: Viewer;
}) {
  const hid = useId();
  const optionB = b.groceryOption === "chef_shops";
  const [list, setList] = useState<ShoppingListResponse | null>(null);
  const [receipts, setReceipts] = useState<ReceiptList | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const { announce, notice } = useAnnounce();
  const seq = useRef(0);
  const enabled = showsGroceries(b.status);

  // `quiet` refetches in the background (a fresh signed link) without hiding what is on screen.
  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) {
        setLoading(true);
        setFailed(false);
      }
      try {
        const id = encodeURIComponent(b.id);
        const [l, r] = await Promise.all([
          apiFetch<ShoppingListResponse>(`/api/bookings/${id}/shopping-list`),
          optionB
            ? apiFetch<ReceiptList>(`/api/bookings/${id}/receipts`)
            : Promise.resolve(null),
        ]);
        if (mine !== seq.current) return;
        // A reply of the wrong shape is a failure, never a half-drawn page.
        if (!isShoppingList(l) || (optionB && !isReceiptList(r)))
          throw new Error("unexpected reply");
        setList(l);
        setReceipts(r);
        setFailed(false);
      } catch {
        if (mine !== seq.current) return;
        if (!quiet) setFailed(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [b.id, b.status, optionB], // eslint-disable-line react-hooks/exhaustive-deps -- a status change reloads
  );

  useEffect(() => {
    if (enabled) void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [enabled, load]);

  // T-080: a 409 on a receipt answer or upload may leave the booking status as it was while the
  // list changed (the other side already answered). The page reports each refusal; reload quietly.
  // The page's alert keeps focus: this reload draws no alert and moves no focus.
  const refusals = useRefusalCount();
  const clearRefusal = useClearRefusal();
  const seenRefusals = useRef(0);
  useEffect(() => {
    if (refusals === seenRefusals.current) return;
    seenRefusals.current = refusals;
    if (enabled) void load(true); // eslint-disable-line react-hooks/set-state-in-effect -- reloads from the API after a refusal
  }, [refusals, enabled, load]);

  // The signed receipt link lasts 10 minutes: fetch a new one before it runs out.
  useEffect(() => {
    if (!enabled || !optionB) return;
    const t = setInterval(() => void load(true), FILE_URL_REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, optionB, load]);

  if (!enabled) return null;

  const current = receipts ? currentReceipt(receipts.items) : null;
  const earlier = receipts?.items.filter((r) => r.id !== current?.id) ?? [];
  const open = b.status === "accepted" || b.status === "completed";
  const canUpload =
    viewer === "chef" &&
    optionB &&
    open &&
    !b.frozen &&
    receipts !== null &&
    (!current || current.status === "disputed");
  const done = (message: string) => {
    clearRefusal?.(); // T-083: a success replaces an old page refusal
    announce(message);
    void load(true);
  };

  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="groceries"
      className={cardCls}
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Groceries
      </h2>
      {notice("groceries-notice", "font-medium text-success")}
      {loading && !list && <p role="status">Loading the groceries...</p>}
      {failed && (
        <div
          role="alert"
          data-testid="groceries-error"
          className="flex flex-col gap-3"
        >
          <p>The groceries did not load.</p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className={secondaryButtonCls}
            >
              Try again
            </button>
          </p>
        </div>
      )}
      {list && (
        <>
          <Plan list={list} viewer={viewer} />
          <ShoppingList list={list} />
        </>
      )}
      {list && optionB && receipts && (
        <div
          className="flex flex-col gap-4 border-t border-line pt-4 "
          data-testid="receipts"
        >
          <h3 className="text-base font-semibold">Receipt</h3>
          {current ? (
            <ReceiptCard
              r={current}
              viewer={viewer}
              open={open}
              onDone={done}
              bookingId={b.id}
            />
          ) : (
            <p data-testid="no-receipt">
              {viewer === "chef"
                ? b.frozen
                  ? "A receipt cannot be added while this booking is on hold."
                  : open
                    ? "You have not added a receipt yet. After you shop, upload the receipt and enter what you paid."
                    : "A receipt can be added once the booking is accepted."
                : "The chef has not added a receipt yet. You will see it here, and you reimburse the groceries at cost once you confirm it."}
            </p>
          )}
          {current &&
            viewer === "chef" &&
            b.frozen &&
            optionB &&
            open &&
            current.status === "disputed" && (
              <p data-testid="no-receipt-frozen">
                A receipt cannot be added while this booking is on hold.
              </p>
            )}
          {canUpload && (
            <ReceiptUploadForm
              bookingId={b.id}
              estimatedCents={receipts.estimatedIngredientsCents}
              replacing={current !== null}
              onDone={done}
            />
          )}
          {earlier.length > 0 && (
            <details data-testid="earlier-receipts">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                Earlier receipts ({earlier.length})
              </summary>
              <ul className="flex flex-col gap-1 pt-1 text-sm">
                {earlier.map((r) => (
                  <li key={r.id}>
                    {formatDollars(r.amountCents)}, added{" "}
                    {formatWhen(r.createdAt)}:{" "}
                    {r.status === "superseded"
                      ? "replaced by a newer receipt"
                      : STATUS_WORDS[r.status]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan and shopping list
// ---------------------------------------------------------------------------

/** What happens with the groceries, in words for this viewer. */
function Plan({
  list,
  viewer,
}: {
  list: ShoppingListResponse;
  viewer: Viewer;
}) {
  const p = list.plan;
  // The API's `note` is written to the customer ("You buy ..."). The chef gets the same facts in
  // their own words, built from the plan fields (see the T-045 handoff, backend gap 1).
  const chefNote = p.receiptRequired
    ? "You buy the groceries and upload the receipt. The customer reimburses what you paid, at cost, with no markup. MOCK: no money moves in this prototype."
    : p.customerDeliversToChef
      ? "The customer buys the ingredients and delivers or sends them to your home before the cooking day."
      : "The customer buys the ingredients and has them at their home before you arrive.";
  return (
    <div className="flex flex-col gap-2" data-testid="grocery-plan">
      <p>
        <span className="font-medium">
          {p.buyer === "customer"
            ? viewer === "customer"
              ? "Option A: you buy the ingredients."
              : "Option A: the customer buys the ingredients."
            : viewer === "customer"
              ? "Option B: the chef shops and you reimburse the receipt."
              : "Option B: you shop and the customer reimburses the receipt."}
        </span>
      </p>
      <p data-testid="plan-note" className={infoBoxCls}>
        {viewer === "customer" ? p.note : chefNote}
      </p>
    </div>
  );
}

function ShoppingList({ list }: { list: ShoppingListResponse }) {
  const hid = useId();
  const who = list.plan.buyer === "customer" ? "to buy" : "to be bought";
  return (
    <div className="flex flex-col gap-3" data-testid="shopping-list">
      <h3 id={`${hid}-h`} className="text-base font-semibold">
        Shopping list {who}
      </h3>
      <p className={hintCls}>
        This list is per dish, with the estimated grocery cost of each dish. The
        chef&apos;s own recipe decides the exact ingredients.
      </p>
      <ul
        aria-labelledby={`${hid}-h`}
        className="flex flex-col divide-y divide-line "
      >
        {list.days.map((d) => (
          <li
            key={d.dayNumber}
            data-testid="shopping-day"
            className="py-3 first:pt-0"
          >
            <p className="font-semibold">
              Day {d.dayNumber}:{" "}
              <time dateTime={d.date}>{shortDayLabel(d.date, true)}</time>
              <span className="font-normal">
                {" "}
                ({d.dishes.length} {dishWord(d.dishes.length)}, about{" "}
                {formatDollars(d.estimatedCostCents)})
              </span>
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {d.dishes.map((x, i) => (
                <li key={`${x.name}-${i}`} data-testid="shopping-dish">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {x.name}
                    {x.quantity > 1 ? ` x ${x.quantity}` : ""}
                  </span>
                  , serves {x.servings}, about{" "}
                  <span className="tabular-nums">
                    {formatDollars(x.lineCostCents)}
                  </span>
                  <br />
                  {allergenText(x.allergens)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="font-semibold" data-testid="shopping-total">
        Estimated groceries:{" "}
        <span className="tabular-nums">
          {formatDollars(list.estimatedCostCents)} {list.currency}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One receipt
// ---------------------------------------------------------------------------
const STATUS_WORDS: Record<ReceiptView["status"], string> = {
  waiting: "waiting for the customer to answer",
  confirmed: "confirmed by the customer",
  disputed: "disputed by the customer",
  superseded: "replaced by a newer receipt",
};

function ReceiptCard({
  r,
  viewer,
  open,
  onDone,
  bookingId,
}: {
  r: ReceiptView;
  viewer: Viewer;
  open: boolean;
  onDone: (message: string) => void;
  bookingId: string;
}) {
  const url = safeFileUrl(r.fileUrl);
  return (
    <div className="flex flex-col gap-3" data-testid="receipt">
      <p className="text-lg font-semibold" data-testid="receipt-amount">
        <span className="tabular-nums">{formatDollars(r.amountCents)}</span>{" "}
        {r.currency}{" "}
        <span className="text-base font-normal">
          (estimated groceries{" "}
          <span className="tabular-nums">
            {formatDollars(r.estimatedIngredientsCents)}
          </span>
          )
        </span>
      </p>
      <p data-testid="receipt-status">
        <span className="sr-only">Receipt status: </span>
        {viewer === "chef" ? chefStatus(r) : customerStatus(r)}
      </p>
      {r.mismatchFlagged && (
        <div data-testid="receipt-flag" className={warnBoxCls}>
          <p className="font-semibold">
            This receipt is different from the estimate.
          </p>
          <p>
            {differenceText(r)} A difference of more than{" "}
            <span className="tabular-nums">
              {formatDollars(r.toleranceCents)}
            </span>{" "}
            is flagged.
            {r.status === "waiting" && viewer === "customer"
              ? " Please check it, then confirm it or dispute it. This one needs your answer."
              : ""}
          </p>
        </div>
      )}
      {r.status === "disputed" && r.disputeNote && (
        <p data-testid="dispute-note">
          <span className="font-medium">
            {viewer === "chef" ? "The customer says: " : "You said: "}
          </span>
          <span className="[overflow-wrap:anywhere]">{r.disputeNote}</span>
        </p>
      )}
      <div data-testid="reimbursement" className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          Reimbursement at cost <MockBadge>MOCK</MockBadge>
        </p>
        <p className="text-sm">
          {r.reimbursement.amountCents !== null
            ? `Recorded: ${formatDollars(r.reimbursement.amountCents)}. Nothing was collected: no money moves in this prototype.`
            : "Not recorded yet. It is recorded when the customer confirms the receipt. Nothing is collected: no money moves in this prototype."}
        </p>
      </div>
      <FileLink url={url} />
      {viewer === "customer" && open && r.status === "waiting" && (
        <ReceiptAnswerForm r={r} bookingId={bookingId} onDone={onDone} />
      )}
    </div>
  );
}

function chefStatus(r: ReceiptView): string {
  if (r.status === "waiting") return "Waiting for the customer to confirm.";
  if (r.status === "confirmed")
    return `The customer confirmed this receipt${r.customerConfirmedAt ? ` on ${formatWhen(r.customerConfirmedAt)}` : ""}.`;
  if (r.status === "disputed")
    return "The customer disputed this receipt. Upload a new receipt below.";
  return STATUS_WORDS[r.status];
}
function customerStatus(r: ReceiptView): string {
  if (r.status === "waiting") return "Waiting for your answer.";
  if (r.status === "confirmed")
    return `You confirmed this receipt${r.customerConfirmedAt ? ` on ${formatWhen(r.customerConfirmedAt)}` : ""}.`;
  if (r.status === "disputed")
    return "You disputed this receipt. The chef can upload a new one.";
  return STATUS_WORDS[r.status];
}

function FileLink({ url }: { url: string | null }) {
  if (url)
    return (
      <p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline"
        >
          View the receipt file (opens in a new tab)
        </a>
        <span className={`${hintCls} block`}>
          The link works for 10 minutes and is made new while this page stays
          open.
        </span>
      </p>
    );
  return (
    <p className={hintCls} data-testid="no-file-link">
      {isMockEnabled()
        ? "MOCK: no file is stored, so there is no file to open."
        : "The file link could not be made. Reload the page to try again."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Chef: upload a receipt
// ---------------------------------------------------------------------------
function ReceiptUploadForm({
  bookingId,
  estimatedCents,
  replacing,
  onDone,
}: {
  bookingId: string;
  estimatedCents: number;
  replacing: boolean;
  onDone: (message: string) => void;
}) {
  const scope = useId();
  return (
    <FieldScopeProvider value={`rc${scope}-`}>
      <UploadFields
        bookingId={bookingId}
        estimatedCents={estimatedCents}
        replacing={replacing}
        onDone={onDone}
      />
    </FieldScopeProvider>
  );
}

function UploadFields({
  bookingId,
  estimatedCents,
  replacing,
  onDone,
}: {
  bookingId: string;
  estimatedCents: number;
  replacing: boolean;
  onDone: (message: string) => void;
}) {
  const sec = useSection();
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const fileId = useDomId("receipt-file");
  const fe = sec.fieldErrors;
  const cents = dollarsToCents(amount);
  const preview =
    cents !== null && cents >= 1 && cents <= 500000
      ? checkReceipt(estimatedCents, cents)
      : null;
  const tolerance = checkReceipt(estimatedCents, 1).toleranceCents;

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (sec.busy) return;
    const errors: Record<string, string> = {};
    const fileProblem = validateReceiptFile(file);
    if (fileProblem) errors.file = fileProblem;
    if (cents === null || cents < 1 || cents > 500000)
      errors.amount =
        "Enter the amount you paid in dollars, for example 42.50.";
    if (Object.keys(errors).length) {
      sec.fail("Check the highlighted fields.", errors);
      return;
    }
    const chosen = file!;
    void sec.run(
      async () => {
        // A new name for every attempt: the storage rules allow no overwrite.
        const path = newReceiptPath(bookingId, chosen.type);
        const uploader = isMockEnabled()
          ? mockUploader
          : await browserUploader();
        let upError: { message: string } | null;
        let network = false;
        try {
          ({ error: upError } = await uploader.upload(
            RECEIPT_BUCKET,
            path,
            chosen,
            { upsert: false, contentType: chosen.type },
          ));
        } catch {
          upError = { message: "network" };
          network = true;
        }
        if (upError)
          throw new UploadFailed(
            network
              ? "Could not upload the file. Check your connection and try again."
              : "Could not upload the file. Try again, or choose a different file.",
          );
        await apiFetch<ReceiptView>(
          `/api/bookings/${encodeURIComponent(bookingId)}/receipts`,
          {
            method: "POST",
            body: { filePath: path, amountCents: cents },
          },
        );
        onDone("Receipt sent. The customer will be asked to confirm it.");
      },
      "",
      {
        describe: (err) =>
          err instanceof UploadFailed ? err.message : receiptErrorText(err),
        fields: (f) => ({
          ...(f.filePath ? { file: f.filePath } : {}),
          ...(f.amountCents ? { amount: f.amountCents } : {}),
        }),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid="receipt-form"
      className="flex flex-col gap-3"
    >
      <h4 className="text-base font-semibold">
        {replacing ? "Upload a new receipt" : "Add your receipt"}
      </h4>
      <Alert id={sec.alertId} message={sec.error} />
      <div className="flex flex-col gap-1">
        <label htmlFor={fileId} className="text-sm font-medium">
          Receipt file ({RECEIPT_ALLOWED_TEXT})
        </label>
        <input
          id={fileId}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
          aria-invalid={fe.file ? true : undefined}
          aria-describedby={fe.file ? `${fileId}-error` : undefined}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={`${inputCls} py-2`}
        />
        {fe.file && (
          <p id={`${fileId}-error`} className={errCls}>
            {fe.file}
          </p>
        )}
      </div>
      <Input
        label="Amount you paid (CAD)"
        errorKey="receipt-amount"
        error={fe.amount}
        hint={`Groceries at cost, no markup. The estimate is ${formatDollars(estimatedCents)}. A receipt more than ${formatDollars(tolerance)} above or below that is flagged for the customer to check.`}
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {preview && (
        <p className={hintCls} data-testid="receipt-preview">
          {preview.mismatch
            ? `This will be flagged: it is ${formatDollars(Math.abs(preview.differenceCents))} ${preview.differenceCents > 0 ? "above" : "below"} the estimate.`
            : "This is close to the estimate, so it will not be flagged."}
        </p>
      )}
      <p>
        <button type="submit" disabled={sec.busy} className={buttonCls}>
          {sec.busy ? "Sending..." : "Send receipt"}
        </button>
      </p>
      <Notice message={sec.notice} />
    </form>
  );
}

class UploadFailed extends Error {}

// ---------------------------------------------------------------------------
// Customer: confirm or dispute
// ---------------------------------------------------------------------------
function ReceiptAnswerForm({
  r,
  bookingId,
  onDone,
}: {
  r: ReceiptView;
  bookingId: string;
  onDone: (message: string) => void;
}) {
  const scope = useId();
  const sec = useSection();
  const [disputing, setDisputing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const goingBack = useRef(false);
  useEffect(() => {
    // "Go back" removes the focused button: return focus to the button that opened the form.
    if (!disputing && goingBack.current) {
      goingBack.current = false;
      opener.current?.focus();
    }
  }, [disputing]);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLDivElement>(null);
  const path = `/api/bookings/${encodeURIComponent(bookingId)}/receipts/${encodeURIComponent(r.id)}/respond`;

  useEffect(() => {
    if (disputing) noteRef.current?.querySelector("textarea")?.focus();
  }, [disputing]);

  function answer(action: "confirm" | "dispute") {
    if (sec.busy) return;
    if (
      action === "dispute" &&
      (note.trim().length < 3 || note.trim().length > 300)
    ) {
      sec.fail("Check the highlighted fields.", {
        note: "Say what is wrong, in 3 to 300 characters.",
      });
      return;
    }
    void sec.run(
      async () => {
        await apiFetch<ReceiptView>(path, {
          method: "POST",
          body:
            action === "confirm" ? { action } : { action, note: note.trim() },
        });
        onDone(
          action === "confirm"
            ? "You confirmed the receipt. The reimbursement is recorded (MOCK): nothing was collected."
            : "You disputed the receipt. The chef can upload a new one.",
        );
      },
      "",
      {
        describe: (err) =>
          err instanceof ApiClientError && err.status === 422 && err.fields.note
            ? err.fields.note
            : receiptErrorText(err),
        fields: (f): Record<string, string> => (f.note ? { note: f.note } : {}),
      },
    );
  }

  return (
    <FieldScopeProvider value={`ra${scope}-`}>
      <div
        ref={noteRef}
        className="flex flex-col gap-3"
        data-testid="receipt-answer"
      >
        <Alert id={sec.alertId} message={sec.error} />
        {disputing && (
          <TextArea
            label="What is wrong with this receipt?"
            errorKey="dispute-note"
            error={sec.fieldErrors.note}
            hint="3 to 300 characters. The chef will read this."
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <div className="flex flex-wrap gap-3">
          {!disputing ? (
            <>
              <button
                type="button"
                disabled={sec.busy}
                onClick={() => answer("confirm")}
                className={buttonCls}
              >
                {sec.busy ? "Sending..." : "Confirm this amount"}
              </button>
              <button
                type="button"
                disabled={sec.busy}
                ref={opener}
                onClick={() => setDisputing(true)}
                className={secondaryButtonCls}
              >
                Dispute this receipt
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={sec.busy}
                onClick={() => answer("dispute")}
                className={buttonCls}
              >
                {sec.busy ? "Sending..." : "Send dispute"}
              </button>
              <button
                type="button"
                disabled={sec.busy}
                onClick={() => {
                  goingBack.current = true;
                  setDisputing(false);
                  setNote("");
                }}
                className={secondaryButtonCls}
              >
                Go back
              </button>
            </>
          )}
        </div>
        <p className={hintCls}>
          Confirming records that you owe {formatDollars(r.amountCents)} for the
          groceries, at cost. <MockBadge>MOCK</MockBadge> Nothing is collected.
        </p>
      </div>
    </FieldScopeProvider>
  );
}
