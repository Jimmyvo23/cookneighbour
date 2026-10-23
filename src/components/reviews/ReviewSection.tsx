"use client";
// Reviews on a booking page (T-049, contract 7D). Customer and chef pages both use it.
//
// Rules (Jimmy, 2026-10-20): only after the booking is completed, until 14 days after completion;
// 1 to 5 stars; an optional comment up to 1000 characters; final once posted (said before sending).
// A chef's review of a customer is read only by that customer and an admin: it never appears on
// the public chef page, and this section says so to the chef. Both parties see both reviews of
// their booking.
//
// Focus has ONE owner, this section. After a refused or failed send, focus goes to the first
// invalid field, else to the error message. After a successful post it goes to the confirmation.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch, isMockEnabled } from "@/lib/api/client";
import { MockBadge } from "@/components/MockBadge";
import { buttonCls, cardCls, hintCls } from "@/components/chef/parts";
import {
  dangerBoxCls,
  errCls,
  infoBoxCls,
  inputCls,
} from "@/components/booking/parts";
import { NOTICE_BOX_CLS } from "@/components/booking/useAnnounce";
import { Star, Stars } from "@/components/reviews/Stars";
import { formatWhen } from "@/lib/booking/form";
import {
  COMMENT_MAX,
  REVIEW_FINAL_TEXT,
  REVIEW_WINDOW_DAYS,
  allowanceText,
  formatDate,
  parseReviewForm,
  reviewErrorText,
  type Fields,
} from "@/lib/engagement/rules";
import type { BookingReviews, ReviewView } from "@/lib/api/types";

type View =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: BookingReviews };

export interface ReviewSectionProps {
  bookingId: string;
  viewer: "customer" | "chef";
  /** The other person's name as the booking page already shows it. */
  otherName: string;
  mock?: boolean;
  /**
   * The booking is not completed any more (an admin moved it, Jimmy 2026-10-20): show the reviews
   * already written, read only, and show nothing at all when there are none.
   */
  readOnly?: boolean;
}

export function ReviewSection({
  bookingId,
  viewer,
  otherName,
  mock = isMockEnabled(),
  readOnly = false,
}: ReviewSectionProps) {
  const hid = useId();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [posted, setPosted] = useState(0);
  const seq = useRef(0);
  // Answers that arrive after the page left (or a newer load) are ignored.
  const cancelRequests = useCallback(() => {
    seq.current++;
  }, []);
  const refusalRef = useRef<HTMLDivElement>(null);
  const postedRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) setView({ kind: "loading" });
      try {
        const data = await apiFetch<BookingReviews>(
          `/api/bookings/${encodeURIComponent(bookingId)}/reviews`,
        );
        if (!data?.allowance) throw new Error("bad shape");
        if (mine === seq.current) setView({ kind: "ready", data });
      } catch {
        if (mine === seq.current && !quiet) setView({ kind: "error" });
      }
    },
    [bookingId],
  );
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
    return cancelRequests;
  }, [load, cancelRequests]);

  useEffect(() => {
    if (refusal) refusalRef.current?.focus();
  }, [refusal]);
  useEffect(() => {
    if (posted) postedRef.current?.focus();
  }, [posted]);

  function onPosted(review: ReviewView) {
    seq.current++;
    setRefusal(null);
    setView((v) =>
      v.kind === "ready"
        ? {
            kind: "ready",
            data: {
              ...v.data,
              mine: review,
              allowance: {
                allowed: false,
                reason: "already_reviewed",
                closesAt: v.data.allowance.closesAt,
              },
            },
          }
        : v,
    );
    setPosted((n) => n + 1);
  }

  function onRefused(message: string) {
    setRefusal(message);
    void load(true); // the answer was about the review state: read it again, keep the page still
  }

  // Read only: nothing is shown while loading, on a load error, or when no review exists.
  if (
    readOnly &&
    !(view.kind === "ready" && (view.data.mine || view.data.other))
  )
    return null;

  return (
    <section
      aria-labelledby={`${hid}-h`}
      data-testid="reviews"
      className={cardCls}
    >
      <h2 id={`${hid}-h`} className="text-lg font-semibold">
        Reviews
      </h2>
      {mock && (
        <p data-testid="reviews-mock" className={hintCls}>
          <MockBadge>MOCK</MockBadge> Reviews here are simulated. They stay in
          this browser tab only.
        </p>
      )}
      {posted > 0 && (
        <p
          key={posted}
          ref={postedRef}
          tabIndex={-1}
          role="status"
          data-testid="review-posted"
          className={NOTICE_BOX_CLS}
        >
          Your review was posted. It is final.
        </p>
      )}
      <div
        ref={refusalRef}
        tabIndex={-1}
        role={refusal ? "alert" : undefined}
        data-testid="review-refusal"
        className={refusal ? dangerBoxCls : "sr-only"}
      >
        {refusal}
      </div>

      {view.kind === "loading" && <p role="status">Loading reviews...</p>}
      {view.kind === "error" && (
        <div data-testid="reviews-load-error" className="flex flex-col gap-3">
          <p role="status" className={dangerBoxCls}>
            The reviews did not load. Check your connection and try again.
          </p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className="btn-secondary"
            >
              Try loading the reviews again
            </button>
          </p>
        </div>
      )}
      {view.kind === "ready" && (
        <Ready
          data={view.data}
          viewer={viewer}
          otherName={otherName}
          readOnly={readOnly}
          onPosted={onPosted}
          onRefused={onRefused}
        />
      )}
    </section>
  );
}

