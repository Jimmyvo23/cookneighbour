"use client";
// Admin chef queue (T-036): a filterable list of chef applications, newest first, with "Load more".
// Built against docs/api-contract.md section 6. Every check status shown here is a MOCK outcome an
// admin recorded by hand; nothing is really verified.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type {
  AdminChefListItem,
  AdminChefListResponse,
  ChefApplication,
} from "@/lib/api/types";
import {
  DEFAULT_FILTERS,
  STATUS_FILTERS,
  checkStatusLabel,
  chefStatusText,
  describeAdminError,
  formatWhen,
  listPath,
  mergeItems,
  type ListFilters,
  type StatusFilter,
} from "@/lib/admin/queue";
import { MockBadge } from "@/components/MockBadge";
import { Alert, secondaryButtonCls } from "@/components/chef/parts";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: AdminChefListItem[]; nextCursor: string | null };

export function ChefQueueView() {
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alertId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  // Only the newest request may change the screen (a slow answer for old filters is ignored).
  const seq = useRef(0);

  function cancelRequests() {
    seq.current++;
  }
  function load(f: ListFilters) {
    const mine = ++seq.current;
    apiFetch<AdminChefListResponse>(listPath(f)).then(
      (r) => {
        if (mine !== seq.current) return;
        setView({ kind: "ready", items: r.items, nextCursor: r.nextCursor });
      },
      (err) => {
        if (mine !== seq.current) return;
        setView({ kind: "error", message: describeAdminError(err, "list") });
        setTick((t) => t + 1);
      },
    );
  }

  // Runs on first show and again each time the page is shown after the admin came back from a
  // chef (pages stay mounted while hidden), so a decision is reflected without a manual reload.
  // Items already on screen stay until the fresh first page arrives.
  useEffect(() => {
    load(filters);
    return cancelRequests;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters change through changeFilters
  }, []);

  function changeFilters(next: ListFilters) {
    setFilters(next);
    setMoreError(null);
    setView({ kind: "loading" });
    load(next);
  }

  async function loadMore() {
    if (view.kind !== "ready" || !view.nextCursor || moreBusy) return;
    const mine = seq.current;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const r = await apiFetch<AdminChefListResponse>(
        listPath(filters, view.nextCursor),
      );
      if (mine !== seq.current) return;
      focusFrom.current = view.items.length;
      setView({
        kind: "ready",
        items: mergeItems(view.items, r.items),
        nextCursor: r.nextCursor,
      });
    } catch (err) {
      if (mine !== seq.current) return;
      setMoreError(describeAdminError(err, "list"));
      setTick((t) => t + 1);
    } finally {
      setMoreBusy(false);
    }
  }

  // After an error focus moves to the message; after "Load more" it moves to the first new chef,
  // so keyboard users are not left at the end of the list when the button goes away.
  useEffect(() => {
    if (!tick) return;
    document.getElementById(alertId)?.focus();
  }, [tick, alertId]);
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    focusFrom.current = null;
    listRef.current
      ?.querySelectorAll<HTMLElement>("a[data-chef-link]")
      [from]?.focus();
  }, [view]);

  const error = view.kind === "error" ? view.message : moreError;
  const count = view.kind === "ready" ? view.items.length : 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Chef applications
      </h1>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        <MockBadge>MOCK</MockBadge> Every check result in this prototype is
        recorded by an admin by hand. Nothing is really verified.
      </p>

      <form
        aria-label="Filter applications"
        className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="filter-status"
            value={filters.status}
            onChange={(e) =>
              changeFilters({
                ...filters,
                status: e.target.value as StatusFilter,
              })
            }
            className="min-h-11 rounded-md border border-zinc-400 bg-white px-3 text-base text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label
          htmlFor="filter-checks"
          className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-400 px-3 py-2"
        >
          <input
            id="filter-checks"
            type="checkbox"
            className="size-5 shrink-0"
            checked={filters.checksPending}
            onChange={(e) =>
              changeFilters({ ...filters, checksPending: e.target.checked })
            }
          />
          <span>
            Checks pending (ID, food handler or kitchen is waiting for a result)
          </span>
        </label>
      </form>

      <Alert id={alertId} message={error} />

      {view.kind === "loading" && <p role="status">Loading applications...</p>}

      {view.kind === "ready" && (
        <>
          <p role="status" data-testid="queue-count">
            {count === 0
              ? "No applications match these filters."
              : `Showing ${count} ${count === 1 ? "application" : "applications"}, newest first${view.nextCursor ? " (more available)" : ""}.`}
          </p>
          {count > 0 && (
            <ul
              ref={listRef}
              aria-label="Chef applications"
              className="flex flex-col gap-3"
            >
              {view.items.map((item) => (
                <QueueItem key={item.id} item={item} />
              ))}
            </ul>
          )}
          {view.nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              aria-disabled={moreBusy}
              className={`${secondaryButtonCls} self-start`}
            >
              {moreBusy ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </main>
  );
}

function CheckItem({
  label,
  status,
}: {
  label: string;
  status: ChefApplication["checks"]["id"];
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>{label}:</span>
      <MockBadge>MOCK</MockBadge>
      <span className="font-medium">{checkStatusLabel(status)}</span>
    </li>
  );
}

function QueueItem({ item }: { item: AdminChefListItem }) {
  const homeOffered = item.locationOptions.includes("chef_home");
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-lg font-semibold">
        <Link
          data-chef-link
          href={`/admin/chefs/${item.id}`}
          className="text-emerald-800 underline dark:text-emerald-300"
        >
          {item.displayName}
          <span className="sr-only"> (open application)</span>
        </Link>
      </h2>
      <p className="text-sm">
        <span className="font-medium">
          Status: {chefStatusText(item.status)}
        </span>
        {" · "}Applied {formatWhen(item.createdAt)}
      </p>
      <p className="text-sm">
        Cuisines: {item.cuisines.length ? item.cuisines.join(", ") : "none yet"}
        {" · "}
        {homeOffered
          ? `Cooks at the chef's home too (${item.chefHomeEnabled ? "approved by an admin" : "not approved yet"})`
          : "Cooks at the customer's home"}
      </p>
      <ul
        aria-label={`Check results for ${item.displayName} (MOCK)`}
        className="flex flex-col gap-1 text-sm"
      >
        <CheckItem label="Government ID" status={item.checks.id} />
        <CheckItem
          label="Food Handler Certificate"
          status={item.checks.foodHandler}
        />
        <CheckItem label="Kitchen" status={item.checks.kitchen} />
        <CheckItem label="Police check" status={item.checks.police} />
      </ul>
    </li>
  );
}
