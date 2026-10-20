// @vitest-environment jsdom
// T-049: the review list on the public chef page.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiError,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";
import type { PublicReview } from "@/lib/engagement/types";
import { PublicReviews } from "./PublicReviews";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const CHEF = "00000000-0000-4000-8000-000000000c01";
const FIRST = `GET /api/chefs/${CHEF}/reviews?limit=10`;
const MORE = `GET /api/chefs/${CHEF}/reviews?limit=10&cursor=m10`;
const rv = (n: number, over: Partial<PublicReview> = {}): PublicReview => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  authorDisplayName: "Mina",
  rating: 5,
  comment: `Comment ${n}`,
  createdAt: "2026-10-12T15:00:00.000Z",
  ...over,
});

describe("PublicReviews", () => {
  it("shows the name as received, the rating and the date; never an id", async () => {
    routes(h.fetchMock, {
      [FIRST]: json(200, {
        items: [
          {
            ...rv(1, { authorDisplayName: "Mina", rating: 4 }),
            authorId: "SECRET-AUTHOR",
            bookingId: "SECRET-BOOKING",
          },
        ],
        nextCursor: null,
      }),
    });
    await h.mount(<PublicReviews chefId={CHEF} />);
    const card = h.q("public-review")!;
    expect(card.textContent).toMatch(/^Mina/);
    expect(card.textContent).toMatch(/4 out of 5/);
    expect(card.textContent).toMatch(/Oct 12, 2026/);
    expect(card.textContent).toMatch(/Comment 1/);
    expect(h.text()).not.toMatch(/SECRET/);
  });

  it("does not build a longer name: it prints exactly what the server sent", async () => {
    routes(h.fetchMock, {
      [FIRST]: json(200, {
        items: [rv(1, { authorDisplayName: "Mina" })],
        nextCursor: null,
      }),
    });
    await h.mount(<PublicReviews chefId={CHEF} />);
    expect(h.q("public-review")!.querySelector("p")!.textContent).toBe("Mina");
  });

  it("says when there are no reviews", async () => {
    routes(h.fetchMock, {
      [FIRST]: json(200, { items: [], nextCursor: null }),
    });
    await h.mount(<PublicReviews chefId={CHEF} />);
    expect(h.q("reviews-empty")!.textContent).toBe("No reviews yet.");
    expect(h.button(/more/i)).toBeNull();
  });

  it("loads more and moves focus to the first new review", async () => {
    routes(h.fetchMock, {
      [FIRST]: json(200, {
        items: Array.from({ length: 10 }, (_, i) => rv(i + 1)),
        nextCursor: "m10",
      }),
      [MORE]: json(200, {
        items: [rv(11), rv(5)], // a repeated review is not shown twice
        nextCursor: null,
      }),
    });
    await h.mount(<PublicReviews chefId={CHEF} />);
    await h.click(h.button("Show more reviews"));
    const cards = h.qa("public-review");
    expect(cards).toHaveLength(11);
    expect(document.activeElement).toBe(cards[10]);
    expect(h.button("Show more reviews")).toBeNull();
  });

  it("keeps the shown reviews and focuses the message when more do not load", async () => {
    routes(h.fetchMock, {
      [FIRST]: json(200, { items: [rv(1)], nextCursor: "m10" }),
      [MORE]: apiError(500, "INTERNAL", "x"),
    });
    await h.mount(<PublicReviews chefId={CHEF} />);
    await h.click(h.button("Show more reviews"));
    expect(h.qa("public-review")).toHaveLength(1);
    expect(document.activeElement?.getAttribute("role")).toBe("alert");
    expect(document.activeElement?.textContent).toMatch(/did not load/);
  });

  it("shows a retry when the list does not load, and the page still stands", async () => {
    routes(h.fetchMock, { [FIRST]: apiError(500, "INTERNAL", "x") });
    await h.mount(<PublicReviews chefId={CHEF} />);
    expect(h.q("reviews-error")).not.toBeNull();
    routes(h.fetchMock, {
      [FIRST]: json(200, { items: [rv(1)], nextCursor: null }),
    });
    await h.click(h.button("Try loading the reviews again"));
    expect(h.qa("public-review")).toHaveLength(1);
  });
});
