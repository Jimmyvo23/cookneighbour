"use client";
// Admin review of one chef application (T-036): application fields, files from short-lived signed
// links, MOCK checks, MOCK kitchen review, approve and reject. Built against docs/api-contract.md
// section 6.
//
// MOCK: every check result is an outcome the admin records by hand. Nothing is really verified,
// and nothing here reads a document automatically.
//
// What the admin reviewed is what is sent: every decision uses the paths and address of the
// application as loaded in this view. If the chef changes a file afterwards the server answers 409
// INVALID_STATE, nothing is saved, and the admin is told to reload.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { AdminChefDetail } from "@/lib/api/types";
import {
  describeAdminError,
  filesSignature,
  linksNeedRefresh,
  refreshDelayMs,
  chefStatusText,
} from "@/lib/admin/queue";
import { secondaryButtonCls } from "@/components/chef/parts";
import {
  ApplicationSection,
  ChecksSection,
  DecisionSection,
  DocumentsSection,
  KitchenSection,
} from "@/components/admin/ReviewSections";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: AdminChefDetail; fetchedAt: number };

export function ChefReviewView({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [flash, setFlash] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const signature = useRef<string | null>(null);
  const seq = useRef(0);
  const cancelRequests = useCallback(() => {
    seq.current++;
  }, []);

  /**
   * Fetches the application again. `warnOnChange` tells the admin when a file or the kitchen
   * address differs from what was on screen. Resolves to true on success.
   */
  const reload = useCallback(
    async (opts: { warnOnChange?: boolean } = {}): Promise<boolean> => {
      const mine = ++seq.current;
      try {
        const detail = await apiFetch<AdminChefDetail>(
          `/api/admin/chefs/${encodeURIComponent(id)}`,
        );
        if (mine !== seq.current) return false;
        const sig = filesSignature(detail.application);
        if (
          opts.warnOnChange &&
          signature.current !== null &&
          signature.current !== sig
        )
          setWarning(
            "The chef changed a file or the kitchen address since you opened this page. What you see now is the new version: review it again before you decide.",
          );
        signature.current = sig;
        setView({ kind: "ready", detail, fetchedAt: Date.now() });
        return true;
      } catch (err) {
        if (mine !== seq.current) return false;
        setView((v) =>
          v.kind === "ready"
            ? v // keep what is on screen; the caller says the refresh failed
            : { kind: "error", message: describeAdminError(err, "load") },
        );
        return false;
      }
    },
    [id],
  );

  useEffect(() => {
    // The first load, and again each time the page is shown after being hidden.
    void reload({ warnOnChange: true });
    return cancelRequests;
  }, [reload, cancelRequests]);

  // Signed links last 5 minutes: fetch them again before they run out, and when the admin comes
  // back to this tab after a long wait.
  const fetchedAt = view.kind === "ready" ? view.fetchedAt : null;
  const docs = view.kind === "ready" ? view.detail.documents : null;
  useEffect(() => {
    if (fetchedAt === null || docs === null) return;
    const timer = setTimeout(
      () => void reload({ warnOnChange: true }),
      refreshDelayMs(docs),
    );
    const onFocus = () => {
      if (linksNeedRefresh(fetchedAt, Date.now()))
        void reload({ warnOnChange: true });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchedAt, docs, reload]);

  async function manualReload() {
    setRefreshing(true);
    setFlash(null);
    setWarning(null);
    const ok = await reload({ warnOnChange: true });
    setRefreshing(false);
    setFlash(
      ok
        ? "Reloaded. File links are fresh for 5 minutes."
        : "Could not reload. Try again.",
    );
  }

  /** After a decision: load the new state, then clear the old warning. True when it loaded. */
  const afterChange = useCallback(async (): Promise<boolean> => {
    const ok = await reload();
    if (ok) setWarning(null);
    return ok;
  }, [reload]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8">
      <p>
        <Link
          href="/admin/chefs"
          className="font-medium text-emerald-800 underline dark:text-emerald-300"
        >
          Back to the chef applications
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Review chef application
      </h1>

      {view.kind === "loading" && <p role="status">Loading application...</p>}
      {view.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {view.message}
        </div>
      )}

      {view.kind === "ready" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg">
              <span className="font-semibold">
                {view.detail.application.displayName}
              </span>
              {" · "}
              <span data-testid="chef-status">
                {chefStatusText(view.detail.application.status)}
              </span>
            </p>
            <button
              type="button"
              onClick={manualReload}
              aria-disabled={refreshing}
              className={secondaryButtonCls}
            >
              {refreshing
                ? "Reloading..."
                : "Reload application and file links"}
            </button>
          </div>
          <p role="status" className="text-sm font-medium">
            {flash}
          </p>
          {warning && (
            <p
              role="alert"
              className="rounded-md border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950"
            >
              {warning}
            </p>
          )}
          <ApplicationSection detail={view.detail} />
          <DocumentsSection detail={view.detail} />
          <ChecksSection
            detail={view.detail}
            chefId={id}
            onReload={manualReload}
            onChanged={afterChange}
          />
          <KitchenSection
            detail={view.detail}
            chefId={id}
            onReload={manualReload}
            onChanged={afterChange}
          />
          <DecisionSection
            detail={view.detail}
            chefId={id}
            onReload={manualReload}
            onChanged={afterChange}
          />
        </>
      )}
    </main>
  );
}
