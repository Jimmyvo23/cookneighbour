import type { TestProject } from "vitest/node";
import {
  dayPlus,
  fakePhone,
  makeBooking,
  makeChef,
  makeCustomer,
  makeUser,
  rand,
  serviceClient,
  setPrivate,
  type Fixtures,
} from "./helpers";

declare module "vitest" {
  export interface ProvidedContext {
    fx: Fixtures;
  }
}

function check(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`fixture ${what}: ${res.error.message}`);
}

// Builds the shared cast once. Everything is created through the service client (what the
// Next.js server does); the tests then act as each user through RLS.
export default async function setup(project: TestProject) {
  const svc = serviceClient();
  const today = new Date();
  // Random far-future base so re-runs on the same database never collide on chef+date.
  const offset = 40 + Math.floor(Math.random() * 600);
  const baseDay = dayPlus(today.toISOString().slice(0, 10), offset);

  const admin = await makeUser(svc, "admin", "admin");
  const c1 = await makeCustomer(svc, "customer-one");
  const c2 = await makeCustomer(svc, "customer-two");
  const h1 = await makeChef(svc, "chef-one", {
    status: "approved",
    options: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
  });
  const h2 = await makeChef(svc, "chef-two", {
    status: "approved",
    options: ["customer_home"],
  });
  const hp = await makeChef(svc, "chef-pending", { status: "pending" });
  const hr = await makeChef(svc, "chef-rejected", { status: "rejected" });

  const phones = { c1: fakePhone(), h1: fakePhone() };
  const addresses = { c1: "1 Secret Home Street", kitchen: "12 Kitchen Lane" };
  const hashes = { c1Phone: `ph-${rand()}`, c1Address: `ah-${rand()}` };
  await setPrivate(svc, c1.id, {
    phone_e164: phones.c1,
    phone_hash: hashes.c1Phone,
    address_line: addresses.c1,
    city: "Mississauga",
    postal_code: "L5B1A1",
    postal_prefix: "L5B",
    address_hash: hashes.c1Address,
  });
  await setPrivate(svc, h1.id, {
    phone_e164: phones.h1,
    phone_hash: `ph-${rand()}`,
  });

  // dishes + availability for every chef (pending and rejected included)
  const dishIds: Record<string, string> = {};
  for (const [key, chef] of [
    ["h1", h1],
    ["h2", h2],
    ["hp", hp],
    ["hr", hr],
  ] as const) {
    const { data, error } = await svc
      .from("dishes")
      .insert({
        chef_id: chef.id,
        name: `dish of ${key}`,
        cuisine: "Vietnamese",
        cook_minutes: 60,
      })
      .select("id")
      .single();
    if (error || !data)
      throw new Error(`fixture dish ${key}: ${error?.message}`);
    dishIds[key] = data.id as string;
    check(
      await svc.from("availability").insert({ chef_id: chef.id, day: baseDay }),
      `availability ${key}`,
    );
  }

  const requestedC1H1 = await makeBooking(svc, {
    customer: c1,
    chef: h1,
    dates: [dayPlus(baseDay, 0)],
  });
  const acceptedC1H1 = await makeBooking(svc, {
    customer: c1,
    chef: h1,
    dates: [dayPlus(baseDay, 1)],
    status: "accepted",
  });
  const acceptedChefHomeC1H1 = await makeBooking(svc, {
    customer: c1,
    chef: h1,
    dates: [dayPlus(baseDay, 2)],
    status: "accepted",
    location: "chef_home",
  });
  const requestedC2H2 = await makeBooking(svc, {
    customer: c2,
    chef: h2,
    dates: [dayPlus(baseDay, 0)],
  });
  const declinedC1H1 = await makeBooking(svc, {
    customer: c1,
    chef: h1,
    dates: [dayPlus(baseDay, 3)],
    status: "declined",
  });
  const completedC1H1 = await makeBooking(svc, {
    customer: c1,
    chef: h1,
    dates: [dayPlus(baseDay, 4)],
    status: "completed",
  });

  for (const b of [requestedC1H1, acceptedC1H1, declinedC1H1]) {
    check(
      await svc.from("booking_addresses").insert({
        booking_id: b.id,
        address_line: addresses.c1,
        city: "Mississauga",
        postal_code: "L5B1A1",
      }),
      "booking_addresses",
    );
  }
  for (const b of [requestedC1H1, acceptedC1H1, requestedC2H2]) {
    check(
      await svc.from("intake_forms").insert({
        booking_id: b.id,
        allergies: "peanuts",
        dietary_notes: "halal",
      }),
      "intake",
    );
    check(
      await svc.from("messages").insert({
        booking_id: b.id,
        sender_id: b === requestedC2H2 ? c2.id : c1.id,
        body: `hello on ${b.id}`,
      }),
      "message",
    );
    check(
      await svc.from("receipts").insert({
        booking_id: b.id,
        uploaded_by: b === requestedC2H2 ? h2.id : h1.id,
        file_path: `${b.id}/r.png`,
        amount_cents: 1234,
      }),
      "receipt",
    );
  }
  check(
    await svc.from("booking_day_dishes").insert({
      booking_day_id: requestedC1H1.dayIds[0],
      dish_id: dishIds.h1,
      dish_name: "dish of h1",
      cook_minutes: 60,
      eat_by_date: dayPlus(baseDay, 2),
    }),
    "booking_day_dishes",
  );

  check(
    await svc.from("free_trial_claims").insert({
      customer_id: c1.id,
      booking_id: requestedC1H1.id,
      phone_hash: hashes.c1Phone,
      address_hash: hashes.c1Address,
    }),
    "claim c1",
  );
  check(
    await svc.from("free_trial_claims").insert({
      customer_id: c2.id,
      booking_id: requestedC2H2.id,
      phone_hash: `ph-${rand()}`,
      address_hash: `ah-${rand()}`,
    }),
    "claim c2",
  );
  check(
    await svc
      .from("free_trial_blocks")
      .insert({ customer_id: c2.id, reason: "phone" }),
    "block",
  );
  for (const [u, t] of [
    [c1, "for c1"],
    [c2, "for c2"],
  ] as const) {
    check(
      await svc
        .from("notifications")
        .insert({ user_id: u.id, type: "test", title: t }),
      "notification",
    );
  }

  // storage fixtures
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70])], {
    type: "application/pdf",
  });
  for (const [bucket, path, body, type] of [
    ["chef-documents", `${h1.id}/id.pdf`, pdf, "application/pdf"],
    ["chef-documents", `${hp.id}/id.pdf`, pdf, "application/pdf"],
    ["receipts", `${requestedC1H1.id}/r.png`, png, "image/png"],
    ["receipts", `${requestedC2H2.id}/r.png`, png, "image/png"],
    ["profile-photos", `${h1.id}/p.png`, png, "image/png"],
    ["dish-photos", `${h1.id}/d.png`, png, "image/png"],
    ["kitchen-photos", `${h1.id}/k.png`, png, "image/png"],
    ["kitchen-photos", `${h2.id}/k.png`, png, "image/png"],
  ] as const) {
    const { error } = await svc.storage
      .from(bucket)
      .upload(path, body, { contentType: type, upsert: true });
    if (error)
      throw new Error(`fixture storage ${bucket}/${path}: ${error.message}`);
  }

  project.provide("fx", {
    baseDay,
    admin,
    c1,
    c2,
    h1,
    h2,
    hp,
    hr,
    phones,
    addresses,
    hashes,
    bookings: {
      requestedC1H1: requestedC1H1.id,
      acceptedC1H1: acceptedC1H1.id,
      acceptedChefHomeC1H1: acceptedChefHomeC1H1.id,
      requestedC2H2: requestedC2H2.id,
      declinedC1H1: declinedC1H1.id,
      completedC1H1: completedC1H1.id,
    },
    approvedDishId: dishIds.h1,
    pendingDishId: dishIds.hp,
    rejectedDishId: dishIds.hr,
  });
}
