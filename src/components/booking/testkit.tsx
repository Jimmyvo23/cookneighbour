// Helpers shared by the T-045 component tests. Not a test file. The bookings come from the MOCK
// seed (real pricing, eat-by and allergy rules), not from hand-made numbers, so the tests never
// feed a component data the API could not send (lessons-learned section 3).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { BookingDetail, MeProfile } from "@/lib/api/types";
import {
  seedChefBookings,
  type SeededReceipts,
} from "@/lib/mocks/mock-booking-changes";
import { viewOf } from "@/lib/mocks/mock-bookings";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CHEF: MeProfile = {
  id: "mock-user-1",
  role: "chef",
  displayName: "Demo chef",
  country: "CA",
  currency: "CAD",
  language: "en",
};

export const SEED_ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A seeded booking, as the chef or the customer would receive it. */
export function seededBooking(
  n: 9101 | 9102 | 9103 | 9104 | 9105 | 9106,
  role: "chef" | "customer",
  over: (b: BookingDetail) => BookingDetail = (b) => b,
): BookingDetail {
  const { rows } = seedChefBookings(CHEF, new Date());
  const row = rows.find((r) => r.detail.id === SEED_ID(n))!;
  return over(viewOf(row, role));
}
export function seededReceipts(): SeededReceipts {
  return seedChefBookings(CHEF, new Date()).receipts;
}

export const reply = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

export interface Harness {
  host: HTMLDivElement;
  root: Root;
  fetchMock: ReturnType<typeof vi.fn>;
  text: () => string;
  q: (id: string) => HTMLElement | null;
  qa: (id: string) => HTMLElement[];
  button: (name: string | RegExp) => HTMLButtonElement | null;
  mount: (ui: React.ReactElement) => Promise<void>;
  click: (el: Element | null) => Promise<void>;
  type: (el: Element | null, value: string) => Promise<void>;
  flush: () => Promise<void>;
  cleanup: () => void;
}

export function harness(): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const flush = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  return {
    host,
    root,
    fetchMock,
    text: () => host.textContent ?? "",
    q: (id) => host.querySelector(`[data-testid="${id}"]`),
    qa: (id) => [
      ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
    ],
    button: (name) =>
      [...host.querySelectorAll("button")].find((b) =>
        typeof name === "string"
          ? b.textContent?.trim() === name
          : name.test(b.textContent ?? ""),
      ) ?? null,
    mount: async (ui) => {
      await act(async () => {
        root.render(ui);
      });
      await flush();
    },
    click: async (el) => {
      await act(async () => {
        (el as HTMLElement).click();
      });
      await flush();
    },
    type: async (el, value) => {
      await act(async () => {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const proto =
          input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    flush,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

/** The calls of the fetch mock whose URL ends with `suffix`, as [url, method, parsed body]. */
export function callsTo(
  fetchMock: ReturnType<typeof vi.fn>,
  suffix: string,
): [string, string, unknown][] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]).endsWith(suffix))
    .map((c) => [
      String(c[0]),
      c[1]?.method ?? "GET",
      typeof c[1]?.body === "string" ? JSON.parse(c[1].body) : undefined,
    ]);
}

type Handler = (body: unknown) => Response | Promise<Response>;
const ok =
  (status: number, body: unknown): Handler =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
export const json = ok;

/** Makes the fetch mock answer by "METHOD /path"; anything else is a 404 the test will notice. */
export function routes(
  fetchMock: ReturnType<typeof vi.fn>,
  table: Record<string, Handler>,
) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const h = table[key];
    if (!h)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: `no route ${key}` },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return Promise.resolve(h(body));
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Handler {
  return ok(status, { error: { code, message, ...extra } });
}
