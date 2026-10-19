// @vitest-environment jsdom
// T-047 Tester: gaps beside the builder's ChatSection.test.tsx. Realtime is a fake `connect`; the
// routes answer the contract 7C shapes. A test marked it.fails is a bug found (see the handoff):
// it passes in CI today and turns red the day the bug is fixed, so the marker must then go.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingStatus, MessageView } from "@/lib/api/types";
import type { ChatConnect, ChatHandlers } from "@/lib/chat/realtime";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  seededBooking,
  type Harness,
} from "@/components/booking/testkit";
import { ChatSection } from "./ChatSection";
import { ChefBookingView } from "@/components/booking/ChefBookingView";
import { BookingDetailView } from "@/components/booking/BookingDetailView";

const supabaseSpy = vi.hoisted(() => ({ created: 0 }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    supabaseSpy.created++;
    throw new Error("the Supabase client must not be created in this test");
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

let h: Harness;
beforeEach(() => {
  h = harness();
  supabaseSpy.created = 0;
});
afterEach(() => h.cleanup());

const BID = "00000000-0000-4000-8000-000000000b01";
const PATH = `/api/bookings/${BID}/messages`;
const GET1 = `GET ${PATH}?limit=50`;
const POST = `POST ${PATH}`;
const mid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (n: number, over: Partial<MessageView> = {}): MessageView => ({
  id: mid(n),
  bookingId: BID,
  senderId: "other",
  mine: false,
  clientId: null,
  body: `message ${n}`,
  createdAt: `2026-10-19T12:00:0${n}.000Z`,
  ...over,
});
const empty = { [GET1]: json(200, { items: [], nextCursor: null }) };

function fakeLive() {
  const f = {
    handlers: null as ChatHandlers | null,
    connects: 0,
    closed: 0,
    release: null as null | (() => void),
    slow: false,
  };
  const connect: ChatConnect = async (_id, hd) => {
    f.connects++;
    if (f.slow) await new Promise<void>((r) => (f.release = r));
    f.handlers = hd;
    return { userId: "me", close: () => void f.closed++ };
  };
  const row = (n: number, over: Record<string, unknown> = {}) =>
    f.handlers!.onRow({
      id: mid(n),
      booking_id: BID,
      sender_id: "other",
      client_id: null,
      body: `message ${n}`,
      created_at: `2026-10-19T12:00:0${n}.000Z`,
      ...over,
    });
  return { f, connect, row };
}

async function mount(
  live: ReturnType<typeof fakeLive>,
  over: Partial<Parameters<typeof ChatSection>[0]> = {},
) {
  await h.mount(
    <ChatSection
      bookingId={BID}
      status="accepted"
      frozen={false}
      expiresAt={null}
      otherName="Lan"
      connect={live.connect}
      mock={false}
      {...over}
    />,
  );
}
const box = () => h.host.querySelector("textarea")!;
const items = () =>
  [...h.host.querySelectorAll('[data-testid="chat-message"]')].map(
    (e) => e.textContent ?? "",
  );
const sendBtn = () => h.button(/^Send|^Sending/);
async function typeAndSend(text: string) {
  await h.type(box(), text);
  await h.click(sendBtn());
}
const posts = () => callsTo(h.fetchMock, PATH).filter((c) => c[1] === "POST");
const clientIdOf = (c: [string, string, unknown]) =>
  (c[2] as { clientId: string }).clientId;
const saved = (n: number) => (body: unknown) => {
  const b = body as { clientId: string; body: string };
  return new Response(
    JSON.stringify(
      view(n, {
        mine: true,
        senderId: "me",
        clientId: b.clientId,
        body: b.body,
      }),
    ),
    { status: 201 },
  );
};
const offline = () => {
  throw new TypeError("offline");
};

// ---------------------------------------------------------------------------------------------
// Hidden and open chats as the two booking PAGES wire them (props come from the booking detail).
// ---------------------------------------------------------------------------------------------
describe.each(["customer", "chef"] as const)(
  "%s booking page wiring",
  (role) => {
    async function page(over: (b: ReturnType<typeof seededBooking>) => object) {
      const b = seededBooking(9104, role, (x) => ({ ...x, ...over(x) }));
      routes(h.fetchMock, {
        [`GET /api/bookings/${b.id}`]: json(200, b),
        [`GET /api/bookings/${b.id}/messages?limit=50`]: json(200, {
          items: [],
          nextCursor: null,
        }),
      });
      await h.mount(
        role === "chef" ? (
          <ChefBookingView id={b.id} />
        ) : (
          <BookingDetailView id={b.id} />
        ),
      );
      for (let i = 0; i < 4; i++) await h.flush(); // booking, then the chat history
      return b;
    }
    const messageCalls = () =>
      h.fetchMock.mock.calls.filter((c) => /\/messages/.test(String(c[0])));

    it.each([
      "declined",
      "cancelled",
      "expired",
      "no_show_customer",
      "no_show_chef",
    ] as BookingStatus[])(
      "%s: no chat and no request to /messages at all",
      async (status) => {
        await page(() => ({ status }));
        expect(h.q("chat")).toBeNull();
        expect(h.host.textContent).not.toMatch(/Chat with/);
        expect(messageCalls()).toEqual([]);
      },
    );

    it("a request past expiresAt that the sweep has not marked: no chat, no request", async () => {
      await page(() => ({
        status: "requested",
        expiresAt: new Date(Date.now() - 60e3).toISOString(),
      }));
      expect(h.q("chat")).toBeNull();
      expect(messageCalls()).toEqual([]);
    });

    it("a request before expiresAt: open", async () => {
      await page(() => ({
        status: "requested",
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      }));
      expect(h.q("chat")).not.toBeNull();
      expect(messageCalls().length).toBeGreaterThan(0);
    });

    it.each(["accepted", "completed"] as BookingStatus[])(
      "%s: open",
      async (status) => {
        await page(() => ({ status, frozen: false }));
        expect(h.q("chat")).not.toBeNull();
        expect(h.host.querySelector("textarea")).not.toBeNull();
      },
    );

    it.each(["requested", "accepted", "completed"] as BookingStatus[])(
      "%s and frozen: read only, no box, no Send, no POST",
      async (status) => {
        await page(() => ({
          status,
          frozen: true,
          expiresAt: new Date(Date.now() + 3600e3).toISOString(),
        }));
        expect(h.q("chat")).not.toBeNull();
        expect(h.q("chat-frozen")).not.toBeNull();
        const chat = h.q("chat")!;
        expect(chat.querySelector("textarea")).toBeNull();
        expect(chat.querySelector("form")).toBeNull();
        expect(
          [...chat.querySelectorAll("button")].map((b) => b.textContent),
        ).not.toContain("Send");
        // Reading still works.
        expect(
          messageCalls().some((c) => (c[1]?.method ?? "GET") === "GET"),
        ).toBe(true);
        expect(messageCalls().some((c) => c[1]?.method === "POST")).toBe(false);
      },
    );
  },
);

// ---------------------------------------------------------------------------------------------
describe("frozen chat has no way to send", () => {
  it("a failed message's Retry goes away when the booking becomes frozen", async () => {
    // The booking page can pass frozen=true later (a reload of the booking). A bubble that failed
    // before that still offers "Retry sending", which would POST to a read-only chat.
    const l = fakeLive();
    routes(h.fetchMock, { ...empty, [POST]: offline });
    await mount(l);
    await typeAndSend("hello");
    expect(h.button("Retry sending")).not.toBeNull();
    await mount(l, { frozen: true });
    expect(h.q("chat-frozen")).not.toBeNull();
    expect(h.button("Retry sending")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe("send states", () => {
  it("shows pending while the request is out, then sent; a second click sends nothing", async () => {
    const l = fakeLive();
    let release!: (r: Response) => void;
    routes(h.fetchMock, {
      ...empty,
      [POST]: () =>
        new Promise<Response>((r) => (release = r)) as unknown as Response,
    });
    await mount(l);
    await h.type(box(), "wait for it");
    await h.click(sendBtn());
    expect(
      h.host
        .querySelector('[data-testid="chat-message"]')
        ?.getAttribute("data-state"),
    ).toBe("pending");
    expect(items()[0]).toContain("Sending...");
    await h.click(sendBtn()); // pressed again while pending
    expect(posts()).toHaveLength(1);
    const sent = posts()[0];
    release(saved(3)(sent[2]) as Response);
    await h.flush();
    expect(
      h.host
        .querySelector('[data-testid="chat-message"]')
        ?.getAttribute("data-state"),
    ).toBe("sent");
    expect(items()).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it("a failed message stays failed through two failed retries, with ONE clientId, then sends", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      ...empty,
      [POST]: (body) => {
        if (n++ < 3) return offline();
        return saved(4)(body);
      },
    });
    await mount(l);
    await typeAndSend("third time lucky");
    const failed = () => h.q("chat-failed")!;
    expect(failed()).not.toBeNull();
    await h.click(h.button("Retry sending"));
    expect(items()).toHaveLength(1);
    expect(document.activeElement).toBe(failed()); // failed again: focus on the bubble
    await h.click(h.button("Retry sending"));
    expect(items()).toHaveLength(1);
    expect(document.activeElement).toBe(failed());
    await h.click(h.button("Retry sending"));
    expect(h.q("chat-failed")).toBeNull();
    expect(items()).toHaveLength(1);
    expect(document.activeElement).toBe(box());
    const ids = posts().map(clientIdOf);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
    expect(
      posts().every(
        (c) => (c[2] as { body: string }).body === "third time lucky",
      ),
    ).toBe(true);
  });

  it("Remove drops the bubble, sends nothing, and a new message gets a NEW clientId", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      ...empty,
      [POST]: (body) => (n++ === 0 ? offline() : saved(5)(body)),
    });
    await mount(l);
    await typeAndSend("first");
    await h.click(h.button("Remove message"));
    expect(items()).toHaveLength(0);
    expect(posts()).toHaveLength(1);
    expect(document.activeElement).toBe(box());
    await typeAndSend("second");
    expect(posts()).toHaveLength(2);
    expect(clientIdOf(posts()[1])).not.toBe(clientIdOf(posts()[0]));
  });

  it("a 429 on RETRY keeps the bubble, names the wait and returns focus to the bubble", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      ...empty,
      [POST]: () =>
        n++ === 0
          ? offline()
          : (apiError(429, "RATE_LIMITED", "Too many.", {
              retryAfterSeconds: 45,
            })({}) as Response),
    });
    await mount(l);
    await typeAndSend("hi");
    await h.click(h.button("Retry sending"));
    expect(items()).toHaveLength(1);
    expect(h.q("chat-failed")?.textContent).toContain("45 seconds");
    expect(h.button("Retry sending")).not.toBeNull();
    expect(document.activeElement).toBe(h.q("chat-failed"));
    expect(clientIdOf(posts()[1])).toBe(clientIdOf(posts()[0]));
  });

  it("a 409 message_id_reused offers Remove only and no Retry", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...empty,
      [POST]: apiError(409, "INVALID_STATE", "reused", {
        reason: "message_id_reused",
      }),
    });
    await mount(l);
    await typeAndSend("x");
    expect(h.q("chat-failed")?.textContent).toContain("Not sent");
    expect(h.button("Retry sending")).toBeNull();
    expect(h.button("Remove message")).not.toBeNull();
  });

  it("a 409 chat_hidden on RETRY (nothing saved) makes the whole chat disappear", async () => {
    const l = fakeLive();
    let hidden = false;
    routes(h.fetchMock, {
      [GET1]: () =>
        hidden
          ? (apiError(409, "INVALID_STATE", "closed", {
              reason: "chat_hidden",
            })({}) as Response)
          : (json(200, { items: [], nextCursor: null })({}) as Response),
      [POST]: () => {
        if (!hidden && posts().length === 1) return offline();
        hidden = true;
        return apiError(409, "INVALID_STATE", "closed", {
          reason: "chat_hidden",
        })({}) as Response;
      },
    });
    await mount(l);
    await typeAndSend("late");
    await h.click(h.button("Retry sending"));
    expect(h.q("chat")).toBeNull();
    expect(l.f.closed).toBe(1);
  });

  it("a 409 frozen on retry, saved message found by clientId, shows it as sent and the chat stays writable", async () => {
    const l = fakeLive();
    let sentId = "";
    let n = 0;
    routes(h.fetchMock, {
      [GET1]: () => {
        const list = sentId
          ? [
              view(8, {
                mine: true,
                senderId: "me",
                clientId: sentId,
                body: "kept",
              }),
            ]
          : [];
        return json(200, { items: list, nextCursor: null })({}) as Response;
      },
      [POST]: (body) => {
        sentId = (body as { clientId: string }).clientId;
        return n++ === 0
          ? offline()
          : (apiError(409, "INVALID_STATE", "frozen", {
              reason: "frozen",
            })({}) as Response);
      },
    });
    await mount(l);
    await typeAndSend("kept");
    await h.click(h.button("Retry sending"));
    expect(items()).toHaveLength(1);
    expect(h.q("chat-failed")).toBeNull();
    expect(h.host.querySelector('[data-state="sent"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe("refusal text", () => {
  it("shows the server's contact-guard text as plain text and never puts the typed number in the error", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...empty,
      [POST]: apiError(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        'Do not put phone numbers <img src=x onerror="window.__pwn=1"> in a message.',
      ),
    });
    await mount(l, {
      status: "requested",
      expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    await typeAndSend("call 416 555 0199 or me@example.com");
    const err = h.q("chat-error")!;
    expect(err.querySelector("img")).toBeNull(); // rendered as text, not markup
    expect(err.textContent).toContain("Do not put phone numbers");
    expect(err.textContent).not.toContain("416");
    expect(err.textContent).not.toContain("me@example.com");
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    expect(err.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(err);
    // The refused text is not shown as a bubble and was sent once.
    expect(items()).toHaveLength(0);
    expect(posts()).toHaveLength(1);
  });

  it("a 422 VALIDATION_FAILED shows fields.body, keeps the text and focuses the error", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...empty,
      [POST]: apiError(422, "VALIDATION_FAILED", "Check the form.", {
        fields: { body: "Remove control or invalid characters." },
      }),
    });
    await mount(l);
    await typeAndSend("bad \u0001 text");
    expect(h.q("chat-error")?.textContent).toBe(
      "Remove control or invalid characters.",
    );
    expect(document.activeElement).toBe(h.q("chat-error"));
    expect(box().value).toBe("bad \u0001 text");
  });

  it("typing again clears the error; an empty or blank message is refused locally", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    await typeAndSend("   ");
    expect(h.q("chat-error")?.textContent).toMatch(/Write a message first/);
    expect(posts()).toHaveLength(0);
    await h.type(box(), "ok");
    expect(h.q("chat-error")?.textContent).toBe("");
  });

  it("exactly 2000 characters is sent; the counter counts trimmed text", async () => {
    const l = fakeLive();
    routes(h.fetchMock, { ...empty, [POST]: saved(6) });
    await mount(l);
    await h.type(box(), `  ${"a".repeat(2000)}  `);
    expect(h.q("chat-count")?.textContent).toContain("2000 of 2000");
    await h.click(sendBtn());
    expect(posts()).toHaveLength(1);
    expect((posts()[0][2] as { body: string }).body).toHaveLength(2000);
  });
});

