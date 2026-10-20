// @vitest-environment jsdom
// T-049: "Report a problem" on the booking pages (contract 7D).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import type { ReportView } from "@/lib/api/types";
import { ReportSection } from "./ReportSection";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const BID = "00000000-0000-4000-8000-000000000b01";
const PATH = `/api/bookings/${BID}/reports`;
const GET = `GET ${PATH}`;
const POST = `POST ${PATH}`;
const UUID_LOWER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const report = (over: Partial<ReportView> = {}): ReportView => ({
  id: "00000000-0000-4000-8000-0000000000f1",
  bookingId: BID,
  category: "food_quality",
  description: "The soup was cold",
  status: "open",
  createdAt: "2026-10-21T15:00:00.000Z",
  resolvedAt: null,
  ...over,
});

async function mount(
  items: ReportView[],
  extra: Parameters<typeof routes>[1] = {},
) {
  routes(h.fetchMock, { [GET]: json(200, { items }), ...extra });
  await h.mount(<ReportSection bookingId={BID} mock={false} />);
}
const select = () => h.host.querySelector("select")!;
const desc = () => h.q("report-description") as HTMLTextAreaElement;
async function setCategory(value: string) {
  const el = select();
  const { act } = await import("react");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ReportSection", () => {
  it("offers the button on a booking with no report and says who can read a report", async () => {
    await mount([]);
    expect(h.q("report-button")).not.toBeNull();
    expect(h.q("report-form")).toBeNull();
    expect(h.host.textContent).toMatch(
      /Only you and an admin can read your report\. The other person cannot see it\./,
    );
  });

  it("opens the form with focus on its heading", async () => {
    await mount([]);
    await h.click(h.q("report-button"));
    const heading = h.q("report-form")!.querySelector("h3")!;
    expect(document.activeElement).toBe(heading);
  });

  it("asks for a category and a description, and focuses the first problem", async () => {
    await mount([]);
    await h.click(h.q("report-button"));
    await h.click(h.button("Send report"));
    expect(callsTo(h.fetchMock, PATH).some((c) => c[1] === "POST")).toBe(false);
    expect(select().getAttribute("aria-invalid")).toBe("true");
    expect(desc().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(select());
    await setCategory("safety");
    await h.click(h.button("Send report"));
    expect(document.activeElement).toBe(desc());
  });

  it("sends a lower-case client id, the category and the trimmed text, then shows the open status", async () => {
    await mount([], { [POST]: json(201, report({ category: "safety" })) });
    await h.click(h.q("report-button"));
    await setCategory("safety");
    await h.type(desc(), "  The kitchen was dirty ");
    await h.click(h.button("Send report"));
    const [, , body] = callsTo(h.fetchMock, PATH).find((c) => c[1] === "POST")!;
    expect(body).toMatchObject({
      category: "safety",
      description: "The kitchen was dirty",
    });
    expect((body as { clientId: string }).clientId).toMatch(UUID_LOWER);
    expect(h.q("report-form")).toBeNull();
    expect(h.q("report-button")).toBeNull();
    const sent = h.q("report-sent")!;
    expect(sent.textContent).toMatch(/Your report was sent/);
    expect(document.activeElement).toBe(sent);
    expect(h.q("report-status")!.textContent).toMatch(
      /Open: waiting for an admin/,
    );
  });

  it("sends the SAME client id again when a failed send is retried", async () => {
    let n = 0;
    await mount([], {
      [POST]: () => {
        n++;
        return n === 1
          ? apiError(500, "INTERNAL", "Something went wrong on our side.")(null)
          : json(201, report())(null);
      },
    });
    await h.click(h.q("report-button"));
    await setCategory("other");
    await h.type(desc(), "It went wrong");
    await h.click(h.button("Send report"));
    expect(document.activeElement).toBe(h.q("report-error"));
    expect(h.q("report-form")).not.toBeNull();
    await h.click(h.button("Send report"));
    const ids = callsTo(h.fetchMock, PATH)
      .filter((c) => c[1] === "POST")
      .map((c) => (c[2] as { clientId: string }).clientId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("shows the status instead of the form while a report is open", async () => {
    await mount([report()]);
    expect(h.q("report-open")).not.toBeNull();
    expect(h.q("report-button")).toBeNull();
    expect(h.q("report-form")).toBeNull();
    expect(h.q("report-open")!.textContent).toMatch(/The soup was cold/);
    expect(h.q("report-open")!.textContent).toMatch(
      /after an admin has answered/,
    );
  });

  it("shows the status instead of the form while a report is being reviewed", async () => {
    await mount([report({ status: "reviewing" })]);
    expect(h.q("report-status")!.textContent).toMatch(
      /An admin is looking at it/,
    );
    expect(h.q("report-button")).toBeNull();
  });

  it("offers a new report once the earlier one is answered, and lists the earlier ones", async () => {
    await mount([
      report({ status: "resolved", resolvedAt: "2026-10-22T15:00:00.000Z" }),
      report({
        id: "00000000-0000-4000-8000-0000000000f2",
        status: "dismissed",
        resolvedAt: "2026-10-23T15:00:00.000Z",
      }),
    ]);
    expect(h.q("report-button")).not.toBeNull();
    const list = h.q("reports-earlier")!;
    expect(list.textContent).toMatch(/Resolved by an admin/);
    expect(list.textContent).toMatch(/Closed by an admin/);
  });

  it("never shows an admin note, a final status or a decision", async () => {
    // Even if the server sent extra fields, the card prints only what the contract lists.
    const leaky = {
      ...report({ status: "resolved", resolvedAt: "2026-10-22T15:00:00.000Z" }),
      note: "SECRET-NOTE",
      finalStatus: "cancelled",
    };
    await mount([leaky]);
    expect(h.text()).not.toMatch(/SECRET-NOTE|cancelled/);
  });

  it("shows the server's own text when a second report is refused, and then the open report", async () => {
    let n = 0;
    const SERVER =
      "You already have a problem report open for this booking. Wait for an admin to answer it before sending another.";
    await mount([], {
      [GET]: () => {
        n++;
        return json(200, { items: n === 1 ? [] : [report()] })(null);
      },
      [POST]: apiError(409, "INVALID_STATE", SERVER, { reason: "report_open" }),
    });
    await h.click(h.q("report-button"));
    await setCategory("other");
    await h.type(desc(), "Again");
    await h.click(h.button("Send report"));
    const refusal = h.q("report-refusal")!;
    expect(refusal.textContent).toBe(SERVER);
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(refusal);
    expect(h.q("report-open")).not.toBeNull();
    expect(h.q("report-form")).toBeNull();
  });

  it("counts the description and refuses more than 2000 characters", async () => {
    await mount([]);
    await h.click(h.q("report-button"));
    await setCategory("other");
    await h.type(desc(), "a".repeat(2001));
    expect(h.host.textContent).toMatch(
      /2001 of 2000 characters \(1 too many\)/,
    );
    await h.click(h.button("Send report"));
    expect(callsTo(h.fetchMock, PATH).some((c) => c[1] === "POST")).toBe(false);
  });

  it("closes the form without sending", async () => {
    await mount([]);
    await h.click(h.q("report-button"));
    await h.click(h.button("Close without sending"));
    expect(h.q("report-form")).toBeNull();
    expect(h.q("report-button")).not.toBeNull();
  });

  it("shows a retry when the reports do not load", async () => {
    routes(h.fetchMock, { [GET]: apiError(500, "INTERNAL", "x") });
    await h.mount(<ReportSection bookingId={BID} mock={false} />);
    expect(h.q("reports-load-error")).not.toBeNull();
    routes(h.fetchMock, { [GET]: json(200, { items: [] }) });
    await h.click(h.button("Try loading your reports again"));
    expect(h.q("report-button")).not.toBeNull();
  });

  it("labels the mock", async () => {
    routes(h.fetchMock, { [GET]: json(200, { items: [] }) });
    await h.mount(<ReportSection bookingId={BID} mock />);
    expect(h.q("reports-mock")!.textContent).toMatch(/MOCK/);
  });
});
