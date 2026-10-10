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

const RETRY_MS = 30_000;

type ReloadResult = "ok" | "failed" | "superseded";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: AdminChefDetail; fetchedAt: number };

export function ChefReviewView({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [flash, setFlash] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // True when the automatic refresh of the file links failed: they may have expired.
  const [linksStale, setLinksStale] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const signature = useRef<string | null>(null);
  const seq = useRef(0);
  const refreshingRef = useRef(false);
  const cancelRequests = useCallback(() => {
    seq.current++;
  }, []);

  /**
   * Fetches the application again. `warnOnChange` tells the admin when a file or the kitchen
   * address differs from what was on screen. Resolves to "ok", "failed", or "superseded" (a newer
   * reload started, or the page closed, so this answer was dropped and says nothing about the
   * network: callers must not show an error for it).
   */
  const reload = useCallback(
    async (opts: { warnOnChange?: boolean } = {}): Promise<ReloadResult> => {
      const mine = ++seq.current;
      try {
        const detail = await apiFetch<AdminChefDetail>(
          `/api/admin/chefs/${encodeURIComponent(id)}`,
        );
        if (mine !== seq.current) return "superseded";
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
        setLinksStale(false);
        return "ok";
      } catch (err) {
        if (mine !== seq.current) return "superseded";
        setView((v) =>
          v.kind === "ready"
            ? v // keep what is on screen; the caller says the refresh failed
            : { kind: "error", message: describeAdminError(err, "load") },
        );
        return "failed";
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
    // After a failed automatic refresh, try again in 30 seconds (retryTick re-arms this effect).
    const delay = retryTick > 0 && linksStale ? RETRY_MS : refreshDelayMs(docs);
    const auto = () =>
      void reload({ warnOnChange: true }).then((result) => {
        if (result === "failed") {
          setLinksStale(true);
          setRetryTick((t) => t + 1);
        }
      });
    const timer = setTimeout(auto, delay);
    const onFocus = () => {
      if (linksNeedRefresh(fetchedAt, Date.now())) auto();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchedAt, docs, reload, retryTick, linksStale]);

  async function manualReload() {
    // The button only says aria-disabled, so a second click still arrives: ignore it.
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setFlash(null);
    setWarning(null);
    const result = await reload({ warnOnChange: true });
    refreshingRef.current = false;
    setRefreshing(false);
    // A superseded answer was dropped for a newer reload: say nothing about it.
    if (result === "ok")
      setFlash("Reloaded. File links are fresh for 5 minutes.");
    else if (result === "failed") setFlash("Could not reload. Try again.");
  }

  /** After a decision: load the new state, then clear the old warning. True when it loaded. */
  const afterChange = useCallback(async (): Promise<boolean> => {
    const result = await reload();
    if (result === "ok") setWarning(null);
    // Superseded: a newer reload is already loading the state, so this is not a failure.
    return result !== "failed";
  }, [reload]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 [overflow-wrap:anywhere]">
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
            <p className="min-w-0 text-lg">
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
          {linksStale && (
            <p
              data-testid="links-stale"
              className="rounded-md border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950"
            >
              The file links could not be renewed and may have expired. This
              page will try again in a moment; you can also use &quot;Reload
              application and file links&quot;.
            </p>
          )}
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
            key={`checks:${view.detail.application.documents.idDocumentPath}|${view.detail.application.documents.foodHandlerPath}`}
            detail={view.detail}
            chefId={id}
            onReload={manualReload}
            onChanged={afterChange}
          />
          <KitchenSection
            key={`kitchen:${filesSignature(view.detail.application)}`}
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
