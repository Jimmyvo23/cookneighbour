"use client";
// "My bookings" (T-043): the customer's own bookings, newest first, from GET /api/bookings. A list
// never carries an address, phone number or allergy text (contract section 7A).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { BookingListResponse, BookingSummary } from "@/lib/api/types";
import { formatDollars } from "@/lib/chef/dishes";
import { summaryAllDatesPast } from "@/lib/booking/changes";
import { torontoToday } from "@/lib/domain/dishes";
import { shortDayLabel } from "@/lib/search/detail";
import { MAX_OPEN_REQUESTS } from "@/lib/domain/config";
import { hintCls, secondaryButtonCls } from "@/components/chef/parts";
import { STATUS_TEXT } from "@/components/booking/BookingDetailView";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: BookingSummary[]; next: string | null };

export function BookingList() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [more, setMore] = useState(false);
  const today = torontoToday();
  const seq = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const mine = ++seq.current;
    if (!cursor) setState({ kind: "loading" });
    else setMore(true);
    try {
      const r = await apiFetch<BookingListResponse>(
        `/api/bookings?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (mine !== seq.current) return;
      setState((s) => ({
        kind: "ready",
        items: [...(cursor && s.kind === "ready" ? s.items : []), ...r.items],
        next: r.nextCursor,
      }));
    } catch {
      if (mine !== seq.current) return;
      setState({ kind: "error" });
    } finally {
      if (mine === seq.current) setMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [load]);

  useEffect(() => {
    document.title = "My bookings — CookNeighbour";
  }, []);

  // The same query as the form warning (D-40), so the count never depends on how many pages of
  // other statuses were loaded.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    let current = true;
    apiFetch<BookingListResponse>(
      "/api/bookings?status=requested&limit=20",
    ).then(
      (r) => {
        if (current && Array.isArray(r?.items)) setWaiting(r.items.length);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [state.kind]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
      {state.kind === "loading" && (
        <p role="status" data-testid="loading">
          Loading your bookings...
        </p>
      )}
      {state.kind === "error" && (
        <div
          role="alert"
          data-testid="load-error"
          className="flex flex-col gap-3"
        >
          <p>Your bookings did not load. Something went wrong.</p>
          <p>
            <button
              type="button"
              onClick={() => void load(null)}
              className={secondaryButtonCls}
            >
              Try again
            </button>
          </p>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <p className={hintCls} data-testid="open-count">
            You can have up to {MAX_OPEN_REQUESTS} requests waiting for an
            answer at once. Waiting now: {waiting}.
          </p>
          {state.items.length === 0 ? (
            <p data-testid="empty">
              You have no bookings yet.{" "}
              <Link href="/search" className={linkCls}>
                Search for a home cook
              </Link>
            </p>
          ) : (
            <ul aria-label="Your bookings" className="flex flex-col gap-3">
              {state.items.map((b) => (
                <li
                  key={b.id}
                  data-testid="booking-item"
                  className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
                >
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    <Link
                      href={`/bookings/${encodeURIComponent(b.id)}`}
                      className={linkCls}
                    >
                      {b.counterparty.displayName}
                      <span className="sr-only">, booking</span>
                    </Link>
                  </p>
                  <p className="text-sm">{STATUS_TEXT[b.status]}</p>
                  {summaryAllDatesPast(b.status, b.dates, today) && (
                    <p className="text-sm">
                      All visit days have passed. Open the booking to see what
                      is next.
                    </p>
                  )}
                  <p className="text-sm">
                    {b.dates.map((d) => shortDayLabel(d, true)).join(", ")}
                  </p>
                  <p className="text-sm">
                    Estimated total {formatDollars(b.totalCents)} {b.currency}
                    {b.isFreeTrial ? " · Free first booking" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {state.next && (
            <p>
              <button
                type="button"
                disabled={more}
                onClick={() => void load(state.next)}
                className={secondaryButtonCls}
              >
                {more ? "Loading..." : "Load more"}
              </button>
            </p>
          )}
        </>
      )}
    </main>
  );
}
