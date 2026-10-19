"use client";
// The chat's data flow (T-047): subscribe to Realtime, load the whole history, send with a
// clientId, retry with the same one. Every rule here comes from contract 7C.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch, formatRetry } from "@/lib/api/client";
import type { MessageList, MessageView } from "@/lib/api/types";
import { MESSAGE_MAX_LENGTH, MESSAGE_REFUSALS } from "@/lib/domain/messages";
import {
  connectChat,
  type ChatConnect,
  type ChatSubscription,
} from "@/lib/chat/realtime";
import {
  addPending,
  markFailed,
  markPending,
  mergeServer,
  removeItem,
  rowToView,
  type ChatItem,
} from "@/lib/chat/state";

/** live: Realtime works. paused: it dropped (it reconnects by itself). off: it could not start. mock: MOCK mode has none. */
export type LiveState = "live" | "paused" | "off" | "mock";
export type Phase = "loading" | "ready" | "hidden" | "error";

/** What the composer should do after a send. */
export type SendResult =
  | { kind: "ok" } // saved, or put in the list as a failed bubble: clear the box
  | { kind: "queued"; clientId: string } // not saved, shown in the list as failed: clear the box
  | { kind: "form-error"; message: string }; // keep the text, show the message

const MAX_PAGES = 200; // 200 pages of up to 50 = 10 000 messages; a stop against a loop

type Fetched =
  | { status: "ok"; items: MessageView[] }
  | { status: "hidden" }
  | { status: "error" };

export interface UseChatOptions {
  bookingId: string;
  mock: boolean;
  /** Injected in tests. */
  connect?: ChatConnect;
  /** Called with the plain text for the live region when the other party's message arrives. */
  otherName: string;
}

