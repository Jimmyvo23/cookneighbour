// Pure rules of the booking chat (T-046, contract section 7C). Shared by the real routes
// (src/lib/server/messages.ts) and the MOCK adapter, so the two cannot drift apart.
//
// D-93: a frozen booking's chat is read only. D-94: the chat of a declined, cancelled, expired or
// no-show booking is hidden from both parties. D-96/A-33: a new-message notification never holds
// the message text.
import { findContactDetails } from "./contactDetails";
import { hasUnsafeText } from "./text-safety";

export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_KEYS = ["clientId", "body"];
/** Placeholder limiter (contract section 9): messages per user per window. */
export const MESSAGE_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

/** D-94: the only statuses whose chat the parties can read and write. */
export const CHAT_OPEN_STATUSES = [
  "requested",
  "accepted",
  "completed",
] as const;
export function isChatOpenStatus(status: string): boolean {
  return (CHAT_OPEN_STATUSES as readonly string[]).includes(status);
}

/** Human texts of the 409 refusals; the `reason` codes are stable (contract 7C). */
export const MESSAGE_REFUSALS = {
  chat_hidden:
    "The chat for this booking is closed. Chats of declined, cancelled, expired and no-show bookings are not available.",
  // Neutral on purpose, like the other frozen refusals (D-53): it does not say why.
  frozen:
    "This booking is on hold while an admin looks at it, so the chat is read only for now.",
  message_id_reused:
    "That message id was already used for a different message. Start a new message.",
} as const;

export const CONTACT_IN_CHAT_MESSAGE =
  "Do not put phone numbers, email addresses or links in a message. Contact details are shared after a booking is accepted.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ParsedMessage =
  | { ok: true; clientId: string; text: string }
  | { ok: false; fields: Record<string, string> };

/**
 * Shape of a POST body: `clientId` (a lower-case UUID) and `body` (1 to 2000 characters after
 * trimming; line breaks and tabs are allowed, other control characters and lone surrogates are not).
 * The contact-details check is separate because it depends on the booking status.
 */
export function parseMessageBody(body: Record<string, unknown>): ParsedMessage {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body))
    if (!MESSAGE_KEYS.includes(k)) fields[k] = "Unknown field.";
  const id = body.clientId;
  if (typeof id !== "string" || !UUID.test(id))
    fields.clientId = "Send a new UUID (lower case) for each message.";
  const raw = body.body;
  let text = "";
  if (typeof raw !== "string") fields.body = "Required.";
  else {
    text = raw.trim();
    if (text.length < 1 || text.length > MESSAGE_MAX_LENGTH)
      fields.body = `Enter 1 to ${MESSAGE_MAX_LENGTH} characters.`;
    else if (hasUnsafeText(text, true))
      fields.body = "Remove control or invalid characters.";
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, clientId: id as string, text };
}

/** CLAUDE.md 6.8 and D-34: before acceptance a message may not carry contact details. */
export function contactBlockedBeforeAcceptance(
  status: string,
  text: string,
): boolean {
  return status === "requested" && findContactDetails(text) !== null;
}
