// T-102 round 1 (F-3): the server helpers that touch private data (free-trial claims hold phone
// and address hashes, chef_private, the caller lookup) log a fixed label and the error code, never
// the database message.
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";

const SECRET = 'Key (phone_hash)=(deadbeef00) already exists "free_trial_x"';
const DB_ERROR = { code: "XX000", message: SECRET };

/** Every query chain ends in the same database error. */
function failingDb(): SupabaseClient {
  const chain: unknown = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === "then"
        ? (res: (v: unknown) => void) => res({ data: null, error: DB_ERROR })
        : chain,
    apply: () => chain,
  });
  return chain as SupabaseClient;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: () => failingDb().from("x"),
  }),
}));

async function logged(fn: () => Promise<unknown>) {
  const spies = (["error", "warn", "log", "info"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
  spies.forEach((s) => s.mockRestore());
  return { thrown: String(thrown), out };
}

describe("no database message in errors or logs (T-102 F-3)", () => {
  it("requireCaller", async () => {
    const { requireCaller } = await import("./caller");
    const { thrown } = await logged(requireCaller);
    expect(thrown).toContain("profile lookup failed (code XX000)");
    expect(thrown).not.toContain("deadbeef");
  });

  it("free-trial loaders and claim lookups", async () => {
    const ft = await import("./free-trial");
    const id = "11111111-1111-4111-8111-111111111111";
    for (const fn of [
      () => ft.loadTrialApplicant(failingDb(), id, "p".repeat(32)),
      () => ft.liveClaims(failingDb(), { customerId: id } as never),
    ]) {
      const { thrown } = await logged(fn);
      expect(thrown).toContain("(code XX000)");
      expect(thrown).not.toContain("deadbeef");
      expect(thrown).not.toContain("free_trial_x");
    }
  });

  it("free-trial block log writes the code, not the message", async () => {
    const ft = await import("./free-trial");
    const { out } = await logged(() =>
      ft.recordTrialBlock(
        {
          rpc: async () => ({ data: null, error: DB_ERROR }),
        } as unknown as SupabaseClient,
        "11111111-1111-4111-8111-111111111111",
        "phone" as never,
      ),
    );
    expect(out).toContain("(code XX000)");
    expect(out).not.toContain("deadbeef");
  });

  it("chef application state loader", async () => {
    const ca = await import("./chef-application");
    const { thrown } = await logged(() =>
      ca.loadState(failingDb(), "11111111-1111-4111-8111-111111111111"),
    );
    expect(thrown).toContain("(code XX000)");
    expect(thrown).not.toContain("deadbeef");
  });
});
