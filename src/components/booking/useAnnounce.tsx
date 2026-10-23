"use client";
// One place that announces a successful change and takes focus (lessons-learned section 3: one
// focus owner). Each call makes a new element (new key), so the same message twice in a row is
// announced and focused again (T-045 round 3, L4).
import { useEffect, useRef, useState } from "react";

export const NOTICE_BOX_CLS = "notice-ok p-3 font-semibold";

export function useAnnounce() {
  const [last, setLast] = useState<{ text: string; id: number } | null>(null);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (last) ref.current?.focus();
  }, [last]);
  const announce = (text: string) =>
    setLast((p) => ({ text, id: (p?.id ?? 0) + 1 }));
  /** The element to render. `activeClass` is used while there is a message. */
  const notice = (testId: string, activeClass: string) => (
    <p
      key={last?.id ?? 0}
      ref={ref}
      tabIndex={-1}
      role="status"
      data-testid={testId}
      className={last ? activeClass : "sr-only"}
    >
      {last?.text}
    </p>
  );
  return { announce, notice };
}