function ReviewCard({
  review,
  title,
  note,
  testId,
}: {
  review: ReviewView;
  title: string;
  note: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-xl border-2 border-line p-3 [overflow-wrap:anywhere] "
    >
      <h3 className="font-semibold">{title}</h3>
      <p>
        <Stars value={review.rating} />
      </p>
      {review.comment && (
        <p className="whitespace-pre-line">{review.comment}</p>
      )}
      <p className={hintCls}>
        Posted{" "}
        <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>.{" "}
        {note}
      </p>
    </div>
  );
}

function Ready({
  data,
  viewer,
  otherName,
  readOnly,
  onPosted,
  onRefused,
}: {
  data: BookingReviews;
  viewer: "customer" | "chef";
  otherName: string;
  readOnly: boolean;
  onPosted: (r: ReviewView) => void;
  onRefused: (message: string) => void;
}) {
  const { allowance, mine, other } = data;
  const why = mine || readOnly ? null : allowanceText(allowance);
  return (
    <>
      {mine && (
        <ReviewCard
          testId="my-review"
          review={mine}
          title="Your review"
          note={
            viewer === "chef"
              ? "Only the customer and an admin can see it."
              : "It is final and shows on the chef's public page with your first name."
          }
        />
      )}
      {other && (
        <ReviewCard
          testId="other-review"
          review={other}
          title={`${otherName}'s review of you`}
          note={
            viewer === "customer"
              ? "Only you and an admin can see it. It is not shown on any public page."
              : "It shows on your public chef page with the customer's first name."
          }
        />
      )}
      {why && (
        <p data-testid="review-why" className={infoBoxCls}>
          {why}
        </p>
      )}
      {allowance.allowed && !readOnly && (
        <ReviewForm
          bookingId={data.bookingId}
          viewer={viewer}
          otherName={otherName}
          closesAt={allowance.closesAt}
          onPosted={onPosted}
          onRefused={onRefused}
        />
      )}
    </>
  );
}

