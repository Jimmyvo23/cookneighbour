import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  expectNoRows,
  expectRows,
  ids,
} from "./helpers";

const fx = inject("fx");
const b = fx.bookings;

describe("no access to another user's data", () => {
  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let h1: SupabaseClient;
  let h2: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    [c1, c2, h1, h2, admin] = await Promise.all(
      [fx.c1, fx.c2, fx.h1, fx.h2, fx.admin].map(clientFor),
    );
  });

  it("bookings: only the two parties and admin can read a booking", async () => {
    expectRows(
      await c1.from("bookings").select("id").eq("id", b.requestedC1H1),
      1,
    );
    expectRows(
      await h1.from("bookings").select("id").eq("id", b.requestedC1H1),
      1,
    );
    expectRows(
      await admin.from("bookings").select("id").eq("id", b.requestedC1H1),
      1,
    );
    expectNoRows(
      await c2.from("bookings").select("id").eq("id", b.requestedC1H1),
    );
    expectNoRows(
      await h2.from("bookings").select("id").eq("id", b.requestedC1H1),
    );
    expectNoRows(
      await anonClient()
        .from("bookings")
        .select("id")
        .eq("id", b.requestedC1H1),
    );
    // list queries are filtered too
    const mine = ids(await c2.from("bookings").select("id"));
    expect(mine).toContain(b.requestedC2H2);
    expect(mine).not.toContain(b.requestedC1H1);
    expect(mine).not.toContain(b.acceptedC1H1);
  });

  it("booking_days and booking_day_dishes follow the booking", async () => {
    expectRows(
      await c1
        .from("booking_days")
        .select("id")
        .eq("booking_id", b.requestedC1H1),
      1,
    );
    expectRows(
      await h1
        .from("booking_days")
        .select("id")
        .eq("booking_id", b.requestedC1H1),
      1,
    );
    expectNoRows(
      await c2
        .from("booking_days")
        .select("id")
        .eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(
      await h2
        .from("booking_days")
        .select("id")
        .eq("booking_id", b.requestedC1H1),
    );
    expectRows(await c1.from("booking_day_dishes").select("id"), 1);
    expectRows(await h1.from("booking_day_dishes").select("id"), 1);
    expectNoRows(await c2.from("booking_day_dishes").select("id"));
    expectNoRows(await h2.from("booking_day_dishes").select("id"));
  });

  it("intake forms: the chef sees them before accepting, strangers never do", async () => {
    expectRows(
      await h1
        .from("intake_forms")
        .select("allergies")
        .eq("booking_id", b.requestedC1H1),
      1,
    );
    expectRows(
      await c1
        .from("intake_forms")
        .select("allergies")
        .eq("booking_id", b.requestedC1H1),
      1,
    );
    expectNoRows(
      await c2
        .from("intake_forms")
        .select("allergies")
        .eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(
      await h2
        .from("intake_forms")
        .select("allergies")
        .eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(await anonClient().from("intake_forms").select("allergies"));
  });

  it("receipts: parties only", async () => {
    expectRows(
      await c1.from("receipts").select("id").eq("booking_id", b.requestedC1H1),
      1,
    );
    expectRows(
      await h1.from("receipts").select("id").eq("booking_id", b.requestedC1H1),
      1,
    );
    expectNoRows(
      await c2.from("receipts").select("id").eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(
      await h2.from("receipts").select("id").eq("booking_id", b.requestedC1H1),
    );
  });

  it("messages: parties only", async () => {
    expectRows(
      await c1.from("messages").select("id").eq("booking_id", b.requestedC1H1),
      1,
    );
    expectRows(
      await h1.from("messages").select("id").eq("booking_id", b.requestedC1H1),
      1,
    );
    expectNoRows(
      await c2.from("messages").select("id").eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(
      await h2.from("messages").select("id").eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(await anonClient().from("messages").select("id"));
  });

  it("booking_addresses: the chef cannot read the table even after acceptance; strangers cannot either", async () => {
    expectRows(
      await c1
        .from("booking_addresses")
        .select("address_line")
        .eq("booking_id", b.acceptedC1H1),
      1,
    );
    expectNoRows(
      await h1
        .from("booking_addresses")
        .select("address_line")
        .eq("booking_id", b.acceptedC1H1),
    );
    expectNoRows(
      await h1
        .from("booking_addresses")
        .select("address_line")
        .eq("booking_id", b.requestedC1H1),
    );
    expectNoRows(await c2.from("booking_addresses").select("address_line"));
    expectRows(
      await admin
        .from("booking_addresses")
        .select("address_line")
        .eq("booking_id", b.acceptedC1H1),
      1,
    );
  });

  it("profile_private: own row only, including after a booking is accepted", async () => {
    expectRows(
      await c1
        .from("profile_private")
        .select("phone_e164")
        .eq("profile_id", fx.c1.id),
      1,
    );
    expectNoRows(
      await c2
        .from("profile_private")
        .select("phone_e164")
        .eq("profile_id", fx.c1.id),
    );
    expectNoRows(
      await h1
        .from("profile_private")
        .select("phone_e164")
        .eq("profile_id", fx.c1.id),
    ); // accepted party
    expectNoRows(
      await h2.from("profile_private").select("*").eq("profile_id", fx.c1.id),
    );
    expectNoRows(
      await c1
        .from("profile_private")
        .select("phone_e164")
        .eq("profile_id", fx.h1.id),
    ); // accepted party
    expectNoRows(await anonClient().from("profile_private").select("*"));
    const all = ids(await c2.from("profile_private").select("profile_id"));
    expect(all).toEqual([fx.c2.id]);
  });

  it("chef_private: owner and admin only", async () => {
    expectRows(
      await h1
        .from("chef_private")
        .select("id_document_path")
        .eq("chef_id", fx.h1.id),
      1,
    );
    expectRows(
      await admin
        .from("chef_private")
        .select("police_check_status")
        .eq("chef_id", fx.h1.id),
      1,
    );
    expectNoRows(
      await h2.from("chef_private").select("*").eq("chef_id", fx.h1.id),
    );
    expectNoRows(
      await c1.from("chef_private").select("*").eq("chef_id", fx.h1.id),
    ); // accepted customer
    expectNoRows(await anonClient().from("chef_private").select("*"));
  });

  it("free-trial claims and blocks: own claim only, blocks admin only", async () => {
    expectRows(
      await c1
        .from("free_trial_claims")
        .select("id")
        .eq("customer_id", fx.c1.id),
      1,
    );
    expectNoRows(
      await c2
        .from("free_trial_claims")
        .select("id")
        .eq("customer_id", fx.c1.id),
    );
    expectNoRows(await h1.from("free_trial_claims").select("id")); // chef of that booking
    expect(
      ids(await admin.from("free_trial_claims").select("id")).length,
    ).toBeGreaterThanOrEqual(2);
    expectRows(
      await admin
        .from("free_trial_blocks")
        .select("id")
        .eq("customer_id", fx.c2.id),
      1,
    );
    expectNoRows(await c2.from("free_trial_blocks").select("id")); // even the blocked customer
    expectNoRows(await c1.from("free_trial_blocks").select("id"));
  });

  it("notifications: owner only", async () => {
    const mine = (await c1.from("notifications").select("user_id")).data as {
      user_id: string;
    }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.user_id === fx.c1.id)).toBe(true);
    expectNoRows(
      await c1.from("notifications").select("id").eq("user_id", fx.c2.id),
    );
  });

  it("profiles: a stranger cannot read; a booking counterparty can read the display name only", async () => {
    expectRows(await c2.from("profiles").select("id").eq("id", fx.c2.id), 1);
    expectNoRows(await c2.from("profiles").select("id").eq("id", fx.c1.id));
    expectNoRows(await anonClient().from("profiles").select("id"));
    const seen = await h1.from("profiles").select("*").eq("id", fx.c1.id);
    expectRows(seen, 1);
    const row = (seen.data as Record<string, unknown>[])[0];
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining(["phone_e164"]),
    );
    expect(JSON.stringify(row)).not.toContain(fx.phones.c1);
  });
});

describe("hashes and raw phone are never exposed to others", () => {
  it("another user selecting phone_hash / address_hash gets nothing; the owner's own row is the only source", async () => {
    const c2 = await clientFor(fx.c2);
    const h1 = await clientFor(fx.h1);
    for (const client of [c2, h1, anonClient()]) {
      const r = await client
        .from("profile_private")
        .select("phone_hash,address_hash,phone_e164")
        .eq("profile_id", fx.c1.id);
      expectNoRows(r);
    }
    for (const client of [c2, h1]) {
      const r = await client
        .from("free_trial_claims")
        .select("phone_hash,address_hash")
        .eq("customer_id", fx.c1.id);
      expectNoRows(r);
    }
    // control: the owner can read their own row (so the empty results above are RLS, not missing data)
    const own = await (
      await clientFor(fx.c1)
    )
      .from("profile_private")
      .select("phone_hash,address_hash,phone_e164")
      .eq("profile_id", fx.c1.id);
    expectRows(own, 1);
    expect((own.data as { phone_hash: string }[])[0].phone_hash).toBe(
      fx.hashes.c1Phone,
    );
  });
});

describe("get_booking_contact (CLAUDE.md 6.8)", () => {
  type Contact = {
    counterparty_role: string;
    display_name: string;
    phone_e164: string | null;
    address_line: string | null;
    city: string | null;
    postal_code: string | null;
  };
  const call = async (c: SupabaseClient, booking: string) =>
    c.rpc("get_booking_contact", { p_booking: booking });

  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let h1: SupabaseClient;
  let h2: SupabaseClient;
  beforeAll(async () => {
    [c1, c2, h1, h2] = await Promise.all(
      [fx.c1, fx.c2, fx.h1, fx.h2].map(clientFor),
    );
  });

  it("returns nothing before the booking is accepted (requested), for both parties", async () => {
    expectRows(await call(c1, b.requestedC1H1), 0);
    expectRows(await call(h1, b.requestedC1H1), 0);
  });

  it("returns nothing for declined bookings", async () => {
    expectRows(await call(c1, b.declinedC1H1), 0);
    expectRows(await call(h1, b.declinedC1H1), 0);
  });

  it("after acceptance (customer_home) the chef gets the customer's phone and cooking address", async () => {
    const res = await call(h1, b.acceptedC1H1);
    expectRows(res, 1);
    const row = (res.data as Contact[])[0];
    expect(row.counterparty_role).toBe("customer");
    expect(row.phone_e164).toBe(fx.phones.c1);
    expect(row.address_line).toBe(fx.addresses.c1);
  });

  it("after acceptance (customer_home) the customer gets the chef's phone but no kitchen address", async () => {
    const res = await call(c1, b.acceptedC1H1);
    expectRows(res, 1);
    const row = (res.data as Contact[])[0];
    expect(row.counterparty_role).toBe("chef");
    expect(row.phone_e164).toBe(fx.phones.h1);
    expect(row.address_line).toBeNull();
  });

  it("after acceptance (chef_home) the customer gets the kitchen address and the chef gets no home address", async () => {
    const forCustomer = await call(c1, b.acceptedChefHomeC1H1);
    expectRows(forCustomer, 1);
    expect((forCustomer.data as Contact[])[0].address_line).toBe(
      fx.addresses.kitchen,
    );
    const forChef = await call(h1, b.acceptedChefHomeC1H1);
    expectRows(forChef, 1);
    expect((forChef.data as Contact[])[0].address_line).toBeNull();
  });

  it("returns nothing to non-parties even when accepted, and is not callable by anon", async () => {
    expectRows(await call(c2, b.acceptedC1H1), 0);
    expectRows(await call(h2, b.acceptedC1H1), 0);
    expectRows(await call(c2, b.acceptedChefHomeC1H1), 0);
    const anon = await call(anonClient(), b.acceptedC1H1);
    expect(anon.error?.code).toBe("42501");
  });

  it("never returns hashes, documents or verification fields", async () => {
    const res = await call(h1, b.acceptedC1H1);
    const keys = Object.keys((res.data as Contact[])[0]).sort();
    expect(keys).toEqual([
      "address_line",
      "city",
      "counterparty_role",
      "display_name",
      "phone_e164",
      "postal_code",
    ]);
    const text = JSON.stringify(res.data);
    expect(text).not.toContain(fx.hashes.c1Phone);
    expect(text).not.toContain(fx.hashes.c1Address);
  });
});
