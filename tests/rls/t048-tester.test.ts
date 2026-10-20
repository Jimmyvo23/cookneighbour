// T-048 Tester additions (WO-5c): row-level security on the real stack. Own people and bookings.
// Findings are `it.fails(...)`: the test states the SAFE behaviour, which does not hold today, so
// the suite stays green; when the product is fixed vitest flags the test and `.fails` is removed.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  clientFor,
  dayPlus,
  expectDenied,
  expectNoRows,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
  type Person,
} from "./helpers";

const fx = inject("fx");
const svc = serviceClient();
const DAY = 24 * 3_600_000;

let cust: Person;
let other: Person;
let chef: Person;
let cC: SupabaseClient;
let cO: SupabaseClient;
let cH: SupabaseClient;
let cAdmin: SupabaseClient;
let n = 0;

beforeAll(async () => {
  cust = await makeCustomer(svc, "tt-customer");
  other = await makeCustomer(svc, "tt-other");
  chef = await makeChef(svc, "tt-chef", { status: "approved" });
  [cC, cO, cH, cAdmin] = await Promise.all(
    [cust, other, chef, fx.admin].map(clientFor),
  );
});

async function booking(status: string, completedAgoMs = 1000) {
  n += 1;
  const b = await makeBooking(svc, {
    customer: cust,
    chef,
    dates: [dayPlus(fx.baseDay, 800 + n)],
    status: status as "requested",
  });
  if (status === "completed") {
    const up = await svc
      .from("bookings")
      .update({
        completed_at: new Date(Date.now() - completedAgoMs).toISOString(),
      })
      .eq("id", b.id);
    expect(up.error).toBeNull();
  }
  return b.id;
}

const row = (
  booking_id: string,
  author: Person,
  subject: Person,
  author_role: "customer" | "chef",
) => ({
  booking_id,
  author_id: author.id,
  subject_id: subject.id,
  author_role,
  rating: 4,
  comment: "tester",
});

describe("review window: tight edges (30 seconds either side of 14 x 24 h)", () => {
  it("inside by 30 s is allowed and past by 30 s is refused, for both roles", async () => {
    const inside = await booking("completed", 14 * DAY - 30_000);
    const past = await booking("completed", 14 * DAY + 30_000);
    expectRows(
      await cC
        .from("reviews")
        .insert(row(inside, cust, chef, "customer"))
        .select(),
      1,
    );
    expectRows(
      await cH
        .from("reviews")
        .insert(row(inside, chef, cust, "chef"))
        .select(),
      1,
    );
    expectDenied(
      await cC
        .from("reviews")
        .insert(row(past, cust, chef, "customer"))
        .select(),
    );
    expectDenied(
      await cH
        .from("reviews")
        .insert(row(past, chef, cust, "chef"))
        .select(),
    );
    const rows = await svc.from("reviews").select("id").eq("booking_id", past);
    expect(rows.data).toEqual([]);
  });

  it.each(["requested", "accepted", "declined", "cancelled"])(
    "a %s booking cannot be reviewed by either party",
    async (status) => {
      const id = await booking(status);
      expectDenied(
        await cC
          .from("reviews")
          .insert(row(id, cust, chef, "customer"))
          .select(),
      );
      expectDenied(
        await cH
          .from("reviews")
          .insert(row(id, chef, cust, "chef"))
          .select(),
      );
      const rows = await svc.from("reviews").select("id").eq("booking_id", id);
      expect(rows.data).toEqual([]);
    },
  );

  it("the window moves with completed_at: a completed booking whose time is pushed past 14 days closes", async () => {
    const id = await booking("completed", 1000);
    const up = await svc
      .from("bookings")
      .update({ completed_at: new Date(Date.now() - 15 * DAY).toISOString() })
      .eq("id", id);
    expect(up.error).toBeNull();
    expectDenied(
      await cC
        .from("reviews")
        .insert(row(id, cust, chef, "customer"))
        .select(),
    );
  });
});

