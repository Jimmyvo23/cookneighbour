import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadChefFile } from "../../src/lib/chef/upload";
import {
  anonClient,
  clientFor,
  localEnv,
  rand,
  serviceClient,
} from "./helpers";

// T-102 Tester (LOW-5): profile-photos and dish-photos are insert-only for the owner (a new path
// per file), chefs only for profile photos, and the real app upload flow still works.
const fx = inject("fx");
const svc = serviceClient();
const BUCKETS = ["profile-photos", "dish-photos"] as const;

const bytes = (n: number) =>
  new Blob([new Uint8Array(n).fill(7)], { type: "image/png" });
const up = (
  c: SupabaseClient,
  bucket: string,
  path: string,
  n = 4,
  upsert = false,
) =>
  c.storage
    .from(bucket)
    .upload(path, bytes(n), { contentType: "image/png", upsert });
async function sizeOf(bucket: string, path: string): Promise<number | null> {
  const { data, error } = await svc.storage.from(bucket).download(path);
  return error || !data ? null : data.size;
}
const publicStatus = async (bucket: string, path: string) =>
  (
    await fetch(
      anonClient().storage.from(bucket).getPublicUrl(path).data.publicUrl,
    )
  ).status;

describe("LOW-5: no policy other than the insert and select ones can touch the two buckets", () => {
  it("no UPDATE, DELETE or ALL policy on storage.objects mentions either bucket", async () => {
    const db = new pg.Client({ connectionString: localEnv().dbUrl });
    await db.connect();
    try {
      const r = await db.query(
        `select policyname, cmd, roles::text as roles from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and cmd in ('UPDATE','DELETE','ALL')
            and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(profile|dish)-photos'`,
      );
      expect(r.rows).toEqual([]);
      const ins = await db.query(
        `select policyname, with_check from pg_policies
          where schemaname='storage' and tablename='objects' and cmd='INSERT'
            and with_check ~ '(profile|dish)-photos'`,
      );
      for (const row of ins.rows) {
        expect(row.with_check, row.policyname).toContain("is_chef");
        expect(row.with_check, row.policyname).toContain("auth.uid()");
      }
      expect(ins.rows.length).toBe(2);
    } finally {
      await db.end();
    }
  });
});

