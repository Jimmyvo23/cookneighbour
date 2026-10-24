"use client";
// Booking chat (T-047, CLAUDE.md 6.8, contract 7C). Used on the customer and the chef booking page.
//
// What shows, by booking status (D-93, D-94):
//   requested (not expired), accepted, completed -> the chat is open
//   any of those while frozen                    -> the chat is read only, with a neutral note
//   declined, cancelled, expired, no-show        -> nothing at all (no heading, no request)
// MOCK mode (NEXT_PUBLIC_API_MOCK=1) uses the mock adapter: no Realtime, and it says so.
//
// Focus has ONE owner, this panel: after a message is refused, focus goes to the error message
// (above the box for a refused text, on the failed bubble for a message that could not be sent);
// after a retry or a removal it returns to the box.
import { useEffect, useId, useRef, useState } from "react";
import { isMockEnabled } from "@/lib/api/client";
import { formatWhen } from "@/lib/booking/form";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_REFUSALS,
  isChatOpenStatus,
} from "@/lib/domain/messages";
import type { BookingStatus } from "@/lib/api/types";
import type { ChatConnect } from "@/lib/chat/realtime";
import type { ChatItem } from "@/lib/chat/state";
import { MockBadge } from "@/components/MockBadge";
import {
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
} from "@/components/chef/parts";
import { dangerBoxCls, infoBoxCls } from "@/components/booking/parts";
import { useChat } from "./useChat";

export interface ChatSectionProps {
  bookingId: string;
  status: BookingStatus;
  /** An admin flag is open (D-53): read only. */
  frozen: boolean;
  /** ISO. A request past this instant is hidden even if the sweep has not marked it (finding 4a). */
  expiresAt: string | null;
  /** The other party's display name. */
  otherName: string;
  /** Injected in tests. */
  connect?: ChatConnect;
  mock?: boolean;
  /**
   * Called once when an open chat turns out to be closed (D-105), so the page can reload the
   * booking. Focus rule: the closed notice takes focus and KEEPS it; the page's reload is a quiet
   * refetch that moves no focus.
   */
  onClosed?: () => void;
}

/** D-94 plus finding 4a: whether the chat shows at all. */
export function isChatVisible(
  status: BookingStatus,
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!isChatOpenStatus(status)) return false;
  return !(
    status === "requested" &&
    expiresAt !== null &&
    new Date(expiresAt).getTime() <= now.getTime()
  );
}

export const CHAT_CLOSED_TEXT = "The chat for this booking is closed.";

export function ChatSection(props: ChatSectionProps) {
  // D-105: a chat that was open and became hidden is replaced by a one-line notice. It stays even
  // after the page reloads the booking (whose new status would otherwise remove the section).
  const [closedFor, setClosedFor] = useState<string | null>(null);
  if (closedFor === props.bookingId) return <ClosedNotice />;
  if (!isChatVisible(props.status, props.expiresAt)) return null;
  return (
    <ChatPanel
      {...props}
      onClosed={() => {
        setClosedFor(props.bookingId);
        props.onClosed?.();
      }}
    />
  );
}

function ClosedNotice() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      data-testid="chat-closed"
      className={infoBoxCls}
    >
      {CHAT_CLOSED_TEXT}
    </p>
  );
}

