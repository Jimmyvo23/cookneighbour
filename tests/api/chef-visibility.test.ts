// T-031 tester T11, CLAUDE.md section 10: "pending or rejected chefs must never appear in search".
// There is no public chef route in this branch, so this is checked where search will read from:
// the chefs table under RLS, as an anonymous visitor and as a signed-in customer, after the chef
// routes have run.
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { freshLimits } from "./harness";
import {
  chefClient,
  newChef,
  newCustomer,
  patchApp,
  readyChef,
  setChef,
  setPriv,
  submit,
  svc,
} from "./chef-helpers";

beforeEach(() => freshLimits());

function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Can this client read the chef's public row, dishes and availability? */
async function visibleTo(
  db: ReturnType<typeof anon>,
  id: string,
): Promise<{ chef: boolean; dishes: boolean }> {
  const chef = await db.from("chefs").select("profile_id").eq("profile_id", id);
  expect(chef.error).toBeNull();
  const dishes = await db.from("dishes").select("id").eq("chef_id", id);
  expect(dishes.error).toBeNull();
  return {
    chef: (chef.data ?? []).length > 0,
    dishes: (dishes.data ?? []).length > 0,
  };
}

describe("pending and rejected chefs stay out of anonymous and customer reads", () => {
  it("a new pending chef is invisible, and chef_private is closed to anon", async () => {
    const chef = await newChef();
    expect(await visibleTo(anon(), chef.id)).toEqual({
      chef: false,
      dishes: false,
    });
    const priv = await anon()
      .from("chef_private")
      .select("chef_id")
      .eq("chef_id", chef.id);
    expect(priv.error).not.toBeNull(); // anon has no grant on chef_private at all
    expect(priv.data ?? []).toEqual([]);
  });

  it("stays invisible through edits, a submit, a rejection and rejected -> pending; an approval makes it visible (control)", async () => {
    const chef = await readyChef();
    const customer = await newCustomer();
    const asCustomer = await chefClient(customer.email);

    const states: string[] = [];
    async function expectHidden(label: string) {
      states.push(label);
      expect(await visibleTo(anon(), chef.id), `anon, ${label}`).toEqual({
        chef: false,
        dishes: false,
      });
      expect(
        await visibleTo(asCustomer, chef.id),
        `customer, ${label}`,
      ).toEqual({
        chef: false,
        dishes: false,
      });
    }

    await expectHidden("complete application, pending");
    await chef.b.call(patchApp, { method: "PATCH", body: { bio: "edited" } });
    await expectHidden("after an edit");
    const sub = await chef.b.call(submit);
    expect(sub.status, sub.text).toBe(200);
    await expectHidden("after submit");

    // an admin rejects (service role stands in for the admin route, T-035)
    await setChef(chef.id, { status: "rejected" });
    await setPriv(chef.id, {
      reject_reason: "ID photo unreadable",
      id_check_status: "failed",
    });
    await expectHidden("rejected");
    const edit = await chef.b.call(patchApp, {
      method: "PATCH",
      body: { bio: "fixed" },
    });
    expect(edit.body.status).toBe("rejected");
    await expectHidden("rejected, then edited");

    const resub = await chef.b.call(submit);
    expect(resub.status, resub.text).toBe(200);
    expect(resub.body.application.status).toBe("pending");
    await expectHidden("rejected -> pending after submit");
    expect(states).toHaveLength(6); // every state above was probed

    // control: the same probes DO see the chef once approved, so the checks above can fail
    await setChef(chef.id, { status: "approved" });
    expect(await visibleTo(anon(), chef.id)).toEqual({
      chef: true,
      dishes: true,
    });
    expect(await visibleTo(asCustomer, chef.id)).toEqual({
      chef: true,
      dishes: true,
    });
    // and the chef routes did not make an approved chef's private data public
    const priv = await anon()
      .from("chef_private")
      .select("chef_id")
      .eq("chef_id", chef.id);
    expect(priv.error).not.toBeNull();
    expect(
      (
        await svc
          .from("chefs")
          .select("status")
          .eq("profile_id", chef.id)
          .single()
      ).data,
    ).toEqual({
      status: "approved",
    });
  });
});
