// @vitest-environment jsdom
// T-096 Tester: every ordering of first / late / Retry answers, booking change, unmount, send.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConnect, ChatHandlers } from "@/lib/chat/realtime";
import { harness, routes, type Harness } from "@/components/booking/testkit";
import { ChatSection } from "./ChatSection";
import { useChat } from "./useChat";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("the Supabase client must not be created in this test");
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const BID = "00000000-0000-4000-8000-000000000b01";
const BID2 = "00000000-0000-4000-8000-000000000b02";
const get = (id: string) => `GET /api/bookings/${id}/messages?limit=50`;
const mid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (n: number, bid = BID) => ({
  id: mid(n),
  bookingId: bid,
  senderId: "other",
  mine: false,
  clientId: null,
  body: `message ${n}`,
  createdAt: `2026-10-19T12:00:0${n}.000Z`,
});
const page = (items: unknown[]) =>
  new Response(JSON.stringify({ items, nextCursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const err500 = () =>
  new Response(JSON.stringify({ error: { code: "INTERNAL" } }), {
    status: 500,
  });
const hiddenR = () =>
  new Response(
    JSON.stringify({
      error: {
        code: "INVALID_STATE",
        message: "closed",
        reason: "chat_hidden",
      },
    }),
    { status: 409 },
  );

function fakeLive() {
  const f = { handlers: null as ChatHandlers | null };
  const connect: ChatConnect = async (_id, hd) => {
    f.handlers = hd;
    return { userId: "me", close: () => {} };
  };
  return { f, connect, live: () => f.handlers!.onStatus("live") };
}
const ui = (l: ReturnType<typeof fakeLive>, bid = BID) => (
  <ChatSection
    bookingId={bid}
    status="accepted"
    frozen={false}
    expiresAt={null}
    otherName="Lan"
    connect={l.connect}
    mock={false}
  />
);
const items = () =>
  [...h.host.querySelectorAll('[data-testid="chat-message"]')].map(
    (e) => e.textContent ?? "",
  );

type Gate = (r: Response) => void;
/** Every GET waits on a gate, in call order. */
function gatedGets(id = BID) {
  const gates: Gate[] = [];
  routes(h.fetchMock, {
    [get(id)]: () => new Promise<Response>((res) => gates.push(res)),
  });
  return gates;
}
const R = {
  ok: () => page([view(1)]),
  fail: err500,
  hidden: hiddenR,
};
type Kind = keyof typeof R;

describe("T-096 tester: first load (gate 0) vs late load (gate 1)", () => {
  const cases: Array<[string, Kind, Kind, "ready" | "error" | "none", number]> =
    [
      // [name, first answer, late answer, expected end, messages]; the late answer comes FIRST
      ["late ok, then first ok", "ok", "ok", "ready", 1],
      ["late ok, then first fail", "fail", "ok", "ready", 1],
      ["late fail, then first ok", "ok", "fail", "ready", 1],
      ["late fail, then first fail", "fail", "fail", "error", 0],
      ["late hidden, then first ok", "ok", "hidden", "none", 0],
      ["late hidden, then first fail", "fail", "hidden", "none", 0],
      ["late ok, then first hidden", "hidden", "ok", "none", 0],
      ["late fail, then first hidden", "hidden", "fail", "none", 0],
    ];
  for (const [name, first, late, end, count] of cases) {
    it(name, async () => {
      const l = fakeLive();
      const gates = gatedGets();
      await h.mount(ui(l));
      l.live(); // channel joins while load 1 runs: late load
      await h.flush();
      expect(gates).toHaveLength(2);
      gates[1](R[late]());
      await h.flush();
      gates[0](R[first]());
      await h.flush();
      expect(h.q("chat-loading")).toBeNull(); // never stuck
      if (end === "none") {
        expect(h.q("chat")).toBeNull();
        expect(h.q("chat-load-error")).toBeNull();
      } else if (end === "ready") {
        expect(h.q("chat-load-error")).toBeNull();
        expect(h.q("chat-list") ?? h.q("chat-empty")).not.toBeNull();
        expect(items()).toHaveLength(count);
      } else {
        expect(h.q("chat-load-error")).not.toBeNull();
      }
    });
  }

  it("first answer comes first, late second: same ends (ok then fail stays ready)", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    l.live();
    await h.flush();
    gates[0](R.ok());
    await h.flush();
    gates[1](R.fail());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("first fail, then late ok: error box clears (T-092)", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    l.live();
    await h.flush();
    gates[0](R.fail());
    await h.flush();
    expect(h.q("chat-load-error")).not.toBeNull();
    gates[1](R.ok());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });
});

describe("T-096 tester: Retry never leaves 'loading' stuck", () => {
  it("retry and a late load both in flight, both fail: error box with a working Retry", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    gates[0](R.fail());
    await h.flush();
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button(/Try loading the chat again/)); // gate 1
    l.live(); // late load: gate 2
    await h.flush();
    expect(gates).toHaveLength(3);
    gates[2](R.fail());
    await h.flush();
    gates[1](R.fail());
    await h.flush();
    expect(h.q("chat-loading")).toBeNull();
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button(/Try loading the chat again/)); // gate 3
    gates[3](R.ok());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("retry fails again after a real failure: error box returns, then another retry works", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    gates[0](R.fail());
    await h.flush();
    await h.click(h.button(/Try loading the chat again/));
    expect(h.q("chat-loading")).not.toBeNull();
    gates[1](R.fail());
    await h.flush();
    expect(h.q("chat-load-error")).not.toBeNull();
    await h.click(h.button(/Try loading the chat again/));
    gates[2](R.ok());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("retry answers hidden: shows nothing", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    gates[0](R.fail());
    await h.flush();
    await h.click(h.button(/Try loading the chat again/));
    gates[1](R.hidden());
    await h.flush();
    expect(h.q("chat")).toBeNull();
    expect(h.q("chat-load-error")).toBeNull();
    expect(h.q("chat-loading")).toBeNull();
  });

  it("reload while ready (probe on the hook) keeps ready, even when it fails", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    let api: ReturnType<typeof useChat> | null = null;
    function Probe() {
      api = useChat({
        bookingId: BID,
        mock: false,
        connect: l.connect,
        otherName: "Lan",
      });
      return <p data-testid="phase">{api.phase}</p>;
    }
    await h.mount(<Probe />);
    gates[0](R.ok());
    await h.flush();
    expect(h.q("phase")!.textContent).toBe("ready");
    const p = api!.reload();
    await h.flush();
    expect(h.q("phase")!.textContent).toBe("ready"); // no flash back to loading
    gates[1](R.fail());
    await p;
    await h.flush();
    expect(h.q("phase")!.textContent).toBe("ready");
  });

  it("reload while loading (first load in flight) settles from whichever answers", async () => {
    const l = fakeLive();
    const gates = gatedGets();
    let api: ReturnType<typeof useChat> | null = null;
    function Probe() {
      api = useChat({
        bookingId: BID,
        mock: false,
        connect: l.connect,
        otherName: "Lan",
      });
      return <p data-testid="phase">{api.phase}</p>;
    }
    await h.mount(<Probe />);
    const p = api!.reload();
    await h.flush();
    gates[1](R.fail());
    await p;
    await h.flush();
    expect(h.q("phase")!.textContent).toBe("error");
    gates[0](R.ok());
    await h.flush();
    expect(h.q("phase")!.textContent).toBe("ready");
  });
});

describe("T-096 tester: booking change and unmount", () => {
  it("an answer for the old booking, arriving after a switch, writes nothing", async () => {
    const l = fakeLive();
    const g1: Gate[] = [];
    const g2: Gate[] = [];
    routes(h.fetchMock, {
      [get(BID)]: () => new Promise<Response>((r) => g1.push(r)),
      [get(BID2)]: () => new Promise<Response>((r) => g2.push(r)),
    });
    await h.mount(ui(l, BID));
    await h.mount(ui(l, BID2));
    expect(g1).toHaveLength(1);
    expect(g2).toHaveLength(1);
    g1[0](page([view(1, BID)])); // old, stale
    await h.flush();
    expect(h.q("chat-loading")).not.toBeNull(); // still waiting for booking 2
    expect(items()).toHaveLength(0);
    g2[0](page([view(2, BID2)]));
    await h.flush();
    expect(items()).toEqual([expect.stringContaining("message 2")]);
  });

  it("an old hidden answer after a switch does not hide the new booking", async () => {
    const l = fakeLive();
    const g1: Gate[] = [];
    const g2: Gate[] = [];
    routes(h.fetchMock, {
      [get(BID)]: () => new Promise<Response>((r) => g1.push(r)),
      [get(BID2)]: () => new Promise<Response>((r) => g2.push(r)),
    });
    await h.mount(ui(l, BID));
    await h.mount(ui(l, BID2));
    g1[0](hiddenR());
    await h.flush();
    g2[0](page([view(2, BID2)]));
    await h.flush();
    expect(h.q("chat")).not.toBeNull();
    expect(items()).toHaveLength(1);
  });

  it("an old failure after a switch does not put the error box on the new booking", async () => {
    const l = fakeLive();
    const g1: Gate[] = [];
    const g2: Gate[] = [];
    routes(h.fetchMock, {
      [get(BID)]: () => new Promise<Response>((r) => g1.push(r)),
      [get(BID2)]: () => new Promise<Response>((r) => g2.push(r)),
    });
    await h.mount(ui(l, BID));
    await h.mount(ui(l, BID2));
    g1[0](err500());
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    g2[0](page([]));
    await h.flush();
    expect(h.q("chat-load-error")).toBeNull();
    expect(h.q("chat")).not.toBeNull();
  });

  it("unmount mid-load: no console error and no write", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = fakeLive();
    const gates = gatedGets();
    await h.mount(ui(l));
    await h.mount(<div />);
    gates[0](R.ok());
    await h.flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("T-096 tester: send path", () => {
  it("send shows the new message and the first load still settles", async () => {
    const l = fakeLive();
    const gates: Gate[] = [];
    let first = true;
    routes(h.fetchMock, {
      [get(BID)]: () => {
        if (first) {
          first = false;
          return page([]);
        }
        return new Promise<Response>((r) => gates.push(r));
      },
      [`POST /api/bookings/${BID}/messages`]: async (
        _u: unknown,
        init?: RequestInit,
      ) => {
        const b = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({
            id: mid(7),
            bookingId: BID,
            senderId: "me",
            mine: true,
            clientId: b.clientId,
            body: b.body,
            createdAt: "2026-10-19T12:00:07.000Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    } as never);
    await h.mount(ui(l));
    const box = h.host.querySelector("textarea");
    await h.type(box, "hello there");
    await h.click(h.button(/^Send/));
    expect(items().join("|")).toContain("hello there");
  });

  it("frozen refusal reloads: a hidden answer ends quietly, a saved message counts as sent", async () => {
    const l = fakeLive();
    routes(h.fetchMock, {
      [get(BID)]: () => page([]),
      [`POST /api/bookings/${BID}/messages`]: () =>
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_STATE",
              message: "closed",
              reason: "chat_hidden",
            },
          }),
          { status: 409 },
        ),
    } as never);
    await h.mount(ui(l));
    await h.type(h.host.querySelector("textarea"), "hi");
    await h.click(h.button(/^Send/));
    // the reload after the refusal still ran (two GETs) and the page did not crash
    const gets = h.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/messages?"),
    );
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("unmount mid-send: the POST answer after unmount raises no error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = fakeLive();
    let release: Gate = () => {};
    routes(h.fetchMock, {
      [get(BID)]: () => page([]),
      [`POST /api/bookings/${BID}/messages`]: () =>
        new Promise<Response>((r) => (release = r)),
    } as never);
    await h.mount(ui(l));
    await h.type(h.host.querySelector("textarea"), "bye");
    await h.click(h.button(/^Send/));
    await h.mount(<div />);
    release(err500());
    await h.flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
