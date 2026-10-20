// @vitest-environment jsdom
// T-049: reviews on the booking pages. Routes use the contract 7D shapes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import type { BookingReviews, ReviewView } from "@/lib/engagement/types";
import { ReviewSection } from "./ReviewSection";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const BID = "00000000-0000-4000-8000-000000000b01";
const PATH = `/api/bookings/${BID}/reviews`;
const GET = `GET ${PATH}`;
const POST = `POST ${PATH}`;
const CLOSES = "2026-11-03T15:00:00.000Z";

const allowed: BookingReviews = {
  bookingId: BID,
  allowance: { allowed: true, reason: null, closesAt: CLOSES },
  mine: null,
  other: null,
};
const review = (over: Partial<ReviewView> = {}): ReviewView => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  bookingId: BID,
  authorRole: "customer",
  authorDisplayName: "Sam Customer",
  rating: 4,
  comment: "Lovely food",
  createdAt: "2026-10-21T15:00:00.000Z",
  mine: true,
  ...over,
});

async function mount(
  data: BookingReviews,
  viewer: "customer" | "chef" = "customer",
  extra: Parameters<typeof routes>[1] = {},
) {
  routes(h.fetchMock, { [GET]: json(200, data), ...extra });
  await h.mount(
    <ReviewSection
      bookingId={BID}
      viewer={viewer}
      otherName="Lan"
      mock={false}
    />,
  );
}
const rating = (n: number) =>
  h.host.querySelector<HTMLInputElement>(`input[type="radio"][value="${n}"]`)!;
const comment = () => h.q("review-comment") as HTMLTextAreaElement;
const post = () => h.button("Post review");

