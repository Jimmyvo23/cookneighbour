// @vitest-environment jsdom
// Tester (T-036): the admin review sections against the REAL apiFetch with a stubbed network, so we
// see the exact requests (method, Content-Type header, body) that would leave the browser, and the
// exact text and focus after errors. Everything here is MOCK data; nothing is really verified.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminChefDetail,
  ChefApplication,
  SignedDocumentUrl,
} from "@/lib/api/types";
import {
  ApplicationSection,
  ChecksSection,
  DecisionSection,
  DocumentsSection,
  KitchenSection,
} from "@/components/admin/ReviewSections";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CHEF = "00000000-0000-4000-8000-000000000901";
const ADDRESS = {
  line: "1 Fictional Street",
  city: "Mississauga",
  postalCode: "L5B1A1",
};

function app(over: Partial<ChefApplication> = {}): ChefApplication {
  return {
    status: "pending",
    displayName: "Linh",
    bio: "Bio",
    photoPath: `${CHEF}/photo-x.png`,
    cuisines: ["Vietnamese"],
    languages: ["English"],
    hourlyRateCents: 2800,
    servicePostalPrefix: "L5B",
    serviceRadiusKm: 20,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: false,
    country: "CA",
    currency: "CAD",
    language: "en",
    rejectReason: null,
    checks: {
      id: "pending",
      foodHandler: "pending",
      kitchen: "pending",
      police: "not_started",
    },
    documents: {
      idDocumentPath: `${CHEF}/id-a.png`,
      foodHandlerPath: `${CHEF}/food-handler-a.pdf`,
      kitchenPhotoPaths: [`${CHEF}/kitchen-a.png`, `${CHEF}/kitchen-b.png`],
    },
    kitchenAddress: ADDRESS,
    allergenAckAt: null,
    kitchenHygieneAckAt: "2026-10-02T15:00:00.000Z",
    missing: [],
    ...over,
  };
}
const link = (
  kind: SignedDocumentUrl["kind"],
  path: string,
): SignedDocumentUrl => ({
  kind,
  path,
  url: `https://files.example/${path}?token=t`,
  expiresInSeconds: 300,
});
function detail(
  a: ChefApplication,
  skip: string[] = [],
  extra: Partial<AdminChefDetail> = {},
): AdminChefDetail {
  const all: SignedDocumentUrl[] = [];
  if (a.documents.idDocumentPath)
    all.push(link("id_document", a.documents.idDocumentPath));
  if (a.documents.foodHandlerPath)
    all.push(link("food_handler", a.documents.foodHandlerPath));
  for (const p of a.documents.kitchenPhotoPaths)
    all.push(link("kitchen_photo", p));
  return {
    application: a,
    email: "chef@example.com",
    documents: all.filter((d) => !skip.includes(d.path)),
    ...extra,
  };
}

interface Call {
  path: string;
  method: string;
  contentType: string | null;
  body: unknown;
  hasBody: boolean;
}
let calls: Call[] = [];
let reply: () => Response;
let root: Root;
let host: HTMLDivElement;

const ok = () =>
  new Response(JSON.stringify({ application: app() }), { status: 200 });
const err = (status: number, code: string, message: string, extra = {}) =>
  new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status,
  });