export function useChat({
  bookingId,
  mock,
  connect = connectChat,
  otherName,
}: UseChatOptions) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [live, setLive] = useState<LiveState>(mock ? "mock" : "paused");
  const [announced, setAnnounced] = useState({ text: "", id: 0 });
  const [frozenSeen, setFrozenSeen] = useState(false);
  const phaseRef = useRef<Phase>("loading");
  const itemsRef = useRef<ChatItem[]>([]);
  const userIdRef = useRef<string | null>(null);
  const needsReload = useRef(false);
  const subRef = useRef<ChatSubscription | null>(null);
  const nameRef = useRef(otherName);
  nameRef.current = otherName;

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const apply = useCallback((fn: (prev: ChatItem[]) => ChatItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const path = `/api/bookings/${encodeURIComponent(bookingId)}/messages`;

  /** Walks nextCursor to the end (oldest first, contract 7C). */
  const fetchAll = useCallback(async (): Promise<Fetched> => {
    const all: MessageView[] = [];
    let cursor: string | null = null;
    try {
      for (let i = 0; i < MAX_PAGES; i++) {
        const q = new URLSearchParams({ limit: "50" });
        if (cursor) q.set("cursor", cursor);
        const page: MessageList = await apiFetch<MessageList>(
          `${path}?${q.toString()}`,
        );
        if (!Array.isArray(page?.items)) return { status: "error" };
        all.push(...page.items);
        if (!page.nextCursor) return { status: "ok", items: all };
        cursor = page.nextCursor;
      }
      return { status: "ok", items: all };
    } catch (err) {
      if (err instanceof ApiClientError && err.reason === "chat_hidden")
        return { status: "hidden" };
      return { status: "error" };
    }
  }, [path]);

  const loadAll = useCallback(async (): Promise<Fetched> => {
    const r = await fetchAll();
    if (r.status === "ok") apply((prev) => mergeServer(prev, r.items));
    else if (r.status === "hidden") {
      setPhaseBoth("hidden");
      // A hidden chat stops delivering anyway (D-94); free the channel now.
      subRef.current?.close();
      subRef.current = null;
    }
    return r;
  }, [fetchAll, apply]);

  // Start: subscribe first, then load, so nothing between the two is missed (contract 7C).
  useEffect(() => {
    let cancelled = false;
    itemsRef.current = [];
    userIdRef.current = null;
    needsReload.current = false;
    setItems([]);
    setFrozenSeen(false);
    setPhaseBoth("loading");

    async function start() {
      if (!mock) {
        try {
          const s = await connect(bookingId, {
            onRow: (row) => {
              const view = rowToView(row, userIdRef.current);
              if (!view || view.bookingId !== bookingId) return;
              const known = itemsRef.current.some(
                (i) =>
                  (i.id !== null && i.id === view.id) ||
                  (view.clientId !== null && i.clientId === view.clientId),
              );
              apply((prev) => mergeServer(prev, [view]));
              // Announce only what the other party sent, and only once (not my own, not a repeat).
              if (!known && !view.mine && phaseRef.current === "ready") {
                const text =
                  view.body.length > 200
                    ? `${view.body.slice(0, 200)}...`
                    : view.body;
                setAnnounced((p) => ({
                  text: `New message from ${nameRef.current}: ${text}`,
                  id: p.id + 1,
                }));
              }
            },
            onStatus: (st) => {
              if (cancelled) return;
              if (st === "live") {
                setLive("live");
                if (needsReload.current) {
                  needsReload.current = false;
                  void loadAll(); // events are best effort: load the history again after a drop
                }
              } else {
                needsReload.current = true;
                setLive("paused");
              }
            },
          });
          if (cancelled) {
            s.close();
            return;
          }
          subRef.current = s;
          userIdRef.current = s.userId;
        } catch {
          if (!cancelled) setLive("off");
        }
      }
      if (cancelled) return;
      const r = await loadAll();
      if (cancelled) return;
      if (r.status === "ok") setPhaseBoth("ready");
      else if (r.status === "error") setPhaseBoth("error");
    }
    void start();
    return () => {
      cancelled = true;
      subRef.current?.close();
      subRef.current = null;
    };
  }, [bookingId, mock, connect, loadAll, apply]);

  /** One try at POST. The same clientId is used again on a retry. */
  const post = useCallback(
    async (
      clientId: string,
      text: string,
      first: boolean,
    ): Promise<SendResult> => {
      try {
        const saved = await apiFetch<MessageView>(path, {
          method: "POST",
          body: { clientId, body: text },
        });
        apply((prev) => mergeServer(prev, [saved]));
        return { kind: "ok" };
      } catch (err) {
        if (err instanceof ApiClientError) {
          // The message was refused for what it says: keep it in the box (a first send only).
          if (
            first &&
            (err.code === "CONTACT_DETAILS_NOT_ALLOWED" ||
              err.code === "VALIDATION_FAILED")
          ) {
            apply((prev) => removeItem(prev, clientId));
            return {
              kind: "form-error",
              message:
                err.code === "CONTACT_DETAILS_NOT_ALLOWED"
                  ? err.message
                  : (err.fields.body ?? err.message),
            };
          }
          if (err.status === 429) {
            const msg = `You are sending messages too quickly. Please wait ${
              err.retryAfterSeconds
                ? formatRetry(err.retryAfterSeconds)
                : "a moment"
            } and send again.`;
            if (first) {
              apply((prev) => removeItem(prev, clientId));
              return { kind: "form-error", message: msg };
            }
            apply((prev) => markFailed(prev, clientId, msg, true));
            return { kind: "queued", clientId };
          }
          if (
            err.code === "INVALID_STATE" &&
            (err.reason === "frozen" || err.reason === "chat_hidden")
          ) {
            // Maybe the first try was saved and only the answer was lost: look before saying "not sent".
            const r = await loadAll();
            if (r.status === "hidden") return { kind: "ok" }; // the whole chat goes away
            if (
              r.status === "ok" &&
              r.items.some((m) => m.clientId === clientId)
            )
              return { kind: "ok" };
            const frozen = err.reason === "frozen";
            if (frozen) setFrozenSeen(true);
            apply((prev) =>
              markFailed(
                prev,
                clientId,
                `Not sent. ${frozen ? MESSAGE_REFUSALS.frozen : err.message}`,
                false,
              ),
            );
            return { kind: "queued", clientId };
          }
          if (
            err.code === "INVALID_STATE" &&
            err.reason === "message_id_reused"
          ) {
            apply((prev) =>
              markFailed(
                prev,
                clientId,
                "Not sent. Remove it and write it again.",
                false,
              ),
            );
            return { kind: "queued", clientId };
          }
          apply((prev) =>
            markFailed(prev, clientId, `Not sent. ${err.message}`, true),
          );
          return { kind: "queued", clientId };
        }
        apply((prev) =>
          markFailed(prev, clientId, "Not sent. Please try again.", true),
        );
        return { kind: "queued", clientId };
      }
    },
    [path, apply, loadAll],
  );

  const send = useCallback(
    async (raw: string): Promise<SendResult> => {
      const text = raw.trim();
      if (text.length < 1)
        return { kind: "form-error", message: "Write a message first." };
      if (text.length > MESSAGE_MAX_LENGTH)
        return {
          kind: "form-error",
          message: `This message is ${text.length} characters. The limit is ${MESSAGE_MAX_LENGTH}. Please shorten it.`,
        };
      const clientId = crypto.randomUUID();
      apply((prev) =>
        addPending(prev, clientId, text, new Date().toISOString()),
      );
      return post(clientId, text, true);
    },
    [apply, post],
  );

  /** Retry a failed bubble with the SAME clientId. Answers the clientId when it ended up failed. */
  const retry = useCallback(
    async (clientId: string): Promise<boolean> => {
      const item = itemsRef.current.find(
        (i) => i.clientId === clientId && i.state === "failed",
      );
      if (!item) return true;
      apply((prev) => markPending(prev, clientId));
      const r = await post(clientId, item.body, false);
      return r.kind === "ok";
    },
    [apply, post],
  );

  const remove = useCallback(
    (clientId: string) => apply((prev) => removeItem(prev, clientId)),
    [apply],
  );

  const reload = useCallback(async () => {
    setPhaseBoth("loading");
    const r = await loadAll();
    if (r.status === "ok") setPhaseBoth("ready");
    else if (r.status === "error") setPhaseBoth("error");
  }, [loadAll]);

  return {
    phase,
    items,
    live,
    announcement: announced.text,
    announcementId: announced.id,
    frozenSeen,
    send,
    retry,
    remove,
    reload,
  };
}
