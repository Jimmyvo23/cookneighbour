"use client";
// The chef's booking dashboard (T-045): every request and booking for the signed-in chef, from
// GET /api/bookings, grouped by what the chef has to do. A list never carries an address, phone
// number or allergy text (contract section 7A): the customer's answers are on the request page.
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { BookingListResponse, BookingSummary } from "@/lib/api/types";
import { formatWhen } from "@/lib/booking/form";
import { formatDollars } from "@/lib/chef/dishes";
import { shortDayLabel } from "@/lib/search/detail";
import { secondaryButtonCls } from "@/components/chef/parts";
import { CHEF_STATUS_TEXT } from "@/lib/booking/changes";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: BookingSummary[]; next: string | null };

const GROUPS: {
  key: string;
  title: string;
  empty: string;
  match: (b: BookingSummary) => boolean;
}[] = [
  {
    key: "answer",
    title: "Waiting for your answer",
    empty: "No requests are waiting for you.",
    match: (b) => b.status === "requested",
  },
  {
    key: "upcoming",
    title: "Accepted",
    empty: "No accepted bookings.",
    match: (b) => b.status === "accepted",
  },
  {
    key: "past",
    title: "Finished or closed",
    empty: "Nothing finished yet.",
    match: (b) => b.status !== "requested" && b.status !== "accepted",
  },
];

export function ChefBookingList() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const mine = ++seq.current;
    if (!cursor) setState({ kind: "loading" });
    else setMore(true);
    try {
      const r = await apiFetch<BookingListResponse>(
        `/api/bookings?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
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
    document.title = "Bookings — CookNeighbour";
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your bookings</h1>
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
      {state.kind === "ready" && state.items.length === 0 && (
        <div data-testid="empty" className="flex flex-col gap-2">
          <p>No customer has booked you yet.</p>
          <p>
            A request appears here when a customer books you. To be found, your{" "}
            <Link href="/chef/apply" className={linkCls}>
              application
            </Link>{" "}
            must be approved, and you need{" "}
            <Link href="/chef/dishes" className={linkCls}>
              dishes
            </Link>{" "}
            and{" "}
            <Link href="/chef/availability" className={linkCls}>
              available days
            </Link>
            .
          </p>
        </div>
      )}
      {state.kind === "ready" &&
        state.items.length > 0 &&
        GROUPS.map((g) => (
          <Group
            key={g.key}
            id={g.key}
            title={g.title}
            empty={g.empty}
            items={state.items.filter(g.match)}
          />
        ))}
      {state.kind === "ready" && state.next && (
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
    </main>
  );
}

function Group({
  id,
  title,
  empty,
  items,
}: {
  id: string;
  title: string;
  empty: string;
  items: BookingSummary[];
}) {
  const hid = useId();
  return (
    <section aria-labelledby={`${hid}-h`} data-testid={`group-${id}`}>
      <h2 id={`${hid}-h`} className="mb-2 text-lg font-semibold">
        {title} <span className="font-normal">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-300 rounded-lg border border-zinc-300 dark:divide-zinc-700 dark:border-zinc-700">
          {items.map((b) => (
            <li key={b.id} data-testid="booking-item" className="p-4">
              <p className="font-semibold [overflow-wrap:anywhere]">
                <Link
                  href={`/chef/bookings/${encodeURIComponent(b.id)}`}
                  className={linkCls}
                >
                  {b.counterparty.displayName}
                  <span className="sr-only">, booking</span>
                </Link>
              </p>
              {b.status !== "requested" && (
                <p className="text-sm font-medium">
                  {CHEF_STATUS_TEXT[b.status]}
                </p>
              )}
              {b.status === "requested" && b.expiresAt && (
                <p className="text-sm">
                  Answer by {formatWhen(b.expiresAt)} (Toronto time)
                </p>
              )}
              <p className="text-sm">
                {b.dates.map((d) => shortDayLabel(d, true)).join(", ")}
              </p>
              <p className="text-sm">
                {b.locationType === "customer_home"
                  ? "At the customer's home"
                  : "At your home"}
                {" · "}
                {b.groceryOption === "customer_buys"
                  ? "Customer buys the ingredients"
                  : "You shop, the customer reimburses"}
              </p>
              <p className="text-sm">
                Estimated total {formatDollars(b.totalCents)} {b.currency}
                {b.isFreeTrial ? " · Free first booking" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
