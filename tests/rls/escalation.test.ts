import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  expectRows,
  makeBooking,
  makeChef,
  makeUser,
  rand,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const b = fx.bookings;
const svc = serviceClient();

describe("privilege escalation", () => {
  let c1: SupabaseClient;
  let h1: SupabaseClient;
  let hp: SupabaseClient;
  let hr: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    [c1, h1, hp, hr, admin] = await Promise.all(
      [fx.c1, fx.h1, fx.hp, fx.hr, fx.admin].map(clientFor),
    );
  });

  it("a customer cannot make themselves admin, but can edit their own display name", async () => {
    expectDenied(
      await c1
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", fx.c1.id)
        .select(),
    );
    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", fx.c1.id)
      .single();
    expect(data?.role).toBe("customer");
    // allowed control: same row, harmless column
    expectRows(
      await c1
        .from("profiles")
        .update({ display_name: "Customer One" })
        .eq("id", fx.c1.id)
        .select(),
      1,
    );
  });

  it("a customer cannot change another user's profile", async () => {
    expectDenied(
      await c1
        .from("profiles")
        .update({ display_name: "hacked" })
        .eq("id", fx.c2.id)
        .select(),
    );
    const { data } = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", fx.c2.id)
      .single();
    expect(data?.display_name).not.toBe("hacked");
  });

  it("a chef cannot become admin or customer", async () => {
    expectDenied(
      await h1
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", fx.h1.id)
        .select(),
    );
    expectDenied(
      await h1
        .from("profiles")
        .update({ role: "customer" })
        .eq("id", fx.h1.id)
        .select(),
    );
    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", fx.h1.id)
      .single();
    expect(data?.role).toBe("chef");
  });

  it("sign-up metadata cannot request the admin role; chef is allowed", async () => {
    const sneaky = await makeUser(svc, "customer", "sneaky", "admin");
    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", sneaky.id)
      .single();
    expect(data?.role).toBe("customer");
    const chef = await makeUser(svc, "chef", "legit-chef");
    const { data: d2 } = await svc
      .from("profiles")
      .select("role")
      .eq("id", chef.id)
      .single();
    expect(d2?.role).toBe("chef");
  });

  it("a pending chef cannot approve themselves; they can still edit their bio", async () => {
    expectDenied(
      await hp
        .from("chefs")
        .update({ status: "approved" })
        .eq("profile_id", fx.hp.id)
        .select(),
    );
    const { data } = await svc
      .from("chefs")
      .select("status")
      .eq("profile_id", fx.hp.id)
      .single();
    expect(data?.status).toBe("pending");
    expectRows(
      await hp
        .from("chefs")
        .update({ bio: "I cook well" })
        .eq("profile_id", fx.hp.id)
        .select(),
      1,
    );
  });

  it("a rejected chef cannot flip to approved", async () => {
    expectDenied(
      await hr
        .from("chefs")
        .update({ status: "approved" })
        .eq("profile_id", fx.hr.id)
        .select(),
    );
    const { data } = await svc
      .from("chefs")
      .select("status")
      .eq("profile_id", fx.hr.id)
      .single();
    expect(data?.status).toBe("rejected");
  });

  it("a chef cannot edit another chef's profile", async () => {
    expectDenied(
      await h1
        .from("chefs")
        .update({ bio: "hijack" })
        .eq("profile_id", fx.h2.id)
        .select(),
    );
    const { data } = await svc
      .from("chefs")
      .select("bio")
      .eq("profile_id", fx.h2.id)
      .single();
    expect(data?.bio).not.toBe("hijack");
  });

  it("a chef cannot fake rating, review count, or enable chef-home themselves", async () => {
    expectDenied(
      await h1
        .from("chefs")
        .update({ rating_avg: 5 })
        .eq("profile_id", fx.h1.id)
        .select(),
    );
    expectDenied(
      await h1
        .from("chefs")
        .update({ review_count: 999 })
        .eq("profile_id", fx.h1.id)
        .select(),
    );
    const h2 = await clientFor(fx.h2);
    expectDenied(
      await h2
        .from("chefs")
        .update({ chef_home_enabled: true })
        .eq("profile_id", fx.h2.id)
        .select(),
    );
    const { data } = await svc
      .from("chefs")
      .select("chef_home_enabled")
      .eq("profile_id", fx.h2.id)
      .single();
    expect(data?.chef_home_enabled).toBe(false);
  });

  it("a chef cannot mark their own police, ID, food-handler or kitchen checks verified; acknowledgements are allowed", async () => {
    expectDenied(
      await hp
        .from("chef_private")
        .update({ police_check_status: "verified" })
        .eq("chef_id", fx.hp.id)
        .select(),
    );
    expectDenied(
      await hp
        .from("chef_private")
        .update({ id_check_status: "verified" })
        .eq("chef_id", fx.hp.id)
        .select(),
    );
    expectDenied(
      await hp
        .from("chef_private")
        .update({ food_handler_status: "verified" })
        .eq("chef_id", fx.hp.id)
        .select(),
    );
    expectDenied(
      await hp
        .from("chef_private")
        .update({ kitchen_status: "verified" })
        .eq("chef_id", fx.hp.id)
        .select(),
    );
    expectDenied(
      await hp
        .from("chef_private")
        .update({ reject_reason: "approved by me" })
        .eq("chef_id", fx.hp.id)
        .select(),
    );
    const { data } = await svc
      .from("chef_private")
      .select("police_check_status,id_check_status")
      .eq("chef_id", fx.hp.id)
      .single();
    expect(data?.police_check_status).toBe("pending");
    expect(data?.id_check_status).toBe("not_started");
    expectRows(
      await hp
        .from("chef_private")
        .update({ allergen_ack_at: new Date().toISOString() })
        .eq("chef_id", fx.hp.id)
        .select(),
      1,
    );
  });

  it("a customer cannot create a chef row or chef_private row for themselves", async () => {
    expectDenied(
      await c1
        .from("chefs")
        .insert({ profile_id: fx.c1.id, display_name: "x", status: "approved" })
        .select(),
    );
    expectDenied(
      await c1.from("chef_private").insert({ chef_id: fx.c1.id }).select(),
    );
    expectDenied(
      await anonClient()
        .from("chefs")
        .insert({ profile_id: fx.c1.id, display_name: "x" })
        .select(),
    );
  });

  it("admin CAN approve and reject chefs (allowed control)", async () => {
    const pending = await makeChef(svc, `to-approve-${rand(2)}`, {
      status: "pending",
    });
    expectRows(
      await admin
        .from("chefs")
        .update({ status: "approved" })
        .eq("profile_id", pending.id)
        .select(),
      1,
    );
    const { data } = await svc
      .from("chefs")
      .select("status")
      .eq("profile_id", pending.id)
      .single();
    expect(data?.status).toBe("approved");
    expectRows(
      await admin
        .from("chef_private")
        .update({ police_check_status: "verified", reject_reason: "n/a" })
        .eq("chef_id", pending.id)
        .select(),
      1,
    );
  });
});

