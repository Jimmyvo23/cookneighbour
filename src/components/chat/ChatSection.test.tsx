// @vitest-environment jsdom
// T-047: the booking chat. Realtime is a fake `connect`; the routes are the contract 7C shapes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus, MessageView } from "@/lib/api/types";
import type { ChatConnect, ChatHandlers } from "@/lib/chat/realtime";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import { ChatSection } from "./ChatSection";

let h: Harness;
beforeEach(() => {
  h = harness();
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

function fakeLive() {
  const f = {
    handlers: null as ChatHandlers | null,
    log: [] as string[],
    closed: 0,
    fail: false,
  };
  const connect: ChatConnect = async (_id, hd) => {
    f.log.push("connect");
    if (f.fail) throw new Error("no session");
    f.handlers = hd;
    return { userId: "me", close: () => void f.closed++ };
  };
  return {
    f,
    connect,
    row: (n: number, over: Record<string, unknown> = {}) =>
      f.handlers!.onRow({
        id: mid(n),
        booking_id: BID,
        sender_id: "other",
        client_id: null,
        body: `message ${n}`,
        created_at: `2026-10-19T12:00:0${n}.000Z`,
        ...over,
      }),
  };
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
const live = () => h.q("chat-live")!.textContent;

async function typeAndSend(text: string) {
  await h.type(box(), text);
  await h.click(sendBtn());
}

describe("visibility by status (D-93, D-94)", () => {
  it.each([
    "declined",
    "cancelled",
    "expired",
    "no_show_customer",
    "no_show_chef",
  ] as BookingStatus[])(
    "%s shows no chat and asks for nothing",
    async (status) => {
      const l = fakeLive();
      routes(h.fetchMock, {});
      await mount(l, { status });
      expect(h.q("chat")).toBeNull();
      expect(h.fetchMock).not.toHaveBeenCalled();
      expect(l.f.log).toEqual([]);
    },
  );

  it("hides a request that is past its expiry", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {});
    await mount(l, {
      status: "requested",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(h.q("chat")).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["requested", "accepted", "completed"] as BookingStatus[])(
    "%s is open",
    async (status) => {
      const l = fakeLive();
      routes(h.fetchMock, {
        [GET1]: json(200, { items: [view(1)], nextCursor: null }),
      });
      await mount(l, {
        status,
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      });
      expect(h.q("chat")).not.toBeNull();
      expect(box()).not.toBeNull();
      expect(items()[0]).toContain("message 1");
    },
  );

  it("is read only while frozen, with the neutral note", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l, { frozen: true });
    expect(items()[0]).toContain("message 1");
    expect(h.host.querySelector("textarea")).toBeNull();
    expect(h.q("chat-frozen")?.textContent).toContain("read only");
    expect(h.q("chat-frozen")?.textContent).not.toMatch(
      /flag|report|admin flag/i,
    );
  });

  it("disappears when the server says the chat is hidden", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: apiError(409, "INVALID_STATE", "closed", {
        reason: "chat_hidden",
      }),
    });
    await mount(l);
    expect(h.q("chat")).toBeNull();
    expect(l.f.closed).toBe(1); // the channel is removed too
  });
});

describe("loading", () => {
  it("subscribes first, then walks every page to the end, oldest first", async () => {
    const l = fakeLive();
    const order: string[] = [];
    routes(h.fetchMock, {
      [GET1]: () => {
        order.push(...l.f.log, "get1");
        return new Response(
          JSON.stringify({ items: [view(1), view(2)], nextCursor: "m2" }),
          { status: 200 },
        );
      },
      [`GET ${PATH}?limit=50&cursor=m2`]: () => {
        order.push("get2");
        return new Response(
          JSON.stringify({ items: [view(3)], nextCursor: null }),
          { status: 200 },
        );
      },
    });
    await mount(l);
    expect(order).toEqual(["connect", "get1", "get2"]);
    expect(items().map((t) => t.match(/message \d/)![0])).toEqual([
      "message 1",
      "message 2",
      "message 3",
    ]);
  });

  it("removes the channel when the page is left", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [], nextCursor: null }),
    });
    await mount(l);
    expect(l.f.closed).toBe(0);
    h.cleanup();
    expect(l.f.closed).toBe(1);
    h = harness(); // so afterEach has something to clean
  });

  it("shows a try-again button when the history fails", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      [GET1]: () =>
        n++ === 0
          ? new Response(
              JSON.stringify({ error: { code: "INTERNAL", message: "x" } }),
              { status: 500 },
            )
          : new Response(
              JSON.stringify({ items: [view(1)], nextCursor: null }),
              { status: 200 },
            ),
    });
    await mount(l);
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button("Try loading the chat again"));
    expect(items()[0]).toContain("message 1");
  });

  it("says so when live updates cannot start, and still loads the history", async () => {
    const l = fakeLive();
    l.f.fail = true;
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l);
    expect(items()[0]).toContain("message 1");
    expect(h.q("chat-live-note")?.textContent).toContain("not available");
  });
});

