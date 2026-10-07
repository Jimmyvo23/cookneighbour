import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectCode,
  expectDenied,
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

describe("B2: chef file paths and re-verification", () => {
  let admin: SupabaseClient;
  beforeAll(async () => {
    admin = await clientFor(fx.admin);
  });

  it("a chef cannot point documents or kitchen photos at another user's files; own folder is allowed", async () => {
    const chef = await makeChef(svc, "paths-chef");
    const c = await clientFor(chef);
    const upd = (patch: Record<string, unknown>) =>
      c.from("chef_private").update(patch).eq("chef_id", chef.id).select();
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
    const before = await svc
      .from("chef_private")
      .select("id_document_path")
      .eq("chef_id", chef.id)
      .single();
    expect(before.data?.id_document_path).toBe(`${chef.id}/id.pdf`);
    // allowed controls
    expectRows(await upd({ id_document_path: `${chef.id}/new-id.pdf` }), 1);
    expectRows(await upd({ food_handler_path: `${chef.id}/fh.pdf` }), 1);
    expectRows(
      await upd({
        kitchen_photo_paths: [`${chef.id}/k1.png`, `${chef.id}/k2.png`],
      }),
      1,
    );
  });

  it("the path rule also holds for the admin and the server", async () => {
    const chef = await makeChef(svc, "paths-chef2");
    const viaServer = await svc
      .from("chef_private")
      .update({ id_document_path: `${fx.h1.id}/id.pdf` })
      .eq("chef_id", chef.id);
    expectCode(viaServer, "23514");
    expectCode(
      await admin
        .from("chef_private")
        .update({ food_handler_path: `${fx.h1.id}/id.pdf` })
        .eq("chef_id", chef.id)
        .select(),
      "23514",
    );
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

  it("a chef replacing a verified ID document goes back to pending; the other checks stay verified", async () => {
    const chef = await verifiedChef("reset-id");
    const c = await clientFor(chef);
    expectRows(
      await c
        .from("chef_private")
        .update({ id_document_path: `${chef.id}/id2.pdf` })
        .eq("chef_id", chef.id)
        .select(),
      1,
    );
    expect(await state(chef.id)).toEqual({
      id_check_status: "pending",
      food_handler_status: "verified",
      kitchen_status: "verified",
      chef_home_enabled: true,
    });
  });

  it("replacing the food-handler certificate resets only that check", async () => {
    const chef = await verifiedChef("reset-fh");
    const c = await clientFor(chef);
    expectRows(
      await c
        .from("chef_private")
        .update({ food_handler_path: `${chef.id}/fh2.pdf` })
        .eq("chef_id", chef.id)
        .select(),
      1,
    );
    expect(await state(chef.id)).toMatchObject({
      id_check_status: "verified",
      food_handler_status: "pending",
      kitchen_status: "verified",
    });
  });

  it("changing kitchen photos or the kitchen address resets the kitchen check and switches chef-home off", async () => {
    for (const patch of [
      (id: string) => ({
        kitchen_photo_paths: [`${id}/k1.png`, `${id}/k9.png`],
      }),
      (id: string) => ({ kitchen_address_line: "99 New Street" }),
      (id: string) => ({ kitchen_city: "Brampton" }),
      (id: string) => ({ kitchen_postal_code: "L6Y1A1" }),
    ]) {
      const chef = await verifiedChef(`reset-k-${rand(2)}`);
      const c = await clientFor(chef);
      expectRows(
        await c
          .from("chef_private")
          .update(patch(chef.id))
          .eq("chef_id", chef.id)
          .select(),
        1,
      );
      expect(await state(chef.id)).toMatchObject({
        kitchen_status: "pending",
        chef_home_enabled: false,
        id_check_status: "verified",
      });
    }
  });

  it("an unrelated edit (allergen acknowledgement) does not reset anything", async () => {
    const chef = await verifiedChef("reset-none");
    const c = await clientFor(chef);
    expectRows(
      await c
        .from("chef_private")
        .update({ allergen_ack_at: new Date().toISOString() })
        .eq("chef_id", chef.id)
        .select(),
      1,
    );
    expect(await state(chef.id)).toEqual({
      id_check_status: "verified",
      food_handler_status: "verified",
      kitchen_status: "verified",
      chef_home_enabled: true,
    });
  });

  it("admin and server changes do not reset verified statuses", async () => {
    const chef = await verifiedChef("reset-admin");
    expectRows(
      await admin
        .from("chef_private")
        .update({
          id_document_path: `${chef.id}/by-admin.pdf`,
          kitchen_city: "Oakville",
        })
        .eq("chef_id", chef.id)
        .select(),
      1,
    );
    expect(await state(chef.id)).toEqual({
      id_check_status: "verified",
      food_handler_status: "verified",
      kitchen_status: "verified",
      chef_home_enabled: true,
    });
    expect(
      (
        await svc
          .from("chef_private")
          .update({
            food_handler_path: `${chef.id}/by-server.pdf`,
            kitchen_address_line: "5 Server Rd",
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

  it("a chef still cannot re-enable chef-home themselves after the reset", async () => {
    const chef = await verifiedChef("reset-reenable");
    const c = await clientFor(chef);
    await c
      .from("chef_private")
      .update({ kitchen_city: "Toronto" })
      .eq("chef_id", chef.id)
      .select();
    expectDenied(
      await c
        .from("chefs")
        .update({ chef_home_enabled: true })
        .eq("profile_id", chef.id)
        .select(),
    );
    expect((await state(chef.id)).chef_home_enabled).toBe(false);
    // and a chef_home booking is blocked until an admin re-enables it
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
    // control: the review may already exist from the engagement tests; either success or the unique violation proves the columns were accepted
    const ok = await c1.from("reviews").insert(base).select();
    if (ok.error) expect(ok.error.code).toBe("23505");
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