describe("clients cannot forge bookings, claims or server-written rows", () => {
  let c1: SupabaseClient;
  let h1: SupabaseClient;
  beforeAll(async () => {
    [c1, h1] = await Promise.all([fx.c1, fx.h1].map(clientFor));
  });

  it("a customer cannot insert a booking (even one claiming to be free)", async () => {
    const res = await c1
      .from("bookings")
      .insert({
        customer_id: fx.c1.id,
        chef_id: fx.h2.id,
        location_type: "customer_home",
        grocery_option: "customer_buys",
        hourly_rate_cents: 1,
        is_free_trial: true,
      })
      .select();
    expectDenied(res);
    const { data } = await svc
      .from("bookings")
      .select("id")
      .eq("chef_id", fx.h2.id)
      .eq("hourly_rate_cents", 1);
    expect(data).toEqual([]);
  });

  it("neither party can change booking status, price or free-trial flag from the client", async () => {
    expectDenied(
      await h1
        .from("bookings")
        .update({ status: "accepted" })
        .eq("id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("bookings")
        .update({ is_free_trial: true, est_total_cents: 0 })
        .eq("id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1.from("bookings").delete().eq("id", b.requestedC1H1).select(),
    );
    const { data } = await svc
      .from("bookings")
      .select("status,is_free_trial")
      .eq("id", b.requestedC1H1)
      .single();
    expect(data).toEqual({ status: "requested", is_free_trial: false });
  });

  it("cannot write booking days, addresses, intake forms or receipts", async () => {
    expectDenied(
      await c1
        .from("booking_days")
        .insert({
          booking_id: b.requestedC1H1,
          day_number: 2,
          visit_date: dayPlus(fx.baseDay, 8),
        })
        .select(),
    );
    expectDenied(
      await c1
        .from("booking_days")
        .update({ visit_date: dayPlus(fx.baseDay, 9) })
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("booking_addresses")
        .update({ address_line: "elsewhere" })
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("intake_forms")
        .update({ allergies: "" })
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
    expectDenied(
      await c1
        .from("intake_forms")
        .insert({ booking_id: b.requestedC2H2 })
        .select(),
    );
    expectDenied(
      await h1
        .from("receipts")
        .insert({
          booking_id: b.requestedC1H1,
          uploaded_by: fx.h1.id,
          file_path: "x",
          amount_cents: 1,
        })
        .select(),
    );
    expectDenied(
      await h1
        .from("receipts")
        .update({ amount_cents: 1 })
        .eq("booking_id", b.requestedC1H1)
        .select(),
    );
    const { data } = await svc
      .from("intake_forms")
      .select("allergies")
      .eq("booking_id", b.requestedC1H1)
      .single();
    expect(data?.allergies).toBe("peanuts");
  });

  it("cannot forge, edit or release free-trial claims and blocks", async () => {
    expectDenied(
      await c1
        .from("free_trial_claims")
        .insert({
          customer_id: fx.c1.id,
          booking_id: b.acceptedC1H1,
          phone_hash: "x",
          address_hash: "y",
        })
        .select(),
    );
    expectDenied(
      await c1
        .from("free_trial_claims")
        .update({ state: "released" })
        .eq("customer_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("free_trial_claims")
        .delete()
        .eq("customer_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("free_trial_blocks")
        .insert({ customer_id: fx.c1.id, reason: "phone" })
        .select(),
    );
    const { data } = await svc
      .from("free_trial_claims")
      .select("state")
      .eq("customer_id", fx.c1.id)
      .single();
    expect(data?.state).toBe("held");
  });

  it("cannot edit own phone, address or hashes (server-only) and cannot insert profile_private", async () => {
    expectDenied(
      await c1
        .from("profile_private")
        .update({ phone_hash: "forged" })
        .eq("profile_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("profile_private")
        .update({ address_hash: "forged" })
        .eq("profile_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("profile_private")
        .update({ phone_verified: true })
        .eq("profile_id", fx.c1.id)
        .select(),
    );
    const { data } = await svc
      .from("profile_private")
      .select("phone_hash")
      .eq("profile_id", fx.c1.id)
      .single();
    expect(data?.phone_hash).toBe(fx.hashes.c1Phone);
  });

  it("notifications: owner may mark read, nothing else; cannot create or touch others'", async () => {
    expectRows(
      await c1
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", fx.c1.id)
        .select(),
      1,
    );
    expectDenied(
      await c1
        .from("notifications")
        .update({ title: "forged" })
        .eq("user_id", fx.c1.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", fx.c2.id)
        .select(),
    );
    expectDenied(
      await c1
        .from("notifications")
        .insert({ user_id: fx.c1.id, type: "t", title: "forged" })
        .select(),
    );
  });

  it("dishes: a chef manages their own dishes but not another chef's", async () => {
    const mine = await h1
      .from("dishes")
      .insert({
        chef_id: fx.h1.id,
        name: "mine",
        cuisine: "Thai",
        cook_minutes: 20,
      })
      .select();
    expectRows(mine, 1);
    expectDenied(
      await h1
        .from("dishes")
        .insert({
          chef_id: fx.h2.id,
          name: "planted",
          cuisine: "Thai",
          cook_minutes: 20,
        })
        .select(),
    );
    expectDenied(
      await h1
        .from("dishes")
        .update({ name: "defaced" })
        .eq("chef_id", fx.h2.id)
        .select(),
    );
    expectDenied(
      await h1.from("dishes").delete().eq("chef_id", fx.h2.id).select(),
    );
    expectDenied(
      await c1
        .from("dishes")
        .insert({ chef_id: fx.c1.id, name: "x", cuisine: "x", cook_minutes: 1 })
        .select(),
    );
    const { data } = await svc
      .from("dishes")
      .select("name")
      .eq("chef_id", fx.h2.id);
    expect((data ?? []).map((d) => d.name)).not.toEqual(
      expect.arrayContaining(["planted", "defaced"]),
    );
  });

  it("availability: a chef manages their own calendar but not another's", async () => {
    expectRows(
      await h1
        .from("availability")
        .insert({ chef_id: fx.h1.id, day: dayPlus(fx.baseDay, 5) })
        .select(),
      1,
    );
    expectDenied(
      await h1
        .from("availability")
        .insert({ chef_id: fx.h2.id, day: dayPlus(fx.baseDay, 5) })
        .select(),
    );
    expectDenied(
      await h1
        .from("availability")
        .update({ available: false })
        .eq("chef_id", fx.h2.id)
        .select(),
    );
  });

  it("a booking cannot be created for an unapproved chef even by the server path (trigger)", async () => {
    const attempt = makeBooking(svc, {
      customer: { id: fx.c1.id, email: "" },
      chef: fx.hp,
      dates: [dayPlus(fx.baseDay, 6)],
    });
    await expect(attempt).rejects.toThrow(/not approved/);
  });
});