describe("live messages", () => {
  it("shows the other party's message once and announces it politely", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l);
    expect(live()).toBe("");
    l.row(2);
    await h.flush();
    l.row(2); // a repeat of the same row
    await h.flush();
    expect(items()).toHaveLength(2);
    expect(live()).toBe("New message from Lan: message 2");
    expect(h.q("chat-live")?.getAttribute("aria-live")).toBe("polite");
    // The message list itself is not a live region.
    expect(
      h.host
        .querySelector('[aria-label="Messages with Lan"]')
        ?.getAttribute("aria-live"),
    ).toBeNull();
  });

  it("does not show or announce my own send twice when the echo arrives", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [], nextCursor: null }),
      [POST]: (body) => {
        const b = body as { clientId: string; body: string };
        return new Response(
          JSON.stringify(
            view(5, {
              mine: true,
              senderId: "me",
              clientId: b.clientId,
              body: b.body,
            }),
          ),
          { status: 201 },
        );
      },
    });
    await mount(l);
    await typeAndSend("hello there");
    const sent = callsTo(h.fetchMock, PATH).find((c) => c[1] === "POST")!;
    expect(sent[2]).toMatchObject({ body: "hello there" });
    expect((sent[2] as { clientId: string }).clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    l.row(5, {
      sender_id: "me",
      client_id: (sent[2] as { clientId: string }).clientId,
      body: "hello there",
    });
    await h.flush();
    expect(items()).toHaveLength(1);
    expect(live()).toBe("");
    expect(box().value).toBe("");
    expect(document.activeElement).toBe(box());
  });

  it("loads the history again after a dropped connection comes back", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l);
    expect(callsTo(h.fetchMock, "limit=50")).toHaveLength(1);
    l.f.handlers!.onStatus("live"); // first connect: no extra load
    await h.flush();
    expect(callsTo(h.fetchMock, "limit=50")).toHaveLength(1);
    l.f.handlers!.onStatus("down");
    await h.flush();
    expect(h.q("chat-live-note")?.textContent).toContain("paused");
    l.f.handlers!.onStatus("live");
    await h.flush();
    expect(callsTo(h.fetchMock, "limit=50")).toHaveLength(2);
    expect(items()).toHaveLength(1);
  });
});