describe.each(BUCKETS)("LOW-5: %s is insert-only for the owner", (bucket) => {
  it("a chef can insert new paths; a second upload to the same path, with or without upsert, is refused and the file is unchanged", async () => {
    const h1 = await clientFor(fx.h1);
    const path = `${fx.h1.id}/t102-${rand(5)}.png`;
    expect((await up(h1, bucket, path, 4)).error).toBeNull();
    expect(await sizeOf(bucket, path)).toBe(4);
    expect(
      (await up(h1, bucket, path, 9)).error,
      "plain re-upload",
    ).not.toBeNull();
    expect(
      (await up(h1, bucket, path, 9, true)).error,
      "upsert",
    ).not.toBeNull();
    expect(await sizeOf(bucket, path), "unchanged").toBe(4);
    expect(await publicStatus(bucket, path)).toBe(200);
    await svc.storage.from(bucket).remove([path]);
  });

  it("the owner cannot delete, move or rename an existing file; copy cannot overwrite", async () => {
    const h1 = await clientFor(fx.h1);
    const a = `${fx.h1.id}/t102-a-${rand(5)}.png`;
    const b = `${fx.h1.id}/t102-b-${rand(5)}.png`;
    expect((await up(h1, bucket, a, 4)).error).toBeNull();
    expect((await up(h1, bucket, b, 6)).error).toBeNull();

    await h1.storage.from(bucket).remove([a]);
    expect(await sizeOf(bucket, a), "delete refused").toBe(4);

    await h1.storage
      .from(bucket)
      .move(a, `${fx.h1.id}/t102-moved-${rand(5)}.png`);
    expect(await sizeOf(bucket, a), "move refused: original still there").toBe(
      4,
    );

    const cp = await h1.storage.from(bucket).copy(a, b);
    expect(cp.error, "copy onto an existing path").not.toBeNull();
    expect(await sizeOf(bucket, b), "target unchanged").toBe(6);
    await svc.storage.from(bucket).remove([a, b]);
  });

  it("another chef and the admin cannot write into this chef's folder or change this chef's file", async () => {
    const [h1, h2, admin] = await Promise.all(
      [fx.h1, fx.h2, fx.admin].map(clientFor),
    );
    const path = `${fx.h1.id}/t102-x-${rand(5)}.png`;
    expect((await up(h1, bucket, path, 4)).error).toBeNull();
    expect(
      (await up(h2, bucket, `${fx.h1.id}/t102-y-${rand(5)}.png`)).error,
      "other chef",
    ).not.toBeNull();
    expect(
      (await up(h2, bucket, path, 9, true)).error,
      "other chef upsert",
    ).not.toBeNull();
    expect(
      (await up(admin, bucket, `${fx.h1.id}/t102-z-${rand(5)}.png`)).error,
      "admin insert",
    ).not.toBeNull();
    await h2.storage.from(bucket).remove([path]);
    await admin.storage.from(bucket).remove([path]);
    expect(await sizeOf(bucket, path)).toBe(4);
    await svc.storage.from(bucket).remove([path]);
  });

  it("anonymous cannot upload; folder must be the exact lower-case uid (no upper case, no nesting trick)", async () => {
    const h1 = await clientFor(fx.h1);
    expect(
      (await up(anonClient(), bucket, `${fx.h1.id}/t102-${rand(5)}.png`)).error,
      "anon",
    ).not.toBeNull();
    expect(
      (await up(h1, bucket, `${fx.h1.id.toUpperCase()}/t102-${rand(5)}.png`))
        .error,
      "upper case folder",
    ).not.toBeNull();
    expect(
      (await up(h1, bucket, `t102-${rand(5)}.png`)).error,
      "no folder",
    ).not.toBeNull();
    expect(
      (await up(h1, bucket, `x/${fx.h1.id}/t102-${rand(5)}.png`)).error,
      "uid not first",
    ).not.toBeNull();
    expect(
      (await up(h1, bucket, `${fx.h1.id}/../${fx.h2.id}/t102-${rand(5)}.png`))
        .error,
      "dot dot",
    ).not.toBeNull();
  });

  it("a customer cannot upload (own folder or any other)", async () => {
    const c = fx.c1;
    const cc = await clientFor(c);
    expect(
      (await up(cc, bucket, `${c.id}/t102-${rand(5)}.png`)).error,
      "own folder",
    ).not.toBeNull();
    expect(
      (await up(cc, bucket, `${fx.h1.id}/t102-${rand(5)}.png`)).error,
      "chef folder",
    ).not.toBeNull();
  });
});

describe("LOW-5: the application upload flow still works (pending chef, new path per file)", () => {
  it("a pending and a rejected chef can still upload their profile photo (applying must work)", async () => {
    for (const p of [fx.hp, fx.hr]) {
      const c = await clientFor(p);
      const path = `${p.id}/t102-${rand(5)}.png`;
      expect((await up(c, "profile-photos", path)).error).toBeNull();
      await svc.storage.from("profile-photos").remove([path]);
    }
  });

  it("uploadChefFile (the real browser helper) uploads profile and dish photos twice, each to a new path, via the chef's own session", async () => {
    const h1 = await clientFor(fx.h1);
    const uploader = {
      upload: async (
        bucket: string,
        path: string,
        file: File,
        options: { upsert: false; contentType: string },
      ) => ({
        error: (await h1.storage.from(bucket).upload(path, file, options))
          .error,
      }),
    };
    const file = () =>
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "p.png", {
        type: "image/png",
      });
    for (const target of ["profile_photo", "dish_photo"] as const) {
      const first = await uploadChefFile(target, fx.h1.id, file(), uploader);
      const second = await uploadChefFile(target, fx.h1.id, file(), uploader);
      expect(second.path).not.toBe(first.path);
      expect(first.path.startsWith(`${fx.h1.id}/`)).toBe(true);
      expect(await publicStatus(first.bucket, first.path)).toBe(200);
      expect(await publicStatus(second.bucket, second.path)).toBe(200);
      await svc.storage.from(first.bucket).remove([first.path, second.path]);
    }
  });

  it("the service role (the routes) can still delete and replace files", async () => {
    const h1 = await clientFor(fx.h1);
    for (const bucket of BUCKETS) {
      const path = `${fx.h1.id}/t102-svc-${rand(5)}.png`;
      expect((await up(h1, bucket, path)).error).toBeNull();
      expect((await svc.storage.from(bucket).remove([path])).error).toBeNull();
      expect(await sizeOf(bucket, path)).toBeNull();
    }
  });
});
