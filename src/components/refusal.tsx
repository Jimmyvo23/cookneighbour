"use client";
// T-080: one shared way to handle "the server refused because the booking is not in that state"
// (any HTTP 409: INVALID_STATE, REQUEST_EXPIRED, DOUBLE_BOOKED, ...; each means the booking changed
// under the page) on a booking page. Every change section (pickup, cancel, answer,
// no-show, receipts, ...) reports such a refusal to the PAGE instead of showing it inside itself:
//   - the page shows the sentence in ONE alert that lives outside the sections, so the message
//     survives when the reload removes the dead button (and its section);
//   - the page moves focus to that alert (one focus owner, lessons-learned section 3);
//   - the page refetches the booking quietly, once per refusal.
// Only 409 is a refusal. 422 field errors, 403/404, and network or timeout errors keep the
// section's own alert. Without a provider (other pages) nothing changes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClientError } from "@/lib/api/client";

export type ReportRefusal = (message: string) => void;

/**
 * `report` sends a refusal to the page; `count` goes up by one per refusal and never goes down;
 * `clear` removes the page alert (a section calls it when its own action succeeds, T-083).
 */
export interface RefusalScope {
  report: ReportRefusal;
  count: number;
  clear: () => void;
}
const RefusalContext = createContext<RefusalScope | null>(null);
export const RefusalProvider = RefusalContext.Provider;
export const useReportRefusal = () =>
  useContext(RefusalContext)?.report ?? null;
/**
 * For a section that keeps its own server data (the receipts list): reload quietly when this
 * changes. It is 0 until the first refusal. A section that mounts after a refusal starts by
 * remembering 0, so it does one extra quiet reload (harmless; today the groceries section is
 * always mounted).
 */
export const useRefusalCount = () => useContext(RefusalContext)?.count ?? 0;

/** For a section whose own action succeeded: drop the page's old refusal alert. */
export const useClearRefusal = () => useContext(RefusalContext)?.clear ?? null;

/** True for a state refusal: the booking changed under the page (HTTP 409). */
export function isStateRefusal(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 409;
}

/**
 * For the page. `reload` refetches the booking quietly; a failed reload must not throw or hide the
 * message. Render `alert` outside the change sections and wrap them in `<RefusalProvider value={scope}>`.
 */
export function useBookingRefusals(reload: () => void | Promise<void>) {
  const [last, setLast] = useState<{ text: string; id: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const alertId = useId();
  const reloadRef = useRef(reload);
  const mounted = useRef(false);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (last) ref.current?.focus();
  }, [last]);
  const [count, setCount] = useState(0);
  const report = useCallback<ReportRefusal>((text) => {
    if (!mounted.current) return; // the page is gone: nothing to show or reload
    setLast((p) => ({ text, id: (p?.id ?? 0) + 1 }));
    setCount((c) => c + 1);
    void Promise.resolve(reloadRef.current()).catch(() => {});
  }, []);
  const clear = useCallback(() => setLast(null), []);
  const scope = useMemo(
    () => ({ report, count, clear }),
    [report, count, clear],
  );
  // Same look as the sections' Alert (components/chef/parts); it is not imported to avoid a cycle.
  // Rendered only while there is a refusal, so a page with no refusal has no empty alert, and each
  // new refusal is a new element that screen readers announce.
  const alert = last ? (
    <div
      key={last.id}
      id={alertId}
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-testid="refusal"
      className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      {last.text}
    </div>
  ) : null;
  return { scope, alert, clear };
}
