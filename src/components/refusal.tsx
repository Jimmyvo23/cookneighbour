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
export function useBookingRefusals(
  reload: () => void | boolean | Promise<void | boolean>,
) {
  const [last, setLast] = useState<{
    text: string;
    id: number;
    shown: boolean | null; // null = the reload is still running
  } | null>(null);
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
  // Focus moves only when a NEW alert appears (its id changes). The status sentence that arrives
  // later changes the text of the same alert and must not pull focus back (T-083 round 3).
  const alertKey = last?.id ?? 0;
  useEffect(() => {
    if (alertKey) ref.current?.focus();
  }, [alertKey]);
  const nextId = useRef(0);
  const [count, setCount] = useState(0);
  const report = useCallback<ReportRefusal>((text) => {
    if (!mounted.current) return; // the page is gone: nothing to show or reload
    const id = nextId.current + 1;
    nextId.current = id;
    setLast({ text, id, shown: null });
    setCount((c) => c + 1);
    // The sentence about the page is added only once it is true: "shows its current status" after
    // a successful refetch, "Reload the page" when the refetch failed or was replaced (T-083).
    let run: Promise<void | boolean>;
    try {
      run = Promise.resolve(reloadRef.current());
    } catch (e) {
      run = Promise.reject(e);
    }
    void run
      .then(
        (ok) => ok === true,
        () => false,
      )
      .then((shown) => {
        if (!mounted.current) return;
        setLast((p) => (p && p.id === id ? { ...p, shown } : p));
      });
  }, []);
  const clear = useCallback(() => setLast(null), []);
  const scope = useMemo(
    () => ({ report, count, clear }),
    [report, count, clear],
  );
  // Same look as the sections' Alert (components/chef/parts); it is not imported to avoid a cycle.
  // Rendered only while there is a refusal, so a page with no refusal has no empty alert, and each
  // new refusal is a new element that screen readers announce.
  // Trailing spaces are dropped so the punctuation check and the rendered text agree (T-087).
  const shownText = last ? last.text.trimEnd() : "";
  const alert = last ? (
    <div
      key={last.id}
      id={alertId}
      ref={ref}
      tabIndex={-1}
      role="alert"
      // aria-atomic="false" (role alert defaults to true): when the status sentence is added later
      // as a new child, a screen reader reads only that addition, not the whole alert again
      // (T-083 NIT-B, T-052).
      aria-atomic="false"
      data-testid="refusal"
      className="alert-box"
    >
      {shownText}
      {last.shown === null ? null : (
        <span data-testid="refusal-status">
          {`${shownText === "" || /[.!?]$/.test(shownText) ? "" : "."}${shownText === "" ? "" : " "}${
            last.shown
              ? "This page shows its current status."
              : "Reload the page to see its status."
          }`}
        </span>
      )}
    </div>
  ) : null;
  return { scope, alert, clear };
}