function ChatPanel({
  bookingId,
  status,
  frozen,
  otherName,
  connect,
  mock = isMockEnabled(),
  onClosed,
}: ChatSectionProps) {
  const chat = useChat({ bookingId, mock, connect, otherName, onClosed });
  const uid = useId();
  const headingId = `${uid}-h`;
  const boxId = `${uid}-box`;
  const counterId = `${uid}-count`;
  const errId = `${uid}-err`;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One owner of focus: a request says where it should go once the page has rendered.
  const [focusAsk, setFocusAsk] = useState<{
    n: number;
    to: "box" | "error" | string; // a string is a failed bubble's clientId
  } | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const readOnly = frozen || chat.frozenSeen;
  const ask = (to: "box" | "error" | string) =>
    setFocusAsk((p) => ({ n: (p?.n ?? 0) + 1, to }));

  useEffect(() => {
    if (!focusAsk) return;
    if (focusAsk.to === "box") boxRef.current?.focus();
    else if (focusAsk.to === "error") errRef.current?.focus();
    else
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-failed-for="${focusAsk.to}"]`)
        ?.focus();
  }, [focusAsk]);

  // Keep the newest message in view, unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  if (chat.phase === "hidden" || chat.phase === "closed") return null;

  const count = text.trim().length;
  const over = count > MESSAGE_MAX_LENGTH;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    stick.current = true;
    try {
      const r = await chat.send(text);
      if (r.kind === "form-error") {
        setError(r.message);
        ask("error");
      } else {
        setText("");
        ask(r.kind === "queued" ? r.clientId : "box");
      }
    } finally {
      setBusy(false);
    }
  }

  async function retry(clientId: string) {
    if (readOnly) return; // no POST to a read-only chat
    const ok = await chat.retry(clientId);
    ask(ok ? "box" : clientId);
  }

  const requestedNote = status === "requested";

  return (
    <section
      ref={rootRef}
      aria-labelledby={headingId}
      data-testid="chat"
      className={cardCls}
    >
      <h2 id={headingId} className="text-lg font-semibold">
        Chat with {otherName}
      </h2>
      {mock && (
        <p data-testid="chat-mock" className={hintCls}>
          <MockBadge>MOCK</MockBadge> This chat is simulated. Messages stay in
          this browser tab only, nobody else sees them, and there are no live
          updates.
        </p>
      )}
      {requestedNote && !readOnly && (
        <p className={hintCls}>
          Phone numbers, email addresses and links can be sent once the booking
          is accepted.
        </p>
      )}
      {!mock &&
        (chat.live === "paused" || chat.live === "off") &&
        chat.phase === "ready" && (
          <p data-testid="chat-live-note" className={hintCls}>
            {chat.live === "paused"
              ? "Live updates are paused. Trying to reconnect; new messages will appear when it is back."
              : "Live updates are not available right now. Reload the page to see new messages."}
          </p>
        )}

      {chat.phase === "loading" && (
        <p role="status" data-testid="chat-loading">
          Loading the chat...
        </p>
      )}
      {chat.phase === "error" && (
        <div data-testid="chat-load-error" className="flex flex-col gap-3">
          <p role="status" className={dangerBoxCls}>
            The chat did not load. Check your connection and try again.
          </p>
          <p>
            <button
              type="button"
              onClick={() => void chat.reload()}
              className={secondaryButtonCls}
            >
              Try loading the chat again
            </button>
          </p>
        </div>
      )}

      {chat.phase === "ready" && (
        <>
          <div
            ref={listRef}
            role="region"
            aria-label={`Messages with ${otherName}`}
            tabIndex={0}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="max-h-96 overflow-y-auto rounded-xl border-2 border-line p-3 "
          >
            {chat.items.length === 0 ? (
              <p data-testid="chat-empty" className={hintCls}>
                No messages yet.
              </p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="chat-list">
                {chat.items.map((m) => (
                  <Bubble
                    key={m.key}
                    m={m}
                    otherName={otherName}
                    canRetry={!readOnly}
                    onRetry={() => void retry(m.clientId!)}
                    onRemove={() => {
                      chat.remove(m.clientId!);
                      ask("box");
                    }}
                  />
                ))}
              </ol>
            )}
          </div>
          {/* Incoming messages only. Your own sends are not announced (you just pressed Send). */}
          <div
            role="status"
            aria-live="polite"
            data-testid="chat-live"
            className="sr-only"
          >
            {/* A new key each time, so two identical messages are both read out. */}
            <span key={chat.announcementId}>{chat.announcement}</span>
          </div>

          {readOnly ? (
            <p data-testid="chat-frozen" className={infoBoxCls}>
              <span className="font-semibold">Read only.</span>{" "}
              {MESSAGE_REFUSALS.frozen}
            </p>
          ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-2">
              <label htmlFor={boxId} className="font-medium">
                Message to {otherName}
              </label>
              <div
                id={errId}
                ref={errRef}
                tabIndex={-1}
                role={error ? "alert" : undefined}
                data-testid="chat-error"
                className={error ? dangerBoxCls : "sr-only"}
              >
                {error}
              </div>
              <textarea
                id={boxId}
                data-testid="chat-box"
                ref={boxRef}
                rows={3}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                aria-describedby={`${counterId}${error ? ` ${errId}` : ""}`}
                aria-invalid={error ? true : undefined}
                className="control min-h-24"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p
                  id={counterId}
                  data-testid="chat-count"
                  className={over ? "error-text" : hintCls}
                >
                  {count} of {MESSAGE_MAX_LENGTH} characters
                  {over ? ` (${count - MESSAGE_MAX_LENGTH} too many)` : ""}
                </p>
                <button
                  type="submit"
                  aria-disabled={busy}
                  className={buttonCls}
                >
                  {busy ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function Bubble({
  m,
  otherName,
  canRetry,
  onRetry,
  onRemove,
}: {
  m: ChatItem;
  otherName: string;
  canRetry: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const who = m.mine ? "You" : otherName;
  return (
    <li
      data-testid="chat-message"
      data-state={m.state}
      className={`flex flex-col gap-1 ${m.mine ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[85%] rounded-lg border px-3 py-2 ${
          m.mine
            ? "border-primary bg-okbg text-ink "
            : "border-edge bg-surface text-ink "
        } ${m.state !== "sent" ? "opacity-80" : ""}`}
      >
        <p className="text-sm font-semibold">
          {who}
          <span className="sr-only">
            , {m.state === "pending" ? "sending" : formatWhen(m.createdAt)}
          </span>
        </p>
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      </div>
      <p className={hintCls} aria-hidden="true">
        {m.state === "pending" ? "Sending..." : formatWhen(m.createdAt)}
      </p>
      {m.state === "failed" && (
        <div className="flex max-w-[85%] flex-col gap-2">
          <p
            role="alert"
            tabIndex={-1}
            data-failed-for={m.clientId ?? undefined}
            data-testid="chat-failed"
            className={dangerBoxCls}
          >
            {m.error ?? "Not sent."}
          </p>
          <div className="flex flex-wrap gap-2">
            {m.retryable !== false && canRetry && (
              <button
                type="button"
                onClick={onRetry}
                className={secondaryButtonCls}
              >
                Retry sending
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className={secondaryButtonCls}
            >
              Remove message
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