// ---------------------------------------------------------------------------------------------
describe("live region", () => {
  it("announces only the other party's new messages, not mine from another tab, not a history load", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l);
    const region = () => h.q("chat-live")!.textContent;
    expect(region()).toBe(""); // history is not announced
    l.row(2, { sender_id: "me", client_id: mid(777) }); // my own, sent from another tab
    await h.flush();
    expect(items()).toHaveLength(2);
    expect(region()).toBe("");
    l.row(3);
    await h.flush();
    expect(region()).toBe("New message from Lan: message 3");
  });

  it("is polite, atomic-safe and not a second alert", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    const r = h.q("chat-live")!;
    expect(r.getAttribute("aria-live")).toBe("polite");
    expect(r.getAttribute("role")).toBe("status");
    // Only one live region is polite in the chat; errors are role=alert, nothing is assertive.
    expect(
      h.q("chat")!.querySelectorAll('[aria-live="assertive"]'),
    ).toHaveLength(0);
  });

  it("long messages are cut to 200 characters in the announcement", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    l.row(2, { body: "z".repeat(500) });
    await h.flush();
    const t = h.q("chat-live")!.textContent!;
    expect(t.length).toBeLessThan(260);
    expect(t.endsWith("...")).toBe(true);
  });

  it("two identical messages in a row both reach the screen reader (the region text must change)", async () => {
    // A screen reader announces a live region when its text changes. If the second message has the
    // same text as the first, the string is the same, React writes nothing, and nothing is read.
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    const region = h.q("chat-live")!;
    let mutations = 0;
    const mo = new MutationObserver((m) => (mutations += m.length));
    mo.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    l.row(2, { body: "ok" });
    await h.flush();
    l.row(3, { body: "ok" });
    await h.flush();
    await Promise.resolve();
    mutations += mo.takeRecords().length;
    mo.disconnect();
    expect(items()).toHaveLength(2);
    expect(mutations).toBeGreaterThanOrEqual(2);
  });
});