describe("review visibility by role", () => {
  it("a chef's review of a customer is hidden from anon, another customer and another chef, however they filter", async () => {
    const id = await booking("completed");
    expectRows(
      await cH
        .from("reviews")
        .insert(row(id, chef, cust, "chef"))
        .select(),
      1,
    );
    const stranger = await makeChef(svc, "tt-other-chef", {
      status: "approved",
    });
    const cS = await clientFor(stranger);
    for (const c of [anonClient(), cO, cS]) {
      expectNoRows(await c.from("reviews").select("id").eq("booking_id", id));
      expectNoRows(
        await c.from("reviews").select("id").eq("subject_id", cust.id),
      );
      expectNoRows(
        await c
          .from("reviews")
          .select("id")
          .eq("author_role", "chef")
          .eq("booking_id", id),
      );
    }
    expectRows(await cC.from("reviews").select("id").eq("booking_id", id), 1);
    expectRows(
      await cAdmin.from("reviews").select("id").eq("booking_id", id),
      1,
    );
  });

  // FINDING F-2 (MEDIUM): `anon` has a table-wide SELECT on reviews (migration 20261007221002,
  // line 191), so PostgREST returns EVERY column of a public review: the reviewer's full-name
  // snapshot (`author_display_name`, defeating the first-name rule), `author_id` and `booking_id`.
  // The safe behaviour is a column-level grant that leaves these out.
  describe.each(["author_display_name", "author_id", "booking_id"])(
    "FINDING F-2: anon cannot read reviews.%s",
    (column) => {
      it.fails(`column ${column}`, async () => {
        const id = await booking("completed");
        const ins = await cC
          .from("reviews")
          .insert(row(id, cust, chef, "customer"))
          .select("id");
        expectRows(ins, 1);
        const rid = (ins.data as { id: string }[])[0].id;
        const res = await anonClient()
          .from("reviews")
          .select(column)
          .eq("id", rid);
        // Safe: the column is refused (42501). Today: the value comes back.
        expect(res.error?.code).toBe("42501");
      });
    },
  );
});

describe("reports: insert rules", () => {
  it("a non-party cannot report, nobody reports as someone else, and a report cannot start closed or with a note", async () => {
    const id = await booking("accepted");
    const base = { booking_id: id, description: "tester" };
    expectDenied(
      await cO
        .from("reports")
        .insert({ ...base, reporter_id: other.id })
        .select(),
    );
    expectDenied(
      await cO
        .from("reports")
        .insert({ ...base, reporter_id: cust.id })
        .select(),
    );
    expectDenied(
      await cH
        .from("reports")
        .insert({ ...base, reporter_id: cust.id })
        .select(),
    );
    const closed = await cC
      .from("reports")
      .insert({ ...base, reporter_id: cust.id, status: "resolved" })
      .select();
    expect(closed.error?.code).toBe("42501");
    const noted = await cC
      .from("reports")
      .insert({ ...base, reporter_id: cust.id, admin_note: "mine" })
      .select();
    expect(noted.error?.code).toBe("42501");
    const rows = await svc.from("reports").select("id").eq("booking_id", id);
    expect(rows.data).toEqual([]);
  });

  it.each(["requested", "declined", "cancelled", "completed"])(
    "a party can report a %s booking directly, and the other party then reads nothing",
    async (status) => {
      const id = await booking(status);
      const ins = await cC
        .from("reports")
        .insert({ booking_id: id, reporter_id: cust.id, description: "t" })
        .select("id");
      expectRows(ins, 1);
      const rid = (ins.data as { id: string }[])[0].id;
      expectNoRows(await cH.from("reports").select("id").eq("id", rid));
      expectNoRows(await cH.from("reports").select("id").eq("booking_id", id));
      expectNoRows(
        await anonClient().from("reports").select("id").eq("id", rid),
      );
    },
  );

  it("the same client_id cannot be used twice by one reporter (service role), but another reporter may reuse it", async () => {
    const a = await booking("accepted");
    const b = await booking("accepted");
    const key = randomUUID();
    const one = await svc
      .from("reports")
      .insert({
        booking_id: a,
        reporter_id: cust.id,
        description: "t",
        client_id: key,
      })
      .select("id");
    expectRows(one, 1);
    const dup = await svc
      .from("reports")
      .insert({
        booking_id: b,
        reporter_id: cust.id,
        description: "t",
        client_id: key,
      })
      .select("id");
    expect(dup.error?.code).toBe("23505");
    expectRows(
      await svc
        .from("reports")
        .insert({
          booking_id: a,
          reporter_id: chef.id,
          description: "t",
          client_id: key,
        })
        .select("id"),
      1,
    );
  });
});

describe("admin_decisions and the decision function", () => {
  it("a signed-in admin (not the service role) cannot call admin_decide_booking or read the audit table", async () => {
    const id = await booking("accepted");
    const call = await cAdmin.rpc("admin_decide_booking", {
      p_admin: fx.admin.id,
      p_kind: "flag_resolve",
      p_booking: id,
      p_report: null,
      p_final: "completed",
      p_note: "tester call",
    });
    expect(call.error?.code).toBe("42501");
    const read = await cAdmin.from("admin_decisions").select("id").limit(1);
    expectNoRows(read);
    const st = await svc
      .from("bookings")
      .select("status")
      .eq("id", id)
      .single();
    expect(st.data?.status).toBe("accepted");
  });
});