describe("sending", () => {
  const okGet = { [GET1]: json(200, { items: [], nextCursor: null }) };

  it("shows the contact-guard text from the server, keeps the text and focuses the message", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...okGet,
      [POST]: apiError(
        422,
        "CONTACT_DETAILS_NOT_ALLOWED",
        "Server says: no phone numbers.",
        {
          fields: { body: "short" },
        },
      ),
    });
    await mount(l, {
      status: "requested",
      expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    await typeAndSend("call 416 555 0123");
    const err = h.q("chat-error")!;
    expect(err.textContent).toBe("Server says: no phone numbers.");
    expect(document.activeElement).toBe(err);
    expect(box().value).toBe("call 416 555 0123");
    expect(items()).toHaveLength(0);
    expect(box().getAttribute("aria-invalid")).toBe("true");
  });

  it("words a 429 with the wait time and keeps the text", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...okGet,
      [POST]: apiError(429, "RATE_LIMITED", "Too many attempts.", {
        retryAfterSeconds: 30,
      }),
    });
    await mount(l);
    await typeAndSend("hi");
    expect(h.q("chat-error")?.textContent).toContain("30 seconds");
    expect(box().value).toBe("hi");
    expect(document.activeElement).toBe(h.q("chat-error"));
  });

  it("stops at 2000 characters with a counter and sends nothing", async () => {
    const l = fakeLive();
    routes(h.fetchMock, okGet);
    await mount(l);
    await h.type(box(), "a".repeat(2001));
    expect(h.q("chat-count")?.textContent).toContain("2001 of 2000");
    expect(h.q("chat-count")?.textContent).toContain("1 too many");
    await h.click(sendBtn());
    expect(h.q("chat-error")?.textContent).toMatch(/2001 characters/);
    expect(callsTo(h.fetchMock, PATH).some((c) => c[1] === "POST")).toBe(false);
    await h.type(box(), "a".repeat(2000));
    expect(h.q("chat-count")?.textContent).not.toContain("too many");
  });

  it("shows a failed bubble, focuses it, and retries with the SAME clientId", async () => {
    const l = fakeLive();
    let n = 0;
    routes(h.fetchMock, {
      ...okGet,
      [POST]: (body) => {
        if (n++ === 0) throw new TypeError("offline");
        const b = body as { clientId: string; body: string };
        return new Response(
          JSON.stringify(
            view(7, {
              mine: true,
              senderId: "me",
              clientId: b.clientId,
              body: b.body,
            }),
          ),
          { status: 200 },
        );
      },
    });
    await mount(l);
    await typeAndSend("are you free?");
    const failed = h.q("chat-failed")!;
    expect(failed.textContent).toContain("Not sent");
    expect(document.activeElement).toBe(failed);
    expect(box().value).toBe("");
    await h.click(h.button("Retry sending"));
    const posts = callsTo(h.fetchMock, PATH).filter((c) => c[1] === "POST");
    expect(posts).toHaveLength(2);
    expect((posts[1][2] as { clientId: string }).clientId).toBe(
      (posts[0][2] as { clientId: string }).clientId,
    );
    expect(h.q("chat-failed")).toBeNull();
    expect(items()).toHaveLength(1);
    expect(h.host.querySelector('[data-state="sent"]')).not.toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it("lets a failed message be removed", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...okGet,
      [POST]: () => {
        throw new TypeError("offline");
      },
    });
    await mount(l);
    await typeAndSend("x");
    await h.click(h.button("Remove message"));
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(box());
  });

  it("after a 409 frozen on retry, finds the saved message by clientId instead of saying 'not sent'", async () => {
    const l = fakeLive();
    let sentId = "";
    let getN = 0;
    routes(h.fetchMock, {
      [GET1]: () => {
        getN++;
        const saved =
          getN > 1 && sentId
            ? [
                view(9, {
                  mine: true,
                  senderId: "me",
                  clientId: sentId,
                  body: "saved earlier",
                }),
              ]
            : [];
        return new Response(
          JSON.stringify({ items: saved, nextCursor: null }),
          { status: 200 },
        );
      },
      [POST]: (body) => {
        sentId = (body as { clientId: string }).clientId;
        return new Response(
          JSON.stringify({
            error: {
              code: "INVALID_STATE",
              message: "frozen",
              reason: "frozen",
            },
          }),
          { status: 409 },
        );
      },
    });
    await mount(l);
    await typeAndSend("saved earlier");
    expect(h.q("chat-failed")).toBeNull();
    expect(items()).toHaveLength(1);
    expect(items()[0]).toContain("saved earlier");
    expect(h.host.querySelector('[data-state="sent"]')).not.toBeNull();
  });

  it("after a 409 frozen with nothing saved, says not sent and becomes read only", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      ...okGet,
      [POST]: apiError(409, "INVALID_STATE", "frozen", { reason: "frozen" }),
    });
    await mount(l);
    await typeAndSend("hello");
    expect(h.q("chat-failed")?.textContent).toContain("Not sent");
    expect(h.q("chat-frozen")).not.toBeNull();
    expect(h.host.querySelector("textarea")).toBeNull();
    expect(h.button("Retry sending")).toBeNull();
    expect(h.button("Remove message")).not.toBeNull();
  });

  it("removes the whole chat when a send finds it hidden", async () => {
    const l = fakeLive();
    let hidden = false;
    routes(h.fetchMock, {
      [GET1]: () =>
        hidden
          ? new Response(
              JSON.stringify({
                error: {
                  code: "INVALID_STATE",
                  message: "closed",
                  reason: "chat_hidden",
                },
              }),
              { status: 409 },
            )
          : new Response(JSON.stringify({ items: [], nextCursor: null }), {
              status: 200,
            }),
      [POST]: () => {
        hidden = true;
        return new Response(
          JSON.stringify({
            error: {
              code: "INVALID_STATE",
              message: "closed",
              reason: "chat_hidden",
            },
          }),
          { status: 409 },
        );
      },
    });
    await mount(l);
    await typeAndSend("late");
    expect(h.q("chat")).toBeNull();
  });
});

describe("accessibility structure", () => {
  it("has a labelled section, a labelled message region and a labelled box", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l);
    const sec = h.q("chat")!;
    const heading = sec.querySelector("h2")!;
    expect(sec.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe("Chat with Lan");
    const region = sec.querySelector('[role="region"]')!;
    expect(region.getAttribute("aria-label")).toBe("Messages with Lan");
    expect(region.getAttribute("tabindex")).toBe("0");
    const label = sec.querySelector("label")!;
    expect(label.htmlFor).toBe(box().id);
    expect(label.textContent).toBe("Message to Lan");
  });
});

describe("MOCK mode", () => {
  it("is labelled, has no Realtime, and uses the routes", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [GET1]: json(200, { items: [view(1)], nextCursor: null }),
    });
    await mount(l, { mock: true });
    expect(h.q("chat-mock")?.textContent).toContain("MOCK");
    expect(h.q("chat-mock")?.textContent).toContain("no live updates");
    expect(l.f.log).toEqual([]);
    expect(h.q("chat-live-note")).toBeNull();
  });
});