describe("realtime, with the fake channel", () => {
  // ---------------------------------------------------------------------------------------------
  it("unmounting before the connection is ready still closes the channel", async () => {
    const l = fakeLive();
    l.f.slow = true;
    routes(h.fetchMock, empty);
    await mount(l);
    expect(l.f.connects).toBe(1);
    h.cleanup();
    l.f.release!();
    await new Promise((r) => setTimeout(r, 0));
    expect(l.f.closed).toBe(1);
    h = harness();
  });

  it("opening another booking closes the first channel and connects the second", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    expect(l.f.connects).toBe(1);
    const other = "00000000-0000-4000-8000-000000000b02";
    routes(h.fetchMock, {
      ...empty,
      [`GET /api/bookings/${other}/messages?limit=50`]: json(200, {
        items: [],
        nextCursor: null,
      }),
    });
    await mount(l, { bookingId: other });
    expect(l.f.closed).toBe(1);
    expect(l.f.connects).toBe(2);
  });

  it("a row of another booking is ignored", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    l.row(2, { booking_id: "00000000-0000-4000-8000-0000000000ff" });
    await h.flush();
    expect(items()).toHaveLength(0);
    expect(h.q("chat-live")!.textContent).toBe("");
  });

  it("a row that arrives before the history, and again inside it, is shown once", async () => {
    const l = fakeLive();
    let release!: () => void;
    routes(h.fetchMock, {
      [GET1]: () =>
        new Promise<Response>((res) => {
          release = () =>
            res(
              new Response(
                JSON.stringify({ items: [view(1), view(2)], nextCursor: null }),
                { status: 200 },
              ),
            );
        }) as unknown as Response,
    });
    await mount(l);
    l.row(2);
    release();
    await h.flush();
    expect(items()).toHaveLength(2);
  });

  it("keeps what is on screen when the reload after a reconnect fails", async () => {
    const l = fakeLive();
    let fail = false;
    routes(h.fetchMock, {
      [GET1]: () =>
        fail
          ? (apiError(500, "INTERNAL", "x")({}) as Response)
          : (json(200, { items: [view(1)], nextCursor: null })({}) as Response),
    });
    await mount(l);
    l.f.handlers!.onStatus("down");
    fail = true;
    l.f.handlers!.onStatus("live");
    await h.flush();
    expect(items()).toHaveLength(1);
  });

  it("the reload after a reconnect that finds the chat hidden removes it and the channel", async () => {
    const l = fakeLive();
    let hidden = false;
    routes(h.fetchMock, {
      [GET1]: () =>
        hidden
          ? (apiError(409, "INVALID_STATE", "closed", {
              reason: "chat_hidden",
            })({}) as Response)
          : (json(200, { items: [view(1)], nextCursor: null })({}) as Response),
    });
    await mount(l);
    l.f.handlers!.onStatus("down");
    hidden = true;
    l.f.handlers!.onStatus("live");
    await h.flush();
    expect(h.q("chat")).toBeNull();
    expect(l.f.closed).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("MOCK mode and the Supabase client", () => {
  it("MOCK mode with the default connect never creates a Supabase client", async () => {
    routes(h.fetchMock, empty);
    await h.mount(
      <ChatSection
        bookingId={BID}
        status="accepted"
        frozen={false}
        expiresAt={null}
        otherName="Lan"
        mock
      />,
    );
    expect(h.q("chat-mock")?.textContent).toMatch(/MOCK/);
    expect(supabaseSpy.created).toBe(0);
  });

  it("the MOCK note is absent outside MOCK mode", async () => {
    const l = fakeLive();
    routes(h.fetchMock, empty);
    await mount(l);
    expect(h.q("chat-mock")).toBeNull();
  });

  it("no module in src/lib/chat or src/components/chat imports the Supabase client statically", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    for (const f of [
      "src/lib/chat/realtime.ts",
      "src/lib/chat/state.ts",
      "src/components/chat/useChat.ts",
      "src/components/chat/ChatSection.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(
        /from\s+["']@\/lib\/supabase\/(client|server)["']/,
      );
      expect(src, f).not.toMatch(/SECRET|service_role|SERVICE_ROLE/);
    }
    // The only reference is the lazy import inside realtime.ts.
    expect(read("src/lib/chat/realtime.ts")).toMatch(
      /await import\("@\/lib\/supabase\/client"\)/,
    );
  });
});

describe("testkit (changed by the builder)", () => {
  it("an unrouted GET .../messages answers an empty page, as the testkit comment says", async () => {
    // apiFetch always passes method "GET", but the fallback in routes() tests `!init?.method`, so
    // the branch is never taken and the chat shows "did not load" on a page test that does not
    // route messages. Harmless today (those tests do not look at the chat); the comment is wrong.
    routes(h.fetchMock, {});
    const { apiFetch } = await import("@/lib/api/client");
    const page = await apiFetch<{ items: unknown[]; nextCursor: null }>(
      `${PATH}?limit=50`,
    );
    expect(page.items).toEqual([]);
  });
});
