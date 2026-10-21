"use client";
// Paged admin list (T-049). Loads the first page when the path changes (a slow answer for an old
// path is ignored), appends the next page on request, and can reload from the top.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { Page } from "@/lib/api/types";

export type ListView<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: T[]; nextCursor: string | null };

export function useAdminList<T extends { id: string }>(
  path: string,
  describe: (err: unknown) => string,
) {
  // `forPath` is the path the stored answer belongs to; an answer for another path counts as
  // "loading" (derived, so no state is set inside the effect).
  const [stored, setStored] = useState<{ forPath: string; v: ListView<T> }>({
    forPath: "",
    v: { kind: "loading" },
  });
  const view: ListView<T> =
    stored.forPath === path ? stored.v : { kind: "loading" };
  const setView = (v: ListView<T>) => setStored({ forPath: path, v });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const sep = path.includes("?") ? "&" : "?";

  const load = useCallback(
    () => {
      const mine = ++seq.current;
      apiFetch<Page<T>>(path).then(
        (r) => {
          if (mine === seq.current) {
            setMoreError(null);
            setStored({
              forPath: path,
              v: { kind: "ready", items: r.items, nextCursor: r.nextCursor },
            });
          }
        },
        (err) => {
          if (mine !== seq.current) return;
          setStored({
            forPath: path,
            v: { kind: "error", message: describe(err) },
          });
          setTick((t) => t + 1);
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

  useEffect(() => {
    load();
    const counter = seq;
    return () => {
      counter.current++;
    };
  }, [load]);

  async function loadMore() {
    if (view.kind !== "ready" || !view.nextCursor || moreBusy) return;
    const mine = seq.current;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const r = await apiFetch<Page<T>>(
        `${path}${sep}cursor=${encodeURIComponent(view.nextCursor)}`,
      );
      if (mine !== seq.current) return;
      const seen = new Set(view.items.map((i) => i.id));
      setView({
        kind: "ready",
        items: [...view.items, ...r.items.filter((i) => !seen.has(i.id))],
        nextCursor: r.nextCursor,
      });
    } catch (err) {
      if (mine !== seq.current) return;
      setMoreError(describe(err));
      setTick((t) => t + 1);
    } finally {
      setMoreBusy(false);
    }
  }

  return {
    view,
    moreBusy,
    moreError,
    tick,
    loadMore,
    reload: load,
  };
}
