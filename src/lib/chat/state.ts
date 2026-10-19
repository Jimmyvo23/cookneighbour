// Pure state of the booking chat list (T-047). No React, no network, so it is easy to test.
// Items are saved messages ("sent") plus the browser's own unsaved ones ("pending", "failed").
// A message is matched by `id`, then by `clientId` (the id this browser chose before sending), so a
// Realtime echo, a history reload and a retry never show the same message twice.
import type { MessageView } from "@/lib/api/types";

export interface ChatItem {
  /** Stable React key: the clientId when there is one, else the id. */
  key: string;
  id: string | null;
  clientId: string | null;
  senderId: string | null;
  mine: boolean;
  body: string;
  createdAt: string;
  state: "sent" | "pending" | "failed";
  /** Why a failed message was not sent. */
  error?: string;
  /** False when a retry cannot work (the chat is on hold). */
  retryable?: boolean;
}

function fromView(m: MessageView, key?: string): ChatItem {
  return {
    key: key ?? m.clientId ?? m.id,
    id: m.id,
    clientId: m.clientId,
    senderId: m.senderId,
    mine: m.mine,
    body: m.body,
    createdAt: m.createdAt,
    state: "sent",
  };
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Folds saved messages into the list. Saved ones come first, oldest first; unsaved ones last. */
export function mergeServer(
  items: ChatItem[],
  incoming: MessageView[],
): ChatItem[] {
  const next = [...items];
  for (const m of incoming) {
    let at = next.findIndex((i) => i.id !== null && i.id === m.id);
    if (at < 0 && m.clientId)
      at = next.findIndex((i) => i.clientId === m.clientId);
    if (at >= 0) {
      // Keep the key (no remount) and `mine` from the bubble we made ourselves.
      next[at] = {
        ...fromView(m, next[at].key),
        mine: next[at].mine || m.mine,
      };
    } else next.push(fromView(m));
  }
  const saved = next
    .filter((i) => i.state === "sent")
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || cmp(a.id, b.id));
  return [...saved, ...next.filter((i) => i.state !== "sent")];
}

function cmp(a: string | null, b: string | null): number {
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

export function addPending(
  items: ChatItem[],
  clientId: string,
  body: string,
  createdAt: string,
): ChatItem[] {
  return [
    ...items,
    {
      key: clientId,
      id: null,
      clientId,
      senderId: null,
      mine: true,
      body,
      createdAt,
      state: "pending",
    },
  ];
}

function patch(
  items: ChatItem[],
  clientId: string,
  change: Partial<ChatItem>,
): ChatItem[] {
  return items.map((i) =>
    i.clientId === clientId && i.state !== "sent" ? { ...i, ...change } : i,
  );
}

export function markFailed(
  items: ChatItem[],
  clientId: string,
  error: string,
  retryable: boolean,
): ChatItem[] {
  return patch(items, clientId, { state: "failed", error, retryable });
}

export function markPending(items: ChatItem[], clientId: string): ChatItem[] {
  return patch(items, clientId, {
    state: "pending",
    error: undefined,
    retryable: undefined,
  });
}

export function removeItem(items: ChatItem[], clientId: string): ChatItem[] {
  return items.filter((i) => !(i.clientId === clientId && i.state !== "sent"));
}

/** The raw Realtime row (snake_case, contract 7C) as a MessageView. Null if it is not a message. */
export function rowToView(
  row: unknown,
  myUserId: string | null,
): MessageView | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.booking_id !== "string" ||
    typeof r.sender_id !== "string" ||
    typeof r.body !== "string" ||
    typeof r.created_at !== "string"
  )
    return null;
  return {
    id: r.id,
    bookingId: r.booking_id,
    senderId: r.sender_id,
    mine: myUserId !== null && r.sender_id === myUserId,
    clientId: typeof r.client_id === "string" ? r.client_id : null,
    body: r.body,
    createdAt: r.created_at,
  };
}
