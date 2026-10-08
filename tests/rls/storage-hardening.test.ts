import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  localEnv,
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

describe("F3 (T-031): kitchen photos are insert-only for the chef", () => {
  // png() is 4 bytes, so a 9-byte body is easy to tell apart.
  const bigger = () =>
    new Blob([new Uint8Array(9).fill(7)], { type: "image/png" });
  async function sizeOf(bucket: string, path: string): Promise<number> {
    const { data, error } = await svc.storage.from(bucket).download(path);
    expect(error, `${bucket}/${path}`).toBeNull();
    return data!.size;
  }

  it("the policies on kitchen-photos are exactly: chef insert, owner/admin/customer read, admin delete", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      const res = await client.query(
        `select policyname, cmd from pg_policies
          where schemaname = 'storage' and tablename = 'objects' and policyname like 'kitchen_photos%'
          order by policyname`,
      );
      expect(res.rows).toEqual([
        { policyname: "kitchen_photos_delete_admin", cmd: "DELETE" },
        { policyname: "kitchen_photos_insert_own", cmd: "INSERT" },
        { policyname: "kitchen_photos_select_admin", cmd: "SELECT" },
        { policyname: "kitchen_photos_select_customer", cmd: "SELECT" },
        { policyname: "kitchen_photos_select_own", cmd: "SELECT" },
      ]);
    } finally {
      await client.end();
    }
  });

  it("a chef can add a new kitchen photo and read it back, but cannot overwrite it in place", async () => {
    const h1 = await clientFor(fx.h1);
    const name = `${fx.h1.id}/f3-${rand(4)}.png`;
    expect((await up(h1, "kitchen-photos", name)).error).toBeNull(); // allowed: a new name
    expect(await canDownload(h1, "kitchen-photos", name)).toBe(true);
    const bucket = h1.storage.from("kitchen-photos");
    const asUpsert = await bucket.upload(name, bigger(), {
      contentType: "image/png",
      upsert: true,
    });
    expect(asUpsert.error).not.toBeNull();
    const asUpdate = await bucket.update(name, bigger(), {
      contentType: "image/png",
    });
    expect(asUpdate.error).not.toBeNull();
    const asInsert = await bucket.upload(name, bigger(), {
      contentType: "image/png",
    });
    expect(asInsert.error).not.toBeNull(); // the name is taken
    expect(await sizeOf("kitchen-photos", name)).toBe(4); // still the original picture
  });

  it("the owner cannot delete a kitchen photo; the admin can", async () => {
    const h1 = await clientFor(fx.h1);
    const admin = await clientFor(fx.admin);
    const name = `${fx.h1.id}/f3-del-${rand(4)}.png`;
    expect((await up(h1, "kitchen-photos", name)).error).toBeNull();
    const del = await h1.storage.from("kitchen-photos").remove([name]);
    expect(del.data ?? []).toEqual([]); // nothing removed
    expect(await sizeOf("kitchen-photos", name)).toBe(4);
    const adminDel = await admin.storage.from("kitchen-photos").remove([name]);
    expect((adminDel.data ?? []).length).toBe(1);
    expect(await canDownload(admin, "kitchen-photos", name)).toBe(false);
  });

  it("the service role (the chef routes) can still delete one", async () => {
    const h1 = await clientFor(fx.h1);
    const name = `${fx.h1.id}/f3-svc-${rand(4)}.png`;
    expect((await up(h1, "kitchen-photos", name)).error).toBeNull();
    const del = await svc.storage.from("kitchen-photos").remove([name]);
    expect(del.error).toBeNull();
    expect((del.data ?? []).length).toBe(1);
  });

  it("a chef still cannot write into another chef's kitchen folder", async () => {
    const h2 = await clientFor(fx.h2);
    const name = `${fx.h1.id}/f3-evil-${rand(4)}.png`;
    expect((await up(h2, "kitchen-photos", name)).error).not.toBeNull();
  });

  it("DECISION: profile-photos and dish-photos stay owner-writable (no verified check depends on them)", async () => {
    // Pinned on purpose; T-032 moved the dish rows to routes but kept this decision. See docs/data-model.md, Storage.
    const h1 = await clientFor(fx.h1);
    for (const bucket of ["profile-photos", "dish-photos"]) {
      const name = `${fx.h1.id}/f3-${rand(4)}.png`;
      expect((await up(h1, bucket, name)).error, bucket).toBeNull();
      const over = await h1.storage.from(bucket).upload(name, bigger(), {
        contentType: "image/png",
        upsert: true,
      });
      expect(over.error, `${bucket} overwrite`).toBeNull();
      expect(await sizeOf(bucket, name)).toBe(9);
      await h1.storage.from(bucket).remove([name]);
      expect(await canDownload(svc, bucket, name), `${bucket} delete`).toBe(
        false,
      );
    }
  });
});
