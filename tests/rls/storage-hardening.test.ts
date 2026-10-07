import { describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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

const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const pdf = () =>
  new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
const up = (
  c: SupabaseClient,
  bucket: string,
  path: string,
  kind: "png" | "pdf" = "png",
) =>
  c.storage.from(bucket).upload(path, kind === "png" ? png() : pdf(), {
    contentType: kind === "png" ? "image/png" : "application/pdf",
  });
async function canDownload(c: SupabaseClient, bucket: string, path: string) {
  const { data, error } = await c.storage.from(bucket).download(path);
  return !error && !!data;
}
async function publicStatus(bucket: string, path: string) {
  const { data } = anonClient().storage.from(bucket).getPublicUrl(path);
  return (await fetch(data.publicUrl)).status;
}

describe("P1: no listing of buckets", () => {
  it("anon cannot list any bucket, even folders that hold objects", async () => {
    const anon = anonClient();
    const targets: [string, string][] = [
      ["chef-documents", fx.h1.id],
      ["receipts", fx.bookings.requestedC1H1],
      ["kitchen-photos", fx.h1.id],
      ["profile-photos", fx.h1.id],
      ["dish-photos", fx.h1.id],
    ];
    for (const [bucket, folder] of targets) {
      const res = await anon.storage.from(bucket).list(folder);
      expect(res.data ?? [], `anon list ${bucket}`).toEqual([]);
      const root = await anon.storage.from(bucket).list("");
      expect(root.data ?? [], `anon list ${bucket} root`).toEqual([]);
    }
  });

  it("only the folder owner and admin can list a public photo folder; another user sees nothing", async () => {
    const [h1, h2, c1, admin] = await Promise.all(
      [fx.h1, fx.h2, fx.c1, fx.admin].map(clientFor),
    );
    for (const bucket of ["profile-photos", "dish-photos"]) {
      expect(
        (await h1.storage.from(bucket).list(fx.h1.id)).data?.length,
        `owner ${bucket}`,
      ).toBeGreaterThan(0);
      expect(
        (await admin.storage.from(bucket).list(fx.h1.id)).data?.length,
        `admin ${bucket}`,
      ).toBeGreaterThan(0);
      expect(
        (await h2.storage.from(bucket).list(fx.h1.id)).data ?? [],
        `other chef ${bucket}`,
      ).toEqual([]);
      expect(
        (await c1.storage.from(bucket).list(fx.h1.id)).data ?? [],
        `customer ${bucket}`,
      ).toEqual([]);
    }
  });

  it("public URLs still work for profile and dish photos", async () => {
    expect(await publicStatus("profile-photos", `${fx.h1.id}/p.png`)).toBe(200);
    expect(await publicStatus("dish-photos", `${fx.h1.id}/d.png`)).toBe(200);
  });
});

describe("P2: kitchen photos are private", () => {
  it("owner and admin can read; strangers, other chefs and anon cannot; the public URL does not work", async () => {
    const [h1, h2, c1, c2, admin] = await Promise.all(
      [fx.h1, fx.h2, fx.c1, fx.c2, fx.admin].map(clientFor),
    );
    const path = `${fx.h1.id}/k.png`;
    expect(await canDownload(h1, "kitchen-photos", path)).toBe(true);
    expect(await canDownload(admin, "kitchen-photos", path)).toBe(true);
    expect(await canDownload(c1, "kitchen-photos", path)).toBe(true); // accepted chef_home booking with h1 (fixture)
    expect(await canDownload(c2, "kitchen-photos", path)).toBe(false);
    expect(await canDownload(h2, "kitchen-photos", path)).toBe(false);
    expect(await canDownload(anonClient(), "kitchen-photos", path)).toBe(false);
    expect(await publicStatus("kitchen-photos", path)).not.toBe(200);
    // c1 has no chef_home booking with h2, so h2's kitchen stays hidden from c1
    expect(await canDownload(c1, "kitchen-photos", `${fx.h2.id}/k.png`)).toBe(
      false,
    );
    expect(await canDownload(h2, "kitchen-photos", `${fx.h2.id}/k.png`)).toBe(
      true,
    );
  });

  it("a customer sees the kitchen only for an accepted or completed chef_home booking", async () => {
    const chef = await makeChef(svc, "kp-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const path = `${chef.id}/k.png`;
    expect((await up(svc, "kitchen-photos", path)).error).toBeNull();
    const day = (n: number) => dayPlus(fx.baseDay, 100 + n);
    const cases: [string, string, "customer_home" | "chef_home", boolean][] = [
      ["requested chef_home", "requested", "chef_home", false],
      ["declined chef_home", "declined", "chef_home", false],
      ["accepted customer_home", "accepted", "customer_home", false],
      ["accepted chef_home", "accepted", "chef_home", true],
      ["completed chef_home", "completed", "chef_home", true],
    ];
    for (const [i, [label, status, location, allowed]] of cases.entries()) {
      const cust = await makeCustomer(svc, `kp-${i}`);
      await makeBooking(svc, {
        customer: cust,
        chef,
        dates: [day(i)],
        status,
        location,
      });
      expect(
        await canDownload(await clientFor(cust), "kitchen-photos", path),
        label,
      ).toBe(allowed);
    }
    const nobody = await makeCustomer(svc, "kp-none");
    expect(
      await canDownload(await clientFor(nobody), "kitchen-photos", path),
    ).toBe(false);
  });
});

describe("P3: who may upload where", () => {
  it("a customer cannot upload to chef-documents, kitchen-photos or dish-photos, even in their own folder", async () => {
    const c1 = await clientFor(fx.c1);
    expect(
      (await up(c1, "chef-documents", `${fx.c1.id}/x-${rand(3)}.pdf`, "pdf"))
        .error,
    ).not.toBeNull();
    expect(
      (await up(c1, "kitchen-photos", `${fx.c1.id}/x-${rand(3)}.png`)).error,
    ).not.toBeNull();
    expect(
      (await up(c1, "dish-photos", `${fx.c1.id}/x-${rand(3)}.png`)).error,
    ).not.toBeNull();
  });

  it("a customer can upload their own profile photo, but not into someone else's folder", async () => {
    const c1 = await clientFor(fx.c1);
    expect(
      (await up(c1, "profile-photos", `${fx.c1.id}/me-${rand(3)}.png`)).error,
    ).toBeNull();
    expect(
      (await up(c1, "profile-photos", `${fx.h1.id}/me-${rand(3)}.png`)).error,
    ).not.toBeNull();
  });

  it("a chef can upload to chef-documents, kitchen-photos and dish-photos in their own folder only", async () => {
    const h1 = await clientFor(fx.h1);
    expect(
      (await up(h1, "chef-documents", `${fx.h1.id}/ok-${rand(3)}.pdf`, "pdf"))
        .error,
    ).toBeNull();
    expect(
      (await up(h1, "kitchen-photos", `${fx.h1.id}/ok-${rand(3)}.png`)).error,
    ).toBeNull();
    expect(
      (await up(h1, "dish-photos", `${fx.h1.id}/ok-${rand(3)}.png`)).error,
    ).toBeNull();
    expect(
      (await up(h1, "kitchen-photos", `${fx.h2.id}/bad-${rand(3)}.png`)).error,
    ).not.toBeNull();
    expect(
      (await up(h1, "dish-photos", `${fx.h2.id}/bad-${rand(3)}.png`)).error,
    ).not.toBeNull();
  });

  it("another chef cannot overwrite or delete a kitchen photo", async () => {
    const h2 = await clientFor(fx.h2);
    const del = await h2.storage
      .from("kitchen-photos")
      .remove([`${fx.h1.id}/k.png`]);
    expect(del.data ?? []).toEqual([]);
    expect(
      await canDownload(
        await clientFor(fx.h1),
        "kitchen-photos",
        `${fx.h1.id}/k.png`,
      ),
    ).toBe(true);
  });
});
