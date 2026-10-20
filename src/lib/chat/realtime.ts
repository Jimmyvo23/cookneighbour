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
      .channel(`chat:${bookingId}`)
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