beforeEach(() => {
  calls = [];
  reply = ok;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      calls.push({
        path,
        method: init.method ?? "GET",
        contentType: h.get("Content-Type"),
        hasBody: typeof init.body === "string",
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return reply();
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
function button(name: RegExp | string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find((x) =>
    typeof name === "string"
      ? x.textContent === name
      : name.test(x.textContent ?? ""),
  );
  if (!b) throw new Error(`no button ${name}`);
  return b;
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!;
    set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const noop = async () => true;
const props = (d: AdminChefDetail) => ({
  detail: d,
  chefId: CHEF,
  onReload: vi.fn(),
  onChanged: noop,
});

describe("checks (MOCK)", () => {
  it("every check control has a MOCK badge and honest wording", () => {
    render(<ChecksSection {...props(detail(app()))} />);
    expect(host.querySelectorAll('[data-testid="mock-badge"]').length).toBe(3);
    expect(host.textContent).toMatch(/Nothing is really verified/);
    expect(host.textContent).toMatch(/Document checks \(MOCK\)/);
    expect(host.textContent).toMatch(/Not run in this prototype/);
  });

  it("PATCHes exactly the stored paths shown, with Content-Type json, and no police when unchanged", async () => {
    const a = app();
    render(<ChecksSection {...props(detail(a))} />);
    choose(host.querySelector("#check-id")!, "verified");
    choose(host.querySelector("#check-food-handler")!, "failed");
    await click(button("Save MOCK checks"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: `/api/admin/chefs/${CHEF}/checks`,
      method: "PATCH",
      contentType: "application/json",
      body: {
        idCheck: "verified",
        idDocumentPath: a.documents.idDocumentPath,
        foodHandlerCheck: "failed",
        foodHandlerPath: a.documents.foodHandlerPath,
      },
    });
    expect(Object.keys(calls[0].body as object).sort()).toEqual([
      "foodHandlerCheck",
      "foodHandlerPath",
      "idCheck",
      "idDocumentPath",
    ]);
  });

  it("a file without a signed link cannot be marked verified (nothing is sent); failed is allowed", async () => {
    const a = app();
    render(
      <ChecksSection
        {...props(detail(a, [a.documents.idDocumentPath as string]))}
      />,
    );
    choose(host.querySelector("#check-id")!, "verified");
    await click(button("Save MOCK checks"));
    expect(calls).toHaveLength(0);
    const select = host.querySelector("#check-id") as HTMLElement;
    expect(
      document.activeElement === select ||
        host.contains(document.activeElement),
    ).toBe(true);
    expect(host.textContent).toMatch(
      /cannot verify a file you could not open/i,
    );
    choose(host.querySelector("#check-id")!, "failed");
    await click(button("Save MOCK checks"));
    expect(calls).toHaveLength(1);
  });

  it("409 INVALID_STATE says nothing was saved, offers a reload and moves focus to the error", async () => {
    reply = () =>
      err(409, "INVALID_STATE", "The file changed after you opened it.");
    const p = props(detail(app()));
    render(<ChecksSection {...p} />);
    choose(host.querySelector("#check-id")!, "verified");
    await click(button("Save MOCK checks"));
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/Nothing was saved/);
    expect(alert.textContent).toMatch(/Reload this application/);
    expect(document.activeElement).toBe(alert);
    await click(button("Reload this application"));
    expect(p.onReload).toHaveBeenCalled();
  });
});

describe("kitchen review (MOCK)", () => {
  it("has MOCK on the status and on both buttons", () => {
    render(<KitchenSection {...props(detail(app()))} />);
    expect(
      host.querySelectorAll('[data-testid="mock-badge"]').length,
    ).toBeGreaterThanOrEqual(2);
    expect(button("Approve kitchen (MOCK)")).toBeTruthy();
    expect(button("Reject kitchen (MOCK)")).toBeTruthy();
    expect(host.textContent).toMatch(/nobody inspects the real kitchen/);
  });

  it("sends every stored photo path and the stored address, with Content-Type json", async () => {
    const a = app();
    render(<KitchenSection {...props(detail(a))} />);
    await click(button("Approve kitchen (MOCK)"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: `/api/admin/chefs/${CHEF}/kitchen-review`,
      method: "POST",
      contentType: "application/json",
    });
    const b = calls[0].body as Record<string, unknown>;
    expect(b.decision).toBe("approve");
    expect(b.reviewedPhotoPaths).toEqual(a.documents.kitchenPhotoPaths);
    expect(b.reviewedAddress).toEqual(ADDRESS);
    expect("note" in b).toBe(false);
  });

  it("sends reviewedAddress null and [] when none is stored; APPLICATION_INCOMPLETE is listed in plain words", async () => {
    const a = app({
      kitchenAddress: null,
      kitchenHygieneAckAt: null,
      documents: {
        idDocumentPath: `${CHEF}/id-a.png`,
        foodHandlerPath: `${CHEF}/food-handler-a.pdf`,
        kitchenPhotoPaths: [],
      },
    });
    reply = () =>
      err(409, "APPLICATION_INCOMPLETE", "The kitchen is not complete.", {
        missing: ["kitchenAddress", "kitchenPhotos"],
      });
    render(<KitchenSection {...props(detail(a))} />);
    await click(button("Approve kitchen (MOCK)"));
    const b = calls[0].body as Record<string, unknown>;
    expect(b.reviewedAddress).toBeNull();
    expect(b.reviewedPhotoPaths).toEqual([]);
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/Still missing/);
    expect(alert.textContent).not.toMatch(/kitchenAddress|kitchenPhotos/);
    expect(document.activeElement).toBe(alert);
  });

  it("refuses to approve while a kitchen photo has no link, but a rejection with a note still goes out with every path", async () => {
    const a = app();
    render(
      <KitchenSection
        {...props(detail(a, [a.documents.kitchenPhotoPaths[1]]))}
      />,
    );
    await click(button("Approve kitchen (MOCK)"));
    expect(calls).toHaveLength(0);
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/could not open/);
    expect(document.activeElement).toBe(alert);
    type(
      host.querySelector("textarea") as HTMLTextAreaElement,
      "One photo will not open.",
    );
    await click(button("Reject kitchen (MOCK)"));
    expect(calls).toHaveLength(1);
    const b = calls[0].body as Record<string, unknown>;
    expect(b.decision).toBe("reject");
    expect(b.note).toBe("One photo will not open.");
    expect(b.reviewedPhotoPaths).toEqual(a.documents.kitchenPhotoPaths);
  });

  it("a rejection needs a note and focuses the note field", async () => {
    render(<KitchenSection {...props(detail(app()))} />);
    await click(button("Reject kitchen (MOCK)"));
    expect(calls).toHaveLength(0);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });
});

describe("decision", () => {
  it("approve is a POST with Content-Type application/json and no body", async () => {
    render(<DecisionSection {...props(detail(app()))} />);
    await click(button("Approve chef"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: `/api/admin/chefs/${CHEF}/approve`,
      method: "POST",
      contentType: "application/json",
      hasBody: false,
    });
  });

  it("approve 409 INVALID_STATE says nothing was saved, offers reload, focuses the error", async () => {
    reply = () => err(409, "INVALID_STATE", "This chef is already approved.");
    const p = props(detail(app()));
    render(<DecisionSection {...p} />);
    await click(button("Approve chef"));
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/Nothing was saved/);
    expect(document.activeElement).toBe(alert);
    await click(button("Reload this application"));
    expect(p.onReload).toHaveBeenCalledTimes(1);
  });

  it("approve 409 APPLICATION_INCOMPLETE lists items and explains a vanished file", async () => {
    reply = () =>
      err(409, "APPLICATION_INCOMPLETE", "The application is not complete.", {
        missing: ["idDocument", "bio", "phoneVerified"],
      });
    render(<DecisionSection {...props(detail(app()))} />);
    await click(button("Approve chef"));
    const text = (host.querySelector('[role="alert"]') as HTMLElement)
      .textContent!;
    expect(text).toMatch(/government ID file/);
    expect(text).toMatch(/the bio/);
    expect(text).toMatch(/vanished from storage/);
    expect(text).not.toMatch(/idDocument|phoneVerified/);
  });

  it("reject sends the reason with Content-Type json; an unsafe or short reason is stopped before sending", async () => {
    render(<DecisionSection {...props(detail(app()))} />);
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    for (const bad of ["", "ab", "bad\u0007text", "x".repeat(501), "\ud800"]) {
      type(ta, bad);
      await click(button("Reject application"));
      expect(calls).toHaveLength(0);
      expect(document.activeElement).toBe(ta);
    }
    type(ta, "  <script>alert(1)</script> unclear photo  ");
    await click(button("Reject application"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: `/api/admin/chefs/${CHEF}/reject`,
      contentType: "application/json",
    });
    expect(Object.keys(calls[0].body as object)).toEqual(["reason"]);
  });

  it("accepts exactly 3 and exactly 500 characters", async () => {
    render(<DecisionSection {...props(detail(app()))} />);
    const ta = host.querySelector("textarea") as HTMLTextAreaElement;
    type(ta, "abc");
    await click(button("Reject application"));
    type(ta, "y".repeat(500));
    await click(button("Reject application"));
    expect(calls).toHaveLength(2);
  });

  it("reject 409 INVALID_STATE says nothing was saved and offers a reload", async () => {
    reply = () =>
      err(409, "INVALID_STATE", "This application is already rejected.");
    render(<DecisionSection {...props(detail(app()))} />);
    type(host.querySelector("textarea") as HTMLTextAreaElement, "Valid reason");
    await click(button("Reject application"));
    const alert = [
      ...host.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((x) => x.textContent)!;
    expect(alert.textContent).toMatch(/Nothing was saved/);
    expect(button("Reload this application")).toBeTruthy();
    expect(document.activeElement).toBe(alert);
  });

  it("a network failure is explained and focused", async () => {
    reply = () => {
      throw new TypeError("offline");
    };
    render(<DecisionSection {...props(detail(app()))} />);
    await click(button("Approve chef"));
    const alert = host.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toMatch(/Could not reach the server/);
    expect(document.activeElement).toBe(alert);
  });
});

describe("plain text and missing links", () => {
  it("bio, display name context, reject reason are text, never HTML", () => {
    const evil =
      '<img src=x onerror="alert(1)"><script>alert(2)</script><b>x</b>';
    render(
      <ApplicationSection
        detail={detail(
          app({ bio: evil, rejectReason: evil, displayName: evil }),
          [],
          { email: evil },
        )}
      />,
    );
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain(evil);
  });

  it("a listed file with no link shows Not available, no anchor and no image", () => {
    const a = app();
    render(
      <DocumentsSection
        detail={detail(a, [
          a.documents.idDocumentPath as string,
          a.documents.foodHandlerPath as string,
        ])}
      />,
    );
    expect(
      host.querySelectorAll('[data-testid="doc-unavailable"]').length,
    ).toBe(2);
    expect(host.textContent).toMatch(/Not available/);
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });

  it("a file with a link opens in a new tab safely; a PDF is a link, not an image", () => {
    render(<DocumentsSection detail={detail(app())} />);
    const anchors = [...host.querySelectorAll("a")];
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toMatch(/noopener/);
    }
    expect(host.querySelectorAll("img")).toHaveLength(1); // the PNG ID only
  });
});
