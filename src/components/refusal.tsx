"use client";
// T-080: one shared way to handle "the server refused because the booking is not in that state"
// (HTTP 409 INVALID_STATE) on a booking page. Every change section (pickup, cancel, answer,
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
  useRef,
  useState,
} from "react";
import { ApiClientError } from "@/lib/api/client";

export type ReportRefusal = (message: string) => void;

const RefusalContext = createContext<ReportRefusal | null>(null);
export const RefusalProvider = RefusalContext.Provider;
export const useReportRefusal = () => useContext(RefusalContext);

/** True for a state refusal: the booking changed under the page (HTTP 409). */
export function isStateRefusal(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 409;
}

/**
 * For the page. `reload` refetches the booking quietly; a failed reload must not throw or hide the
 * message. Render `alert` outside the change sections and wrap them in `<RefusalProvider value={report}>`.
 */
export function useBookingRefusals(reload: () => void | Promise<void>) {
  const [last, setLast] = useState<{ text: string; id: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const alertId = useId();
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useEffect(() => {
    if (last) ref.current?.focus();
  }, [last]);
  const report = useCallback<ReportRefusal>((text) => {
    setLast((p) => ({ text, id: (p?.id ?? 0) + 1 }));
    void Promise.resolve(reloadRef.current()).catch(() => {});
  }, []);
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
  return { report, alert, clear: () => setLast(null) };
}
