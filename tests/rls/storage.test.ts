import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, clientFor, rand } from "./helpers";

const fx = inject("fx");
const b = fx.bookings;

const pdf = () =>
  new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

async function canDownload(
  c: SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const { data, error } = await c.storage.from(bucket).download(path);
  return !error && !!data;
}

describe("storage: chef-documents (MOCK ID and food-handler verification)", () => {
  let h1: SupabaseClient;
  let h2: SupabaseClient;
  let c1: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    [h1, h2, c1, admin] = await Promise.all(
      [fx.h1, fx.h2, fx.c1, fx.admin].map(clientFor),
    );
  });

  it("a chef can upload into their own folder", async () => {
    const { error } = await h1.storage
      .from("chef-documents")
      .upload(`${fx.h1.id}/food-${rand(3)}.pdf`, pdf(), {
        contentType: "application/pdf",
      });
    expect(error).toBeNull();
  });

  it("a chef cannot upload into another user's folder, and anon cannot upload", async () => {
    const mine = await h2.storage
      .from("chef-documents")
      .upload(`${fx.h1.id}/planted-${rand(3)}.pdf`, pdf(), {
        contentType: "application/pdf",
      });
    expect(mine.error).not.toBeNull();
    const anon = await anonClient()
      .storage.from("chef-documents")
      .upload(`${fx.h1.id}/anon-${rand(3)}.pdf`, pdf(), {
        contentType: "application/pdf",
      });
    expect(anon.error).not.toBeNull();
  });

  it("documents are readable by the admin only; other chefs, customers and anon cannot read them", async () => {
    const path = `${fx.h1.id}/id.pdf`;
    expect(await canDownload(admin, "chef-documents", path)).toBe(true); // allowed control: object exists
    expect(await canDownload(h2, "chef-documents", path)).toBe(false);
    expect(await canDownload(c1, "chef-documents", path)).toBe(false);
    expect(await canDownload(anonClient(), "chef-documents", path)).toBe(false);
    // the pending chef's document is equally hidden from an approved chef
    expect(await canDownload(h1, "chef-documents", `${fx.hp.id}/id.pdf`)).toBe(
      false,
    );
    expect(
      await canDownload(admin, "chef-documents", `${fx.hp.id}/id.pdf`),
    ).toBe(true);
  });

  it("listing the bucket does not reveal other people's documents", async () => {
    const asH2 = await h2.storage.from("chef-documents").list(fx.h1.id);
    expect(asH2.error).toBeNull();
    expect(asH2.data ?? []).toEqual([]);
    const asAdmin = await admin.storage.from("chef-documents").list(fx.h1.id);
    expect((asAdmin.data ?? []).length).toBeGreaterThan(0);
  });

  it("a chef cannot delete a document; the admin can", async () => {
    const path = `${fx.h1.id}/to-delete-${rand(3)}.pdf`;
    expect(
      (
        await h1.storage
          .from("chef-documents")
          .upload(path, pdf(), { contentType: "application/pdf" })
      ).error,
    ).toBeNull();
    const del = await h1.storage.from("chef-documents").remove([path]);
    expect(del.data ?? []).toEqual([]); // nothing removed
    expect(await canDownload(admin, "chef-documents", path)).toBe(true);
    const adminDel = await admin.storage.from("chef-documents").remove([path]);
    expect((adminDel.data ?? []).length).toBe(1);
  });
});

describe("storage: receipts (booking parties only)", () => {
  let h1: SupabaseClient;
  let h2: SupabaseClient;
  let c1: SupabaseClient;
  let c2: SupabaseClient;
  let admin: SupabaseClient;
  beforeAll(async () => {
    [h1, h2, c1, c2, admin] = await Promise.all(
      [fx.h1, fx.h2, fx.c1, fx.c2, fx.admin].map(clientFor),
    );
  });

  const path = `${b.requestedC1H1}/r.png`;

  it("both parties and admin can read a booking's receipt; strangers and anon cannot", async () => {
    expect(await canDownload(c1, "receipts", path)).toBe(true);
    expect(await canDownload(h1, "receipts", path)).toBe(true);
    expect(await canDownload(admin, "receipts", path)).toBe(true);
    expect(await canDownload(c2, "receipts", path)).toBe(false);
    expect(await canDownload(h2, "receipts", path)).toBe(false);
    expect(await canDownload(anonClient(), "receipts", path)).toBe(false);
  });

  it("the other pair's receipt is not readable by the first pair", async () => {
    const other = `${b.requestedC2H2}/r.png`;
    expect(await canDownload(c2, "receipts", other)).toBe(true); // allowed control
    expect(await canDownload(c1, "receipts", other)).toBe(false);
    expect(await canDownload(h1, "receipts", other)).toBe(false);
  });

  it("only the booking's chef can upload a receipt", async () => {
    const name = `${b.acceptedC1H1}/up-${rand(3)}.png`;
    expect(
      (
        await h1.storage
          .from("receipts")
          .upload(name, png(), { contentType: "image/png" })
      ).error,
    ).toBeNull();
    expect(
      (
        await c1.storage
          .from("receipts")
          .upload(`${b.acceptedC1H1}/cust-${rand(3)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await h2.storage
          .from("receipts")
          .upload(`${b.acceptedC1H1}/other-${rand(3)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await anonClient()
          .storage.from("receipts")
          .upload(`${b.acceptedC1H1}/anon-${rand(3)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
    // the uploaded receipt is then readable by the customer of that booking
    expect(await canDownload(c1, "receipts", name)).toBe(true);
    expect(await canDownload(c2, "receipts", name)).toBe(false);
  });

  it("a non-uuid first folder name is never granted", async () => {
    expect(
      (
        await h1.storage
          .from("receipts")
          .upload(`not-a-uuid/${rand(3)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
  });
});

describe("storage: public photo buckets", () => {
  it("owners write only in their own folder; everyone can read", async () => {
    const h1 = await clientFor(fx.h1);
    const h2 = await clientFor(fx.h2);
    const name = `${fx.h1.id}/dish-${rand(3)}.png`;
    expect(
      (
        await h1.storage
          .from("dish-photos")
          .upload(name, png(), { contentType: "image/png" })
      ).error,
    ).toBeNull();
    expect(
      (
        await h2.storage
          .from("dish-photos")
          .upload(`${fx.h1.id}/evil-${rand(3)}.png`, png(), {
            contentType: "image/png",
          })
      ).error,
    ).not.toBeNull();
    expect(await canDownload(anonClient(), "dish-photos", name)).toBe(true);
    // another user cannot overwrite or delete it
    const del = await h2.storage.from("dish-photos").remove([name]);
    expect(del.data ?? []).toEqual([]);
    expect(await canDownload(anonClient(), "dish-photos", name)).toBe(true);
  });
});
