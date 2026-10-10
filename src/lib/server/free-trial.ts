// Free-trial server functions (T-038, CLAUDE.md 6.6, PLAN R-4, A-16). No routes yet: the booking
// routes (T-042) call these after they know who the caller is.
//
// Authorization: `customerId` MUST come from requireCaller() (the session), never from a request
// body. These functions use the service role (they write tables clients cannot write), so they
// re-check what they rely on: the profile is a customer, the booking exists and is that
// customer's own. Hashes are computed here from the STORED, server-normalized phone and address
// with the server-only pepper; a hash sent by a client is never an input.
//
// Atomic hold: one INSERT into free_trial_claims. The three partial unique indexes
// (free_trial_one_per_customer / _phone / _address, where state <> 'released') are the lock, so two
// parallel holds cannot both win; the loser gets Postgres 23505, which becomes a generic 409.
// There is no read-then-write gap to race. State changes are one conditional UPDATE
// (... where booking_id = ? and state = 'held'), so a parallel decline and completion cannot both
// apply. What an outcome means (hold / consume / release) comes only from freeTrialEffect (A-16).
//
// Privacy: the customer only ever learns "not available" (FREE_TRIAL_USED). Which rule blocked
// (own history, a phone or an address another account used) goes to free_trial_blocks, which only
// admins can read. Hashes, phone numbers and addresses are never logged or returned.
//
// MOCK: the trial waives chef labour in the prototype only; nobody pays the chef (Q-1).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure } from "@/lib/api/errors";
import { isUuid } from "@/lib/domain/admin-chefs";
import type { FreeTrialEvent } from "@/lib/domain/cancellation";
import {
  evaluateFreeTrial,
  transitionFreeTrial,
  type ClaimSummary,
  type FreeTrialBlockReason,
  type FreeTrialState,
  type TrialApplicant,
} from "@/lib/domain/freeTrial";
import { addressHash, phoneHash } from "@/lib/domain/hash";
import { normalizePhone } from "@/lib/domain/phone";
import { getHashPepper } from "@/lib/server/pepper";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FreeTrialDeps {
  /** Service-role client. Tests may pass one; production code leaves it out. */
  db?: SupabaseClient;
  /** Defaults to HASH_PEPPER. */
  pepper?: string;
}

export const FREE_TRIAL_USED_MESSAGE =
  "The free first booking is not available.";

const BLOCK_BY_INDEX: Record<string, FreeTrialBlockReason> = {
  free_trial_one_per_customer: "customer",
  free_trial_one_per_phone: "phone",
  free_trial_one_per_address: "address",
};

const used = () => new ApiFailure("FREE_TRIAL_USED", FREE_TRIAL_USED_MESSAGE);
const notFound = (what: string) =>
  new ApiFailure("NOT_FOUND", `No ${what} with that id.`);

/**
 * Loads the customer and returns the hashes of their stored phone and address. Throws a clean
 * 4xx (never a 500) when the customer is not a customer, has no verified phone, a stored phone
 * the current rules reject, or no usable address.
 */