describe("ReviewSection: the form", () => {
  it("shows an accessible rating group, the 14-day window and says the review is final before sending", async () => {
    await mount(allowed);
    const group = h.host.querySelector("fieldset")!;
    expect(group.querySelector("legend")!.textContent).toMatch(/1 to 5 stars/);
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(5);
    expect(h.q("review-window")!.textContent).toMatch(/until .*14 days/);
    expect(h.q("review-final")!.textContent).toMatch(
      /final once you post it.*cannot edit or delete.*Report a problem/,
    );
    // The final notice is tied to the button that posts.
    expect(post()!.getAttribute("aria-describedby")).toBe(
      h.q("review-final")!.id,
    );
  });

  it("tells a customer the review is public with the first name, and a chef that it is private", async () => {
    await mount(allowed, "customer");
    expect(h.q("review-visibility")!.textContent).toMatch(
      /first name.*public chef page/,
    );
    h.cleanup();
    h = harness();
    await mount(allowed, "chef");
    expect(h.q("review-visibility")!.textContent).toMatch(
      /Only Lan and an admin.*not shown on any public page/,
    );
  });

  it("posts the rating and the trimmed comment, nothing else, then confirms and takes focus", async () => {
    await mount(allowed, "customer", { [POST]: json(201, review()) });
    await h.click(rating(4));
    await h.type(comment(), "  Lovely food  ");
    await h.click(post());
    expect(callsTo(h.fetchMock, PATH).filter((c) => c[1] === "POST")).toEqual([
      [PATH, "POST", { rating: 4, comment: "Lovely food" }],
    ]);
    expect(h.q("review-form")).toBeNull();
    const note = h.q("review-posted")!;
    expect(note.textContent).toBe("Your review was posted. It is final.");
    expect(document.activeElement).toBe(note);
    expect(h.q("my-review")!.textContent).toMatch(/4 out of 5.*Lovely food/);
  });

  it("leaves the comment out when it is empty", async () => {
    await mount(allowed, "customer", { [POST]: json(201, review()) });
    await h.click(rating(5));
    await h.click(post());
    expect(callsTo(h.fetchMock, PATH).find((c) => c[1] === "POST")![2]).toEqual(
      { rating: 5 },
    );
  });

  it("asks for a rating and moves focus to it, without calling the server", async () => {
    await mount(allowed);
    await h.click(post());
    expect(callsTo(h.fetchMock, PATH).some((c) => c[1] === "POST")).toBe(false);
    const group = h.host.querySelector("fieldset")!;
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(group.textContent).toMatch(/Choose a rating/);
    expect(document.activeElement).toBe(group);
    expect(h.q("review-error")!.getAttribute("role")).toBe("alert");
  });

  it("counts the comment and refuses more than 1000 characters before sending", async () => {
    await mount(allowed);
    await h.click(rating(3));
    await h.type(comment(), "a".repeat(1001));
    expect(h.q("review-count")!.textContent).toMatch(
      /1001 of 1000.*1 too many/,
    );
    await h.click(post());
    expect(callsTo(h.fetchMock, PATH).some((c) => c[1] === "POST")).toBe(false);
    expect(document.activeElement).toBe(comment());
    expect(comment().getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a server field error on the comment and keeps what was typed", async () => {
    await mount(allowed, "customer", {
      [POST]: apiError(
        422,
        "VALIDATION_FAILED",
        "Check the highlighted fields.",
        {
          fields: { comment: "Remove the special characters." },
        },
      ),
    });
    await h.click(rating(3));
    await h.type(comment(), "hello");
    await h.click(post());
    expect(h.host.textContent).toMatch(/Remove the special characters\./);
    expect(comment().value).toBe("hello");
    expect(document.activeElement).toBe(comment());
  });

  it("keeps the form after a network error and says the text came from the server", async () => {
    await mount(allowed, "customer", {
      [POST]: apiError(500, "INTERNAL", "Something went wrong on our side."),
    });
    await h.click(rating(3));
    await h.click(post());
    expect(h.q("review-form")).not.toBeNull();
    expect(h.q("review-error")!.textContent).toBe(
      "Something went wrong on our side.",
    );
    expect(document.activeElement).toBe(h.q("review-error"));
  });

  it("on a 409 it shows the reason, reads the review state again and drops the form", async () => {
    let n = 0;
    await mount(allowed, "customer", {
      [GET]: () => {
        n++;
        return json(
          200,
          n === 1
            ? allowed
            : {
                ...allowed,
                allowance: {
                  allowed: false,
                  reason: "window_closed",
                  closesAt: CLOSES,
                },
              },
        )(null);
      },
      [POST]: apiError(409, "INVALID_STATE", "No.", {
        reason: "window_closed",
      }),
    });
    await h.click(rating(3));
    await h.click(post());
    const refusal = h.q("review-refusal")!;
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent).toMatch(/time to write a review has ended/);
    expect(document.activeElement).toBe(refusal);
    expect(h.q("review-form")).toBeNull();
    expect(h.q("review-why")!.textContent).toMatch(/14 days/);
  });

  it("does not post twice while a post is running", async () => {
    let release: (r: Response) => void = () => {};
    await mount(allowed, "customer", {
      [POST]: () =>
        new Promise<Response>((r) => {
          release = r;
        }) as unknown as Response,
    });
    await h.click(rating(3));
    await h.click(post());
    await h.click(h.button("Posting..."));
    expect(
      callsTo(h.fetchMock, PATH).filter((c) => c[1] === "POST"),
    ).toHaveLength(1);
    release(
      new Response(JSON.stringify(review()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await h.flush();
  });
});

describe("ReviewSection: when there is no form", () => {
  it("explains a closed window and shows no form", async () => {
    await mount({
      ...allowed,
      allowance: { allowed: false, reason: "window_closed", closesAt: CLOSES },
    });
    expect(h.q("review-form")).toBeNull();
    expect(h.q("review-why")!.textContent).toMatch(/ended.*14 days/);
  });

  it("shows my review and says it is final when already reviewed", async () => {
    await mount({
      ...allowed,
      allowance: {
        allowed: false,
        reason: "already_reviewed",
        closesAt: CLOSES,
      },
      mine: review(),
    });
    expect(h.q("review-form")).toBeNull();
    expect(h.q("my-review")!.textContent).toMatch(
      /Your review[\s\S]*Lovely food[\s\S]*final/,
    );
    expect(h.q("review-why")).toBeNull();
    // No edit or delete control exists.
    expect(h.button(/edit|delete|change/i)).toBeNull();
  });

  it("explains a booking that is not completed", async () => {
    await mount({
      ...allowed,
      allowance: { allowed: false, reason: "not_completed", closesAt: null },
    });
    expect(h.q("review-why")!.textContent).toMatch(
      /after the booking is completed/,
    );
  });

  it("shows a customer the chef's review of them as private to them and the admin", async () => {
    await mount(
      {
        ...allowed,
        allowance: {
          allowed: false,
          reason: "already_reviewed",
          closesAt: CLOSES,
        },
        mine: review(),
        other: review({
          id: "00000000-0000-4000-8000-0000000000e2",
          authorRole: "chef",
          authorDisplayName: "Lan Nguyen",
          rating: 5,
          comment: "Easy to cook for",
          mine: false,
        }),
      },
      "customer",
    );
    const other = h.q("other-review")!;
    expect(other.textContent).toMatch(/Lan's review of you/);
    expect(other.textContent).toMatch(/Easy to cook for/);
    expect(other.textContent).toMatch(
      /Only you and an admin can see it.*not shown on any public page/,
    );
  });

  it("tells a chef the customer's review shows on the public page", async () => {
    await mount(
      {
        ...allowed,
        allowance: {
          allowed: false,
          reason: "window_closed",
          closesAt: CLOSES,
        },
        other: review({ mine: false }),
      },
      "chef",
    );
    expect(h.q("other-review")!.textContent).toMatch(
      /public chef page.*first name/,
    );
  });
});

describe("ReviewSection: loading and errors", () => {
  it("shows a retry when the reviews do not load", async () => {
    routes(h.fetchMock, {
      [GET]: apiError(500, "INTERNAL", "x"),
    });
    await h.mount(
      <ReviewSection
        bookingId={BID}
        viewer="customer"
        otherName="Lan"
        mock={false}
      />,
    );
    expect(h.q("reviews-load-error")).not.toBeNull();
    routes(h.fetchMock, { [GET]: json(200, allowed) });
    await h.click(h.button("Try loading the reviews again"));
    expect(h.q("review-form")).not.toBeNull();
  });

  it("labels the mock", async () => {
    routes(h.fetchMock, { [GET]: json(200, allowed) });
    await h.mount(
      <ReviewSection bookingId={BID} viewer="customer" otherName="Lan" mock />,
    );
    expect(h.q("reviews-mock")!.textContent).toMatch(/MOCK/);
  });
});
