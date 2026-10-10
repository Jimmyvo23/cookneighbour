// @vitest-environment jsdom
// Tester (T-041): the public chef page against the REAL apiFetch with a stubbed network, so we see
// exactly which requests leave the browser and what is rendered when the API answer is hostile
// (extra private keys, markup in every text field), missing, slow or broken. All data is made up.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicChefDetail } from "@/lib/api/types";
import { ChefDetailView } from "@/components/chefs/ChefDetailView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "00000000-0000-4000-8000-000000001001";
const EVIL = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;

function chef(over: Partial<PublicChefDetail> = {}): PublicChefDetail {
  return {
    id: ID,
    displayName: "Mai Tran (MOCK)",
    bio: "Line one\nLine two",
    photoPath: `${ID}/photo.png`,
    cuisines: ["Vietnamese"],
    languages: ["English"],
    hourlyRateCents: 2800,
    currency: "CAD",
    ratingAvg: 4.8,
    reviewCount: 14,
    serviceCity: "Mississauga",
    serviceRadiusKm: 20,
    locationOptions: ["customer_home", "chef_home"],
    dishes: [
      {
        id: "d1",
        name: "Bun cha",
        photoPath: `${ID}/d1.png`,
        description: "Grilled pork",
        cuisine: "Vietnamese",
        cookMinutes: 125,
        ingredientCostCents: 3005,
        servings: 4,
        allergens: ["fish", "soy"],
        shelfLifeDays: 2,
      },
      {
        id: "d2",
        name: "Rau muong",
        photoPath: null,
        description: null,
        cuisine: "Vietnamese",
        cookMinutes: 20,
        ingredientCostCents: 5,
        servings: 2,
        allergens: [],
        shelfLifeDays: 1,
      },
    ],
    bookableDates: ["2026-10-30", "2026-10-31", "2026-11-02", "2027-01-01"],
    today: "2026-10-10",
    lastBookableDay: "2027-01-08",
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown) {
  return () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

async function mount(id = ID) {
  await act(async () => {
    root.render(<ChefDetailView id={id} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete (window as unknown as { __pwned?: number }).__pwned;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ChefDetailView (tester)", () => {
  it("makes exactly one request, a GET of /api/chefs/:id, and none for the Book stub", async () => {
    fetchMock.mockImplementation(reply(200, chef()));
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/chefs/${ID}`);
    expect(init.method).toBe("GET");

    const book = host.querySelector<HTMLButtonElement>(
      '[data-testid="book-stub"]',
    )!;
    expect(book.getAttribute("aria-disabled")).toBe("true");
    await act(async () => book.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes a hostile id in the request path", async () => {
    fetchMock.mockImplementation(
      reply(404, { error: { code: "NOT_FOUND", message: "x" } }),
    );
    await mount("../me?x=1#h");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/chefs/${encodeURIComponent("../me?x=1#h")}`,
    );
  });

  it("renders markup in every text field as plain text and shows no extra private keys", async () => {
    const hostile = {
      ...chef({
        displayName: EVIL,
        bio: EVIL,
        cuisines: [EVIL],
        languages: [EVIL],
        serviceCity: EVIL,
        dishes: [
          {
            id: "d1",
            name: EVIL,
            photoPath: null,
            description: EVIL,
            cuisine: EVIL,
            cookMinutes: 10,
            ingredientCostCents: 100,
            servings: 1,
            allergens: [EVIL],
            shelfLifeDays: 2,
            // extra private keys on a dish
            internalNote: "SECRET-DISH-NOTE",
          } as never,
        ],
      }),
      addressLine: "SECRET-ADDRESS",
      phone: "SECRET-PHONE",
      email: "secret@example.com",
      kitchenPhotos: ["SECRET-KITCHEN"],
      policeCheckStatus: "SECRET-POLICE",
      postalCode: "SECRET-POSTAL",
      userId: "SECRET-USER",
    };
    fetchMock.mockImplementation(reply(200, hostile));
    await mount();
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(host.textContent).toContain(EVIL); // shown literally
    for (const s of [
      "SECRET-DISH-NOTE",
      "SECRET-ADDRESS",
      "SECRET-PHONE",
      "secret@example.com",
      "SECRET-KITCHEN",
      "SECRET-POLICE",
      "SECRET-POSTAL",
      "SECRET-USER",
    ])
      expect(host.textContent).not.toContain(s);
  });

  it("uses a storage URL only outside MOCK mode, and only on the project's storage path", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://example-project.supabase.co",
    );
    fetchMock.mockImplementation(reply(200, chef()));
    // MOCK mode uses the adapter, not fetch, so use the real path for the data and MOCK for photos:
    // the page decides on isMockEnabled() alone.
    await mount();
    // In MOCK mode the adapter answers (fetch is not used); the made-up chef has no storage URL.
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("outside MOCK mode the photo URLs point at the project's public buckets, path-encoded", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://example-project.supabase.co/",
    );
    fetchMock.mockImplementation(
      reply(
        200,
        chef({
          photoPath: `${ID}/evil path/x.png?a=1`,
        }),
      ),
    );
    await mount();
    const srcs = [...host.querySelectorAll("img")].map((i) => i.src);
    expect(srcs.length).toBe(2);
    for (const s of srcs)
      expect(
        s.startsWith(
          "https://example-project.supabase.co/storage/v1/object/public/",
        ),
      ).toBe(true);
    expect(srcs[0]).not.toContain("?a=1");
    expect(srcs[0]).toContain("%3Fa%3D1");
  });

  // FINDING (LOW, defence in depth): ".." is not encoded by encodeURIComponent, so the browser
  // resolves it and the URL leaves the bucket folder. The server keeps paths inside the owner's
  // folder, so only a tampered API answer reaches this. it.fails records the bug; when the builder
  // fixes it (reject dot segments in profilePhotoUrl/dishPhotoUrl), remove ".fails".
  it.fails(
    "a '..' in a photo path stays inside the public bucket",
    async () => {
      vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        "https://example-project.supabase.co",
      );
      fetchMock.mockImplementation(
        reply(200, chef({ photoPath: "../../x.png" })),
      );
      await mount();
      const src = host.querySelector("img")!.src;
      expect(src).toContain("/storage/v1/object/public/profile-photos/");
    },
  );

  it("allergens are words: 'Contains:' list, or 'No allergens listed by the chef' (never 'free')", async () => {
    fetchMock.mockImplementation(reply(200, chef()));
    await mount();
    const boxes = [
      ...host.querySelectorAll('[data-testid="dish-allergens"]'),
    ].map((e) => e.textContent);
    expect(boxes[0]).toContain("Contains: fish, soy");
    expect(boxes[1]).toContain("No allergens listed by the chef");
    expect(host.textContent!.toLowerCase()).not.toMatch(
      /allergen[- ]free|free of allerg|free from/,
    );
  });

  it("14 allergens are all written out", async () => {
    const all = Array.from({ length: 14 }, (_, i) => `allergen${i + 1}`);
    const c = chef();
    c.dishes[0].allergens = all;
    fetchMock.mockImplementation(reply(200, c));
    await mount();
    const t = host.querySelector(
      '[data-testid="dish-allergens"]',
    )!.textContent!;
    for (const a of all) expect(t).toContain(a);
  });

  it("cost is dollars from cents, including cents below a dime and rounding", async () => {
    fetchMock.mockImplementation(reply(200, chef()));
    await mount();
    const t = host.textContent!;
    expect(t).toContain("Estimated ingredient cost: $30.05");
    expect(t).toContain("Estimated ingredient cost: $0.05");
    expect(t).toContain("Cooking time: 2 h 5 min");
    expect(t).toContain("Eat within 1 day of cooking");
  });

  it("dates come from the response (today and lastBookableDay), grouped across month and year ends", async () => {
    fetchMock.mockImplementation(reply(200, chef()));
    await mount();
    const t = host.textContent!;
    expect(t).toContain("Dates from Sat, Oct 10 to Fri, Jan 8, 2027.");
    const summaries = [...host.querySelectorAll("summary")].map((s) =>
      s.textContent!.replace(/\s+/g, " "),
    );
    expect(summaries).toEqual([
      "October 2026 (2 days)",
      "November 2026 (1 day)",
      "January 2027 (1 day)",
    ]);
    const times = [...host.querySelectorAll("time")].map((x) =>
      x.getAttribute("datetime"),
    );
    expect(times).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-02",
      "2027-01-01",
    ]);
    expect(t).toContain("Days that are already booked are not removed yet");
  });

  it("does not use the browser clock for the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-05-05T12:00:00Z"));
    try {
      fetchMock.mockImplementation(reply(200, chef()));
      await mount();
      expect(host.textContent).toContain("Dates from Sat, Oct 10");
      expect(host.textContent).not.toContain("2031");
    } finally {
      vi.useRealTimers();
    }
  });

  it("empty or junk bookableDates give the no-days message without crashing", async () => {
    fetchMock.mockImplementation(reply(200, chef({ bookableDates: [] })));
    await mount();
    expect(host.querySelector('[data-testid="no-dates"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    fetchMock.mockImplementation(
      reply(
        200,
        chef({
          bookableDates: ["nope", "2026-02-30", "2026-10-11", "2026-10-11"],
        }),
      ),
    );
    await mount();
    expect(host.querySelectorAll("time").length).toBe(1);
  });

  it.each([
    [
      "404 with the contract body",
      404,
      { error: { code: "NOT_FOUND", message: "Chef not found." } },
    ],
    ["404 with a non-JSON body", 404, "<html>nope</html>"],
    ["404 with an empty body", 404, ""],
  ])("%s shows the one 'Chef not found' state", async (_n, status, body) => {
    fetchMock.mockImplementation(reply(status, body));
    await mount();
    expect(host.querySelector("h1")!.textContent).toBe("Chef not found");
    expect(host.querySelector('[data-testid="load-error"]')).toBeNull();
    expect(host.querySelectorAll("h1").length).toBe(1);
    expect(document.title).toBe("Chef not found — CookNeighbour");
  });

  it.each([
    [500, { error: { code: "INTERNAL", message: "boom SECRET-STACK" } }],
    [503, "<html>"],
    [429, { error: { code: "RATE_LIMITED", message: "slow" } }],
    [400, { error: { code: "VALIDATION", message: "bad" } }],
  ])(
    "status %s shows the retry state, not 'not found', and hides server text",
    async (status, body) => {
      fetchMock.mockImplementation(reply(status as number, body));
      await mount();
      expect(host.querySelector('[data-testid="load-error"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="not-found"]')).toBeNull();
      expect(host.textContent).not.toContain("SECRET-STACK");
    },
  );

  it("a network error shows retry, and Try again loads the chef", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await mount();
    expect(host.querySelector('[data-testid="load-error"]')).not.toBeNull();
    fetchMock.mockImplementation(reply(200, chef()));
    const btn = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    )!;
    await act(async () => btn.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("h1")!.textContent).toBe("Mai Tran (MOCK)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("locationOptions [] says 'cannot be booked yet' neutrally, with no kitchen note", async () => {
    fetchMock.mockImplementation(reply(200, chef({ locationOptions: [] })));
    await mount();
    const t = host.textContent!;
    expect(t).toContain("This chef cannot be booked yet.");
    expect(host.querySelector('[data-testid="mock-badge"]')).toBeNull();
    expect(host.querySelector('[data-testid="location-options"]')).toBeNull();
    for (const w of [
      "rejected",
      "pending",
      "not approved",
      "unapproved",
      "hygiene",
    ])
      expect(t.toLowerCase()).not.toContain(w);
  });

  it("chef's home only shows the MOCK kitchen note and no address", async () => {
    fetchMock.mockImplementation(
      reply(200, chef({ locationOptions: ["chef_home"] })),
    );
    await mount();
    const where = host.querySelector('[data-testid="location-options"]')!;
    expect(where.textContent).toBe("At the chef's home");
    expect(host.textContent).toContain("MOCK check");
    expect(host.textContent).toContain("The address is not shown here.");
  });

  it("customer's home only shows no chef's-home or kitchen text", async () => {
    fetchMock.mockImplementation(
      reply(200, chef({ locationOptions: ["customer_home"] })),
    );
    await mount();
    expect(host.textContent).not.toContain("kitchen");
    expect(host.textContent).not.toContain("At the chef's home");
  });

  it("a slow older answer cannot replace the newer chef (stale-response guard)", async () => {
    let resolveFirst!: (r: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((r) => (resolveFirst = r)),
      )
      .mockImplementation(reply(200, chef({ displayName: "Second Chef" })));
    await act(async () => root.render(<ChefDetailView id="aaa" />));
    await act(async () => root.render(<ChefDetailView id="bbb" />));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      resolveFirst(
        new Response(JSON.stringify(chef({ displayName: "First Chef" })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    expect(host.querySelector("h1")!.textContent).toBe("Second Chef");
  });

  it("headings are h1 then h2 sections then h3 dishes, in that order", async () => {
    fetchMock.mockImplementation(reply(200, chef()));
    await mount();
    const hs = [...host.querySelectorAll("h1,h2,h3")].map(
      (h) => h.tagName + ":" + h.textContent,
    );
    expect(hs).toEqual([
      "H1:Mai Tran (MOCK)",
      "H2:About",
      "H2:Where the chef can cook",
      "H2:Dishes",
      "H3:Bun cha",
      "H3:Rau muong",
      "H2:Available days",
      "H2:Book this chef",
    ]);
  });

  it("a very long unbroken name and 40 dishes render without throwing", async () => {
    const c = chef({ displayName: "W".repeat(500) });
    c.dishes = Array.from({ length: 40 }, (_, i) => ({
      ...c.dishes[0],
      id: `d${i}`,
      name: "N".repeat(300),
    }));
    fetchMock.mockImplementation(reply(200, c));
    await mount();
    expect(host.querySelectorAll('[data-testid="dish"]').length).toBe(40);
  });

  // FINDING (INFO): a 200 answer that breaks the contract shape (no arrays) throws during render
  // instead of showing the retry state. Only a broken server can send it. it.fails records it.
  it.fails(
    "a 200 answer missing arrays shows the retry state instead of crashing",
    async () => {
      fetchMock.mockImplementation(reply(200, { id: ID, displayName: "X" }));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await mount();
      } finally {
        err.mockRestore();
      }
      expect(host.querySelector('[data-testid="load-error"]')).not.toBeNull();
    },
  );
});