async function loadApplicant(
  db: SupabaseClient,
  customerId: string,
  pepper: string,
): Promise<TrialApplicant> {
  if (!isUuid(customerId)) throw notFound("customer");
  const prof = await db
    .from("profiles")
    .select("role")
    .eq("id", customerId)
    .maybeSingle();
  if (prof.error)
    throw new Error(`profile lookup failed: ${prof.error.message}`);
  if (!prof.data) throw notFound("customer");
  if (prof.data.role !== "customer")
    throw new ApiFailure(
      "FORBIDDEN",
      "Only customers can use the free first booking.",
    );

  const priv = await db
    .from("profile_private")
    .select("phone_e164, phone_verified, address_line, postal_code")
    .eq("profile_id", customerId)
    .maybeSingle();
  if (priv.error)
    throw new Error(`private lookup failed: ${priv.error.message}`);
  const row = priv.data;

  if (!row?.phone_e164)
    throw new ApiFailure(
      "PHONE_NOT_SUBMITTED",
      "Add and verify your phone number first.",
    );
  // T-037 follow-up: a number stored before the stricter rules (N11 codes) is refused cleanly.
  const e164 = normalizePhone(row.phone_e164 as string);
  if (!e164)
    throw new ApiFailure(
      "PHONE_NOT_SUBMITTED",
      "Your saved phone number is not valid. Enter it again and verify it.",
    );
  if (!row.phone_verified)
    throw new ApiFailure(
      "PHONE_NOT_VERIFIED",
      "Verify your phone number first.",
    );

  if (!row.address_line || !row.postal_code)
    throw new ApiFailure("ADDRESS_NOT_SET", "Add your home address first.");
  let aHash: string;
  try {
    aHash = addressHash(
      row.address_line as string,
      row.postal_code as string,
      pepper,
    );
  } catch {
    throw new ApiFailure(
      "ADDRESS_NOT_SET",
      "Your saved home address is not valid. Enter it again.",
    );
  }
  return { customerId, phoneHash: phoneHash(e164, pepper), addressHash: aHash };
}

async function liveClaims(
  db: SupabaseClient,
  a: TrialApplicant,
): Promise<ClaimSummary[]> {
  // The values are a uuid and two hex digests made here, so the filter string cannot be injected.
  const r = await db
    .from("free_trial_claims")
    .select("customer_id, phone_hash, address_hash, state")
    .neq("state", "released")
    .or(
      `customer_id.eq.${a.customerId},phone_hash.eq.${a.phoneHash},address_hash.eq.${a.addressHash}`,
    );
  if (r.error) throw new Error(`claims lookup failed: ${r.error.message}`);
  return (r.data ?? []).map((c) => ({
    customerId: c.customer_id as string,
    phoneHash: c.phone_hash as string,
    addressHash: c.address_hash as string,
    state: c.state as FreeTrialState,
  }));
}

/**
 * Advisory answer for the estimate screen: can this customer still use the free first booking?
 * Not a reservation: only holdFreeTrial reserves it. Throws the clean 4xx described above when
 * the customer has no verified phone or usable address. The answer is a plain yes or no.
 */
export async function checkFreeTrialEligibility(
  customerId: string,
  deps: FreeTrialDeps = {},
): Promise<{ eligible: boolean }> {
  const db = deps.db ?? createAdminClient();
  const a = await loadApplicant(db, customerId, deps.pepper ?? getHashPepper());
  return { eligible: evaluateFreeTrial(a, await liveClaims(db, a)).eligible };
}

export interface HeldClaim {
  claimId: string;
  bookingId: string;
  state: "held";
}

async function logBlock(
  db: SupabaseClient,
  customerId: string,
  reason: FreeTrialBlockReason,
) {
  // Best effort: a failed log must not turn the clean 409 into a 500. Message only, no data.
  const r = await db
    .from("free_trial_blocks")
    .insert({ customer_id: customerId, reason });
  if (r.error) console.error("free-trial: block log failed:", r.error.message);
}

/**
 * Reserves the free trial for one booking (call it right after the booking row is created).
 * Throws FREE_TRIAL_USED (409) when the customer, their phone or their address already has a
 * held or consumed claim, including when a parallel hold won the race. Retrying for the same
 * booking is safe: it returns the claim that already exists.
 */
