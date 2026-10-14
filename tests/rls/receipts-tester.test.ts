// T-044 Tester: storage privacy for receipts (no read of another booking's receipts, no upload into
// someone else's booking folder). Runs in CI against the local Supabase.
import { randomUUID } from "node:crypto";
import { describe, expect, inject, it } from "vitest";
import {
  anonClient,
  clientFor,
  dayPlus,
  makeBooking,
  makeChef,
  makeCustomer,
  rand,
  serviceClient,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const todayTo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
}).format(new Date());
const far = (n: number) => dayPlus(todayTo, 60 + n);
const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("receipts bucket privacy", () => {
  it("only the two parties and admin can read a receipt object; others and anon cannot; nobody else uploads into the folder", async () => {
    const chef = await makeChef(svc, "rt-chef");
    const cust = await makeCustomer(svc, "rt-cust");
    const chef2 = await makeChef(svc, "rt-chef2");
    const cust2 = await makeCustomer(svc, "rt-cust2");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(1)],
      status: "accepted",
    });
    await svc
      .from("bookings")
      .update({ grocery_option: "chef_shops", est_ingredients_cents: 2500 })
      .eq("id", b.id);
    const path = `${b.id}/r-${rand(4)}.png`;
    const mine = await clientFor(chef);
    expect(
      (
        await mine.storage
          .from("receipts")
          .upload(path, png(), { contentType: "image/png" })
      ).error,
    ).toBeNull();

    const parties = await Promise.all(
      [chef, cust, fx.admin].map((p) => clientFor(p)),
    );
    for (const c of parties) {
      const s = await c.storage.from("receipts").createSignedUrl(path, 60);
      expect(s.error).toBeNull();
      expect(s.data?.signedUrl).toBeTruthy();
      const d = await c.storage.from("receipts").download(path);
      expect(d.error).toBeNull();
    }
    const outsiders = [
      await clientFor(chef2),
      await clientFor(cust2),
      anonClient(),
    ];
    for (const c of outsiders) {
      const s = await c.storage.from("receipts").createSignedUrl(path, 60);
      expect(s.data?.signedUrl ?? null).toBeNull();
      const d = await c.storage.from("receipts").download(path);
      expect(d.data).toBeNull();
      const l = await c.storage.from("receipts").list(b.id);
      expect(l.data ?? []).toEqual([]);
      const up = await c.storage
        .from("receipts")
        .upload(`${b.id}/x-${rand(4)}.png`, png(), {
          contentType: "image/png",
        });
      expect(up.error).not.toBeNull();
    }
    // The customer (a party) still cannot upload; the public URL form does not work either.
    const cc = parties[1];
    expect(
      (
        await cc.storage
          .from("receipts")
          .upload(`${b.id}/c-${rand(4)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
    const pub = svc.storage.from("receipts").getPublicUrl(path).data.publicUrl;
    expect((await fetch(pub)).status).toBeGreaterThanOrEqual(400);
  });

  it("a chef cannot upload into a booking folder that is not theirs, nor a made-up folder", async () => {
    const chef = await makeChef(svc, "rt2-chef");
    const chef2 = await makeChef(svc, "rt2-chef2");
    const cust = await makeCustomer(svc, "rt2-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [far(2)],
      status: "accepted",
    });
    const other = await clientFor(chef2);
    for (const folder of [b.id, randomUUID(), "not-a-uuid", "", chef2.id]) {
      const r = await other.storage
        .from("receipts")
        .upload(`${folder}/r-${rand(4)}.png`, png(), {
          contentType: "image/png",
        });
      expect(r.error, folder).not.toBeNull();
    }
  });
});