function ReviewForm({
  bookingId,
  viewer,
  otherName,
  closesAt,
  onPosted,
  onRefused,
}: {
  bookingId: string;
  viewer: "customer" | "chef";
  otherName: string;
  closesAt: string | null;
  onPosted: (r: ReviewView) => void;
  onRefused: (message: string) => void;
}) {
  const uid = useId();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const ratingId = `${uid}-rating`;
  const commentId = `${uid}-comment`;
  const countId = `${uid}-count`;
  const finalId = `${uid}-final`;
  const used = comment.trim().length;
  const over = used > COMMENT_MAX;

  useEffect(() => {
    if (!tick) return;
    const bad = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    (bad ?? errRef.current)?.focus();
  }, [tick]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const parsed = parseReviewForm({ rating, comment });
    if (!parsed.ok) {
      setFields(parsed.fields);
      setError("Check the highlighted fields.");
      setTick((t) => t + 1);
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const review = await apiFetch<ReviewView>(
        `/api/bookings/${encodeURIComponent(bookingId)}/reviews`,
        { method: "POST", body: parsed.request },
      );
      onPosted(review);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        onRefused(reviewErrorText(err));
        return;
      }
      setFields(err instanceof ApiClientError ? err.fields : {});
      setError(reviewErrorText(err));
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      data-testid="review-form"
      aria-label={`Write a review of ${otherName}`}
      className="flex flex-col gap-4"
    >
      <h3 className="text-base font-semibold">Write a review of {otherName}</h3>
      {closesAt && (
        <p className={hintCls} data-testid="review-window">
          You can write a review until {formatWhen(closesAt)} (
          {REVIEW_WINDOW_DAYS} days after the booking was completed).
        </p>
      )}
      <p className={hintCls} data-testid="review-visibility">
        {viewer === "customer"
          ? `Your rating, comment, first name and the date will show on ${otherName}'s public chef page. Do not put phone numbers, email addresses or links in the comment.`
          : `Only ${otherName} and an admin can see your review. It is not shown on any public page.`}
      </p>

      <div
        id={`${uid}-err`}
        ref={errRef}
        tabIndex={-1}
        role={error ? "alert" : undefined}
        data-testid="review-error"
        className={error ? dangerBoxCls : "sr-only"}
      >
        {error}
      </div>

      <fieldset
        id={ratingId}
        tabIndex={-1}
        aria-describedby={fields.rating ? `${ratingId}-error` : undefined}
        aria-invalid={fields.rating ? true : undefined}
        className="flex flex-col gap-2"
      >
        <legend className="mb-1 text-sm font-medium">
          Your rating, from 1 to 5 stars
        </legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="relative">
              <input
                type="radio"
                name={`${uid}-rating`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span className="flex min-h-11 min-w-14 items-center justify-center gap-1 rounded-md border-2 border-edge bg-surface px-3 font-semibold peer-checked:border-primary peer-checked:bg-tint peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ">
                {n}
                <Star filled={rating === n} size={16} />
                <span className="sr-only">{n === 1 ? "star" : "stars"}</span>
              </span>
            </label>
          ))}
        </div>
        {fields.rating && (
          <p id={`${ratingId}-error`} className={errCls}>
            {fields.rating}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={commentId} className="text-sm font-medium">
          Comment (optional)
        </label>
        <textarea
          id={commentId}
          data-testid="review-comment"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-invalid={fields.comment ? true : undefined}
          aria-describedby={`${countId}${fields.comment ? ` ${commentId}-error` : ""}`}
          className={`${inputCls} py-2`}
        />
        <p
          id={countId}
          data-testid="review-count"
          className={over ? "error-text" : hintCls}
        >
          {used} of {COMMENT_MAX} characters
          {over ? ` (${used - COMMENT_MAX} too many)` : ""}
        </p>
        {fields.comment && (
          <p id={`${commentId}-error`} className={errCls}>
            {fields.comment}
          </p>
        )}
      </div>

      <p id={finalId} data-testid="review-final" className={infoBoxCls}>
        <span className="font-semibold">Before you post:</span>{" "}
        {REVIEW_FINAL_TEXT}
      </p>
      <p>
        <button
          type="submit"
          aria-disabled={busy}
          aria-describedby={finalId}
          className={buttonCls}
        >
          {busy ? "Posting..." : "Post review"}
        </button>
      </p>
    </form>
  );
}