export async function holdFreeTrial(
  customerId: string,
  bookingId: string,
  deps: FreeTrialDeps = {},
): Promise<HeldClaim> {
  const db = deps.db ?? createAdminClient();
  const a = await loadApplicant(db, customerId, deps.pepper ?? getHashPepper());

  if (!isUuid(bookingId)) throw notFound("booking");
  const b = await db
    .from("bookings")
    .select("customer_id, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (b.error) throw new Error(`booking lookup failed: ${b.error.message}`);
  // Someone else's booking looks the same as a missing one.
  if (!b.data || b.data.customer_id !== customerId) throw notFound("booking");
  if (b.data.status !== "requested")
    throw new ApiFailure(
      "INVALID_STATE",
      "The free first booking can only be held for a new request.",
    );

  const ins = await db
    .from("free_trial_claims")
    .insert({
      customer_id: customerId,
      booking_id: bookingId,
      phone_hash: a.phoneHash,
      address_hash: a.addressHash,
    })
    .select("id")
    .single();
  if (!ins.error && ins.data)
    return { claimId: ins.data.id as string, bookingId, state: "held" };

  if (ins.error?.code !== "23505")
    throw new Error(`claim insert failed: ${ins.error?.message}`);

  const msg = ins.error.message ?? "";
  // Same booking asked twice: return the claim it already has (idempotent retry).
  if (msg.includes("free_trial_claims_booking_id_key")) {
    const ex = await db
      .from("free_trial_claims")
      .select("id, customer_id, state")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (ex.error) throw new Error(`claim lookup failed: ${ex.error.message}`);
    if (ex.data?.customer_id === customerId && ex.data.state === "held")
      return { claimId: ex.data.id as string, bookingId, state: "held" };
    throw new ApiFailure(
      "INVALID_STATE",
      "This booking already used or released its free first booking.",
    );
  }

  // One of the three rule indexes. The index name says which; if it is missing, re-evaluate.
  let reason: FreeTrialBlockReason | undefined = Object.entries(
    BLOCK_BY_INDEX,
  ).find(([name]) => msg.includes(name))?.[1];
  if (!reason) {
    const e = evaluateFreeTrial(a, await liveClaims(db, a));
    if (!e.eligible) reason = e.reason;
  }
  if (!reason) throw new Error("claim insert hit an unknown unique rule");
  await logBlock(db, customerId, reason);
  throw used();
}

export interface AppliedEvent {
  /** True when this call changed the claim. */
  changed: boolean;
  /** The claim's state now, or null when the booking has no claim (not a free-trial booking). */
  state: FreeTrialState | null;
}

/**
 * Applies a booking outcome to the booking's claim (A-16). Only a `held` claim changes, in one
 * conditional UPDATE, so parallel events cannot both apply: the loser finds the claim already
 * final. Repeating the same outcome is a no-op; the opposite outcome throws INVALID_STATE. A
 * booking with no claim is a no-op (it was never a free-trial booking).
 */
export async function applyFreeTrialEvent(
  bookingId: string,
  event: FreeTrialEvent,
  deps: FreeTrialDeps = {},
): Promise<AppliedEvent> {
  const db = deps.db ?? createAdminClient();
  if (!isUuid(bookingId)) throw notFound("booking");

  // Read first only to learn the current state; the write below re-checks it.
  const cur = await db
    .from("free_trial_claims")
    .select("state")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (cur.error) throw new Error(`claim lookup failed: ${cur.error.message}`);
  if (!cur.data) return { changed: false, state: null };

  const t = transitionFreeTrial(cur.data.state as FreeTrialState, event);
  if (t.kind === "invalid") throw invalidTransition();
  if (t.kind === "noop") return { changed: false, state: t.state };

  const up = await db
    .from("free_trial_claims")
    .update({ state: t.to })
    .eq("booking_id", bookingId)
    .eq("state", t.from)
    .select("state");
  if (up.error) throw new Error(`claim update failed: ${up.error.message}`);
  if (up.data && up.data.length === 1) return { changed: true, state: t.to };

  // Lost a race: someone changed the claim after our read. Judge the new state the same way.
  const now = await db
    .from("free_trial_claims")
    .select("state")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (now.error) throw new Error(`claim lookup failed: ${now.error.message}`);
  if (!now.data) return { changed: false, state: null };
  const again = transitionFreeTrial(now.data.state as FreeTrialState, event);
  if (again.kind === "noop") return { changed: false, state: again.state };
  throw invalidTransition();
}

function invalidTransition() {
  return new ApiFailure(
    "INVALID_STATE",
    "The free first booking was already decided differently for this booking.",
  );
}
