// Live updates for the booking chat (T-047, contract 7C "Realtime"). This is the only place the
// chat touches Supabase in the browser. It uses the browser client (publishable key) with the
// signed-in user's session from the auth cookies (@supabase/ssr stores them readable by the
// browser on purpose), never the secret key. Row-level security decides which rows arrive.
import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveStatus = "live" | "down";

export interface ChatSubscription {
  /** The signed-in user's id, to tell my own messages from the other party's. */
  userId: string;
  close(): void;
}

export interface ChatHandlers {
  /** The raw table row (snake_case) of a new message. */
  onRow(row: unknown): void;
  onStatus(status: LiveStatus): void;
}

export type ChatConnect = (
  bookingId: string,
  handlers: ChatHandlers,
) => Promise<ChatSubscription>;

async function defaultClient(): Promise<SupabaseClient> {
  // Loaded on demand, so MOCK mode and bare pages never create a Supabase client.
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

let subscriptionCounter = 0;
function nextSubscriptionId(): string {
  subscriptionCounter += 1;
  return `${Date.now().toString(36)}-${subscriptionCounter}`;
}

export function makeConnectChat(
  makeClient: () => Promise<SupabaseClient> = defaultClient,
): ChatConnect {
  return async (bookingId, handlers) => {
    const supabase = await makeClient();
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error("No signed-in session for live updates.");
    await supabase.realtime.setAuth(session.access_token);
    const channel = supabase
      // A unique topic per subscription: the browser client is a singleton and returns the
      // existing channel for the same topic, so an overlapping remount would otherwise close the
      // channel the new mount uses (T-094). Safe for access: the topic is only a label. The
      // project has no Realtime Authorization policies on realtime.messages; postgres_changes
      // rows are filtered by row-level security on public.messages (the booking's two parties).
      .channel(`chat:${bookingId}:${nextSubscriptionId()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => handlers.onRow(payload.new),
      )
      .subscribe((status) =>
        handlers.onStatus(status === "SUBSCRIBED" ? "live" : "down"),
      );
    return {
      userId: session.user.id,
      close: () => {
        void supabase.removeChannel(channel);
      },
    };
  };
}

export const connectChat: ChatConnect = makeConnectChat();
