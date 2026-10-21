"use client";
// The review list on the public chef page (T-049, contract 7D, GET /api/chefs/:id/reviews).
// Each review shows the reviewer's name exactly as the server sends it (Jimmy chose "first name +
// rating", 2026-10-20: the server sends the first name only), the rating and the date. The UI
// never builds a name itself. A chef's review of a customer never comes through this route.
//
// Decided by Jimmy (D-114): the public sees the first name only. The contract sends the written
// comment too, so it is shown while SHOW_PUBLIC_COMMENT is true.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { Page } from "@/lib/api/types";
import { Alert, hintCls, secondaryButtonCls } from "@/components/chef/parts";
import { Stars } from "@/components/reviews/Stars";
import { formatDate } from "@/lib/engagement/rules";
import type { PublicReview } from "@/lib/api/types";

export const SHOW_PUBLIC_COMMENT = true;
const PAGE = 10;

type View =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: PublicReview[]; next: string | null };

const path = (id: string, cursor?: string | null) =>
  `/api/chefs/${encodeURIComponent(id)}/reviews?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

export function PublicReviews({ chefId }: { chefId: string }) {
  const hid = useId();
  const alertId = `${hid}-err`;
  const [view, setView] = useState<View>({ kind: "loading" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  const seq = useRef(0);
  // Answers that arrive after the page left (or a newer load) are ignored.
  const cancelRequests = useCallback(() => {
    seq.current++;
  }, []);

  async function load() {
    const mine = ++seq.current;
    setView({ kind: "loading" });
    try {
      const r = await apiFetch<Page<PublicReview>>(path(chefId));
      if (!Array.isArray(r?.items)) throw new Error("bad shape");
      if (mine === seq.current)
        setView({ kind: "ready", items: r.items, next: r.nextCursor });
    } catch {
      if (mine === seq.current) setView({ kind: "error" });
    }
  }
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
    return cancelRequests;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chefId]);

  async function more() {
    if (view.kind !== "ready" || !view.next || moreBusy) return;
    const mine = seq.current;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const r = await apiFetch<Page<PublicReview>>(path(chefId, view.next));
      if (!Array.isArray(r?.items)) throw new Error("bad shape");
      if (mine !== seq.current) return;
      const seen = new Set(view.items.map((i) => i.id));
      focusFrom.current = view.items.length;
      setView({
        kind: "ready",
        items: [...view.items, ...r.items.filter((i) => !seen.has(i.id))],
        next: r.nextCursor,
      });
    } catch {
      if (mine !== seq.current) return;
      setMoreError(
        "More reviews did not load. Check your connection and try again.",
      );
      setTick((t) => t + 1);
    } finally {
      setMoreBusy(false);
    }
  }

  // After "Load more" focus goes to the first new review, so a keyboard user is not left behind.
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    focusFrom.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("li")[from]?.focus();
  }, [view]);
  useEffect(() => {
    if (tick) document.getElementById(alertId)?.focus();
  }, [tick, alertId]);

  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="public-reviews"
      className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Reviews
      </h2>
      {view.kind === "loading" && <p role="status">Loading reviews...</p>}
      {view.kind === "error" && (
        <div className="flex flex-col gap-3" data-testid="reviews-error">
          <p role="status">The reviews did not load.</p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className={secondaryButtonCls}
            >
              Try loading the reviews again
            </button>
          </p>
        </div>
      )}
      {view.kind === "ready" && (
        <>
          {view.items.length === 0 ? (
            <p data-testid="reviews-empty">No reviews yet.</p>
          ) : (
            <>
              <p className={hintCls}>
                Reviews are from customers whose booking was completed. They
                show the customer&apos;s first name, the rating and the date.
              </p>
              <ul
                ref={listRef}
                aria-label="Customer reviews"
                className="flex flex-col gap-3"
              >
                {view.items.map((r) => (
                  <li
                    key={r.id}
                    tabIndex={-1}
                    data-testid="public-review"
                    className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3 [overflow-wrap:anywhere] dark:border-zinc-700"
                  >
                    <p className="font-semibold">{r.authorFirstName}</p>
                    <p>
                      <Stars value={r.rating} />
                    </p>
                    <p className={hintCls}>
                      <time dateTime={r.createdAt}>
                        {formatDate(r.createdAt)}
                      </time>
                    </p>
                    {SHOW_PUBLIC_COMMENT && r.comment && (
                      <p className="whitespace-pre-line">{r.comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Alert id={alertId} message={moreError} />
          {view.next && (
            <button
              type="button"
              onClick={() => void more()}
              aria-disabled={moreBusy}
              className={`${secondaryButtonCls} self-start`}
            >
              {moreBusy ? "Loading..." : "Show more reviews"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
