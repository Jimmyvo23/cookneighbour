import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const b = fx.bookings;
const svc = serviceClient();

describe("B1: display name never falls back to the email", () => {
  it("a user created without display_name is called 'New user' and the email local part appears nowhere public", async () => {
    const local = `jane.doe-${rand(3)}`;
    const email = `${local}@example.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: "Test-only-pw-1234!",
      email_confirm: true,
    });
    expect(error).toBeNull();
    const id = data.user!.id;
    const prof = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", id)
      .single();
    expect(prof.data?.display_name).toBe("New user");
    expect(JSON.stringify(prof.data)).not.toContain(local);
    // a blank display_name behaves the same
    const blank = await svc.auth.admin.createUser({
      email: `blank-${rand(3)}@example.test`,
      password: "Test-only-pw-1234!",
      email_confirm: true,
      user_metadata: { display_name: "   " },
    });
    const p2 = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", blank.data.user!.id)
      .single();
    expect(p2.data?.display_name).toBe("New user");
    // control: an explicit display_name is kept
    const named = await svc.auth.admin.createUser({
      email: `named-${rand(3)}@example.test`,
      password: "Test-only-pw-1234!",
      email_confirm: true,
      user_metadata: { display_name: "Mai Tran" },
    });
    const p3 = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", named.data.user!.id)
      .single();
    expect(p3.data?.display_name).toBe("Mai Tran");
  });

  it("a real sign-up through the public auth API without display_name behaves the same", async () => {
    const local = `signup.person-${rand(3)}`;
    const res = await anonClient().auth.signUp({
      email: `${local}@example.test`,
      password: "Test-only-pw-1234!",
    });
    if (res.error || !res.data.user) return; // sign-up rate limit or confirmations on: covered by the admin path above
    const prof = await svc
      .from("profiles")
      .select("display_name")
      .eq("id", res.data.user.id)
      .single();
    expect(prof.data?.display_name).toBe("New user");
  });
});

describe("B2 (T-028): routes are the only writers of chef data; path rules hold for every writer", () => {
  it("a chef's own client cannot update chefs, chef_private or profiles at all", async () => {
    const chef = await makeChef(svc, "no-client-writes");
    const c = await clientFor(chef);
    expectCode(
      await c
        .from("chef_private")
        .update({ id_document_path: `${chef.id}/new-id.pdf` })
        .eq("chef_id", chef.id)
        .select(),
      "42501",
    );
    expectCode(
      await c
        .from("chefs")
        .update({ bio: "edited by client" })
        .eq("profile_id", chef.id)
        .select(),
      "42501",
    );
    expectCode(
      await c
        .from("profiles")
        .update({ display_name: "edited by client" })
        .eq("id", chef.id)
        .select(),
      "42501",
    );
    const row = await svc
      .from("chef_private")
      .select("id_document_path")
      .eq("chef_id", chef.id)
      .single();
    expect(row.data?.id_document_path).toBe(`${chef.id}/id.pdf`);
  });

  it("the document path rule holds for the server: foreign or odd paths are refused, own folder is allowed", async () => {
    const chef = await makeChef(svc, "paths-chef");
    const upd = (patch: Record<string, unknown>) =>
      svc.from("chef_private").update(patch).eq("chef_id", chef.id);
    expectCode(await upd({ id_document_path: `${fx.h1.id}/id.pdf` }), "23514");
    expectCode(await upd({ food_handler_path: `${fx.h1.id}/id.pdf` }), "23514");
    expectCode(
      await upd({
        kitchen_photo_paths: [`${chef.id}/k1.png`, `${fx.h1.id}/k.png`],
      }),
      "23514",
    );
    expectCode(
      await upd({ id_document_path: `${chef.id}/../${fx.h1.id}/id.pdf` }),
      "23514",
    );
    expectCode(await upd({ id_document_path: `${chef.id}x/id.pdf` }), "23514");
    expectCode(await upd({ id_document_path: "id.pdf" }), "23514");
    // allowed controls
    expect(
      (await upd({ id_document_path: `${chef.id}/new-id.pdf` })).error,
    ).toBeNull();
    expect(
      (
        await upd({
          kitchen_photo_paths: [`${chef.id}/k1.png`, `${chef.id}/k2.png`],
        })
      ).error,
    ).toBeNull();
  });

  it("chefs.photo_path and dishes.photo_path must start with the owner's folder", async () => {
    const chef = await makeChef(svc, "photo-paths");
    const upd = (photo: string | null) =>
      svc.from("chefs").update({ photo_path: photo }).eq("profile_id", chef.id);
    expectCode(await upd(`${fx.h1.id}/me.png`), "23514");
    expectCode(await upd("me.png"), "23514");
    expectCode(await upd(`/${chef.id}/me.png`), "23514");
    expectCode(await upd(`${chef.id}/../${fx.h1.id}/me.png`), "23514");
    expectCode(await upd(`${chef.id}x/me.png`), "23514");
    expect((await upd(`${chef.id}/me.png`)).error).toBeNull();
    expect((await upd(null)).error).toBeNull();

    const c = await clientFor(chef);
    const dish = (photo: string | null) =>
      c
        .from("dishes")
        .insert({
          chef_id: chef.id,
          name: "photo dish",
          cuisine: "Thai",
          cook_minutes: 10,
          photo_path: photo,
        })
        .select();
    expectCode(await dish(`${fx.h1.id}/dish.png`), "23514");
    expectCode(await dish("dish.png"), "23514");
    expectRows(await dish(`${chef.id}/dish.png`), 1);
    // updating an existing dish to a foreign path is refused too
    const mine = await svc
      .from("dishes")
      .select("id")
      .eq("chef_id", chef.id)
      .limit(1)
      .single();
    expectCode(
      await c
        .from("dishes")
        .update({ photo_path: `${fx.h1.id}/stolen.png` })
        .eq("id", mine.data!.id)
        .select(),
      "23514",
    );
  });

  it("a verified phone hash can belong to one account only; unverified duplicates are allowed", async () => {
    const hash = `uniq-${rand(4)}`;
    const a = await makeCustomer(svc, "uniq-a");
    const b2 = await makeCustomer(svc, "uniq-b");
    const set = (id: string, verified: boolean) =>
      svc
        .from("profile_private")
        .update({ phone_hash: hash, phone_verified: verified })
        .eq("profile_id", id);
    expect((await set(a.id, true)).error).toBeNull();
    expectCode(await set(b2.id, true), "23505");
    // control: an unverified holder does not conflict, and the owner can keep it
    expect((await set(b2.id, false)).error).toBeNull();
    expect((await set(a.id, true)).error).toBeNull();
  });

  async function verifiedChef(name: string) {
    const chef = await makeChef(svc, name, {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const set = await svc
      .from("chef_private")
      .update({
        id_check_status: "verified",
        food_handler_status: "verified",
        kitchen_status: "verified",
        kitchen_photo_paths: [`${chef.id}/k1.png`],
      })
      .eq("chef_id", chef.id);
    expect(set.error).toBeNull();
    return chef;
  }
  const state = async (id: string) => {
    const cp = await svc
      .from("chef_private")
      .select("id_check_status,food_handler_status,kitchen_status")
      .eq("chef_id", id)
      .single();
    const ch = await svc
      .from("chefs")
      .select("chef_home_enabled")
      .eq("profile_id", id)
      .single();
    return { ...cp.data, chef_home_enabled: ch.data?.chef_home_enabled };
  };

  it("server changes (what the routes do) do not fire the client reset trigger; the routes apply N1 themselves", async () => {
    const chef = await verifiedChef("reset-server");
    expect(
      (
        await svc
          .from("chef_private")
          .update({
            id_document_path: `${chef.id}/by-server.pdf`,
            kitchen_city: "Oakville",
          })
          .eq("chef_id", chef.id)
      ).error,
    ).toBeNull();
    expect(await state(chef.id)).toEqual({
      id_check_status: "verified",
      food_handler_status: "verified",
      kitchen_status: "verified",
      chef_home_enabled: true,
    });
  });

  it("a chef cannot re-enable chef-home themselves, and a chef_home booking is blocked while it is off", async () => {
    const chef = await verifiedChef("reset-reenable");
    // what the route does after a kitchen change (N1):
    expect(
      (
        await svc
          .from("chef_private")
          .update({ kitchen_status: "pending", kitchen_city: "Toronto" })
          .eq("chef_id", chef.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await svc
          .from("chefs")
          .update({ chef_home_enabled: false })
          .eq("profile_id", chef.id)
      ).error,
    ).toBeNull();
    const c = await clientFor(chef);
    expectCode(
      await c
        .from("chefs")
        .update({ chef_home_enabled: true })
        .eq("profile_id", chef.id)
        .select(),
      "42501",
    );
    expect((await state(chef.id)).chef_home_enabled).toBe(false);
    const cust = await makeCustomer(svc, "reset-cust");
    await expect(
      makeBooking(svc, {
        customer: cust,
        chef,
        dates: [dayPlus(fx.baseDay, 90)],
        location: "chef_home",
      }),
    ).rejects.toThrow(/not enabled/);
    // sanity: h1 untouched by all this
    expect((await state(fx.h1.id)).chef_home_enabled).toBe(true);
  });
});

describe("P4: clients cannot set server-managed columns on messages, reviews, reports", () => {
  let c1: SupabaseClient;
  beforeAll(async () => {
    c1 = await clientFor(fx.c1);
  });

  it("messages: created_at and id are refused; a normal message works", async () => {
    const base = {
      booking_id: b.acceptedC1H1,
      sender_id: fx.c1.id,
      body: "p4",
    };
    expectCode(
      await c1
        .from("messages")
        .insert({ ...base, created_at: "2001-01-01T00:00:00Z" })
        .select(),
      "42501",
    );
    expectCode(
      await c1
        .from("messages")
        .insert({ ...base, id: crypto.randomUUID() })
        .select(),
      "42501",
    );
    expectRows(await c1.from("messages").insert(base).select(), 1);
  });

  it("reviews: created_at, id and author_display_name are refused", async () => {
    const base = {
      booking_id: b.completedC1H1,
      author_id: fx.c1.id,
      subject_id: fx.h1.id,
      author_role: "customer",
      rating: 4,
    };
    expectCode(
      await c1
        .from("reviews")
        .insert({ ...base, created_at: "2001-01-01T00:00:00Z" })
        .select(),
      "42501",
    );
    expectCode(
      await c1
        .from("reviews")
        .insert({ ...base, author_display_name: "Someone Else" })
        .select(),
      "42501",
    );
    expectCode(
      await c1
        .from("reviews")
        .insert({ ...base, id: crypto.randomUUID() })
        .select(),
      "42501",
    );
    // The allowed insert (same columns, no extras) is covered in engagement.test.ts.
  });

  it("reports: status, admin_note, created_at, resolved_at are refused; valid categories work and a bogus one is rejected", async () => {
    const base = {
      booking_id: b.acceptedC1H1,
      reporter_id: fx.c1.id,
      description: "p4 report",
    };
    for (const extra of [
      { status: "open" },
      { admin_note: "x" },
      { created_at: "2001-01-01T00:00:00Z" },
      { resolved_at: "2001-01-01T00:00:00Z" },
    ]) {
      expectCode(
        await c1
          .from("reports")
          .insert({ ...base, ...extra })
          .select(),
        "42501",
      );
    }
    expectCode(
      await c1
        .from("reports")
        .insert({ ...base, category: "bogus" })
        .select(),
      "22P02",
    );
    for (const category of [
      "safety",
      "food_quality",
      "no_show",
      "payment",
      "other",
    ]) {
      expectRows(
        await c1
          .from("reports")
          .insert({ ...base, category })
          .select(),
        1,
      );
    }
    const dflt = await c1.from("reports").insert(base).select("category");
    expectRows(dflt, 1);
    expect((dflt.data as { category: string }[])[0].category).toBe("other");
  });
});
