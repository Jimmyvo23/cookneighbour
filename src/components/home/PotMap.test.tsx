// @vitest-environment jsdom
// T-126 v2: the home map with three DEMO pots, the live card and the chef link. The chef lookup is
// stubbed; all names are the made-up seed demo chefs.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PotMap } from "./PotMap";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

type Lookup = (url: string) => Promise<Response> | Response;
const ok = (items: { id: string; displayName: string }[]) =>
  new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 });

async function mount(lookup: Lookup): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(lookup(String(input))),
  );
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<PotMap />));
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pots = () => Array.from(host!.querySelectorAll("button"));
const pot = (i: number) => pots()[i];
const card = () => host!.querySelector('[data-testid="pot-card"]')!;
const cardLink = () => card().querySelector("a");
const click = async (el: Element) =>
  act(async () => (el as HTMLElement).click());

describe("PotMap", () => {
  it("shows the empty card first", async () => {
    await mount(() => ok([]));
    expect(card().textContent).toContain("Neighbours are cooking.");
    expect(card().textContent).toContain(
      "Pick a pot to see the dish, the cook and how long it takes.",
    );
    expect(host!.textContent).toContain(
      "Tap or click a pot on the map: who is cooking near you?",
    );
    expect(card().getAttribute("aria-live")).toBe("polite");
  });

  it("three pot buttons in order, with the map named", async () => {
    await mount(() => ok([]));
    expect(pots().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Pho bo by Chef Lan (demo)",
      "Chole and roti by Chef Harpreet (demo)",
      "Brown stew fish by Chef Devon (demo)",
    ]);
    pots().forEach((b) => expect(b.getAttribute("type")).toBe("button"));
    const map = host!.querySelector('svg[role="img"]')!;
    expect(map.getAttribute("aria-label")).toBe(
      "Drawn map of Brampton, Mississauga and Toronto, not to scale",
    );
  });

  it("click opens one pot", async () => {
    await mount(() => ok([]));
    await click(pot(1));
    expect(pots().map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(pot(1).className).toContain("is-open");
    const text = card().textContent!;
    expect(text).toContain("Chole and roti");
    expect(text).toContain("DEMO");
    expect(text).toContain("Chef Harpreet · Brampton · about 1.5 h");
    expect(text).not.toContain("(demo)");
  });

  it("second click keeps it open", async () => {
    await mount(() => ok([]));
    await click(pot(1));
    await click(pot(1));
    expect(pot(1).getAttribute("aria-pressed")).toBe("true");
    expect(card().textContent).toContain("Chole and roti");
  });

  it("opening another pot closes the first", async () => {
    await mount(() => ok([]));
    await click(pot(0));
    await click(pot(2));
    expect(pot(0).getAttribute("aria-pressed")).toBe("false");
    expect(pot(2).getAttribute("aria-pressed")).toBe("true");
  });

  it("focus opens a pot", async () => {
    await mount(() => ok([]));
    await act(async () => pot(2).focus());
    expect(card().textContent).toContain("Brown stew fish");
  });

  it("hover opens a pot", async () => {
    await mount(() => ok([]));
    await act(async () => {
      pot(0).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(card().textContent).toContain("Pho bo");
  });

  it("links to the chef when found", async () => {
    await mount((url) =>
      url.includes("city=Mississauga")
        ? ok([{ id: "abc", displayName: "Chef Lan (demo)" }])
        : ok([]),
    );
    await click(pot(0));
    expect(cardLink()!.getAttribute("href")).toBe("/chefs/abc");
    expect(cardLink()!.textContent).toBe("See Chef Lan");
  });

  it("falls back to search when the chef is missing", async () => {
    await mount(() => ok([]));
    await click(pot(0));
    expect(cardLink()!.getAttribute("href")).toBe(
      "/search?city=Mississauga&cuisine=Vietnamese",
    );
    expect(cardLink()!.textContent).toBe("Find a Vietnamese cook");
  });

  it("shows the search link at once while the lookup is slow", async () => {
    await mount(() => new Promise<Response>(() => {}));
    await click(pot(1));
    expect(cardLink()!.getAttribute("href")).toBe(
      "/search?city=Brampton&cuisine=Indian",
    );
    expect(cardLink()!.textContent).toBe("Find an Indian cook");
  });

  it("falls back when the fetch fails, without a console error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await mount(() => Promise.reject(new Error("offline")));
    await click(pot(2));
    expect(cardLink()!.getAttribute("href")).toBe(
      "/search?city=Toronto&cuisine=Jamaican",
    );
    expect(cardLink()!.textContent).toBe("Find a Jamaican cook");
    expect(err).not.toHaveBeenCalled();
  });

  it("falls back on a non-OK answer", async () => {
    await mount(() => new Response("{}", { status: 500 }));
    await click(pot(0));
    expect(cardLink()!.getAttribute("href")).toBe(
      "/search?city=Mississauga&cuisine=Vietnamese",
    );
  });

  it("fetches each lookup once", async () => {
    const fetchMock = await mount(() => ok([]));
    await click(pot(0));
    await click(pot(1));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("city=Mississauga&cuisine=Vietnamese");
    expect(urls[1]).toContain("city=Brampton&cuisine=Indian");
    expect(urls[2]).toContain("city=Toronto&cuisine=Jamaican");
    expect(urls[0].startsWith("/api/chefs?")).toBe(true);
  });

  it("does not call the server in MOCK mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const fetchMock = await mount(() => ok([]));
    expect(fetchMock).not.toHaveBeenCalled();
    await click(pot(0));
    expect(cardLink()!.getAttribute("href")).toBe(
      "/search?city=Mississauga&cuisine=Vietnamese",
    );
  });
});
