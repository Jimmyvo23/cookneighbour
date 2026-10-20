// T-048 Tester additions (WO-5c): row-level security on the real stack. Own people and bookings.
// Findings F-1 and F-2 were pinned as `it.fails` and are normal passing tests since the fix round.
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
        .select("id"),
      1,
    );
    expectRows(
      await cH
        .from("reviews")
        .insert(row(inside, chef, cust, "chef"))
        .select("id"),
      1,
    );
    expectDenied(
      await cC
        .from("reviews")
        .insert(row(past, cust, chef, "customer"))
        .select("id"),
    );
    expectDenied(
      await cH
        .from("reviews")
        .insert(row(past, chef, cust, "chef"))
        .select("id"),
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
          .select("id"),
      );
      expectDenied(
        await cH
          .from("reviews")
          .insert(row(id, chef, cust, "chef"))
          .select("id"),
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
        .select("id"),
    );
  });
});

describe("review visibility by role", () => {
  it("a chef's review of a customer is hidden from anon, another customer and another chef, however they filter", async () => {
    const id = await booking("completed");
    const ins = await cH
      .from("reviews")
      .insert(row(id, chef, cust, "chef"))
      .select("id");
    expectRows(ins, 1);
    const rid = (ins.data as { id: string }[])[0].id;
    const stranger = await makeChef(svc, "tt-other-chef", {
      status: "approved",
    });
    const cS = await clientFor(stranger);
    // Round 3: no browser role may filter on booking_id, subject_id or author_id, so rows are
    // found by id; the stranger and anon see nothing, the two parties and the admin see the row.
    for (const c of [anonClient(), cO, cS]) {
      expectNoRows(await c.from("reviews").select("id").eq("id", rid));
      expectNoRows(
        await c
          .from("reviews")
          .select("id")
          .eq("author_role", "chef")
          .eq("id", rid),
      );
    }
    for (const c of [cC, cH, cAdmin])
      expectRows(await c.from("reviews").select("id").eq("id", rid), 1);
  });

  // F-2 (fixed in the fix round, migration 20261023100000): anon has a column grant of id,
  // author_role, rating, comment and created_at only, so PostgREST refuses the full-name snapshot,
  // the author, the subject and the booking.
  describe.each([
    "author_display_name",
    "author_id",
    "booking_id",
    "subject_id",
  ])("F-2: no browser role can read reviews.%s", (column) => {
    it(`column ${column}`, async () => {
      const id = await booking("completed");
      const ins = await cC
        .from("reviews")
        .insert(row(id, cust, chef, "customer"))
        .select("id");
      expectRows(ins, 1);
      const rid = (ins.data as { id: string }[])[0].id;
      // Round 3 (open point 21): signed-in users get the same columns as visitors, so the
      // anon, a non-party, a party and the admin are all refused.
      for (const c of [anonClient(), cO, cC, cH, cAdmin]) {
        const res = await c.from("reviews").select(column).eq("id", rid);
        expect(res.error?.code).toBe("42501");
        expect(res.data).toBeNull();
      }
    });
  });

  it("F-2: anon still reads the safe columns of a public review, and a select * is refused", async () => {
    const id = await booking("completed");
    const ins = await cC
      .from("reviews")
      .insert(row(id, cust, chef, "customer"))
      .select("id");
    expectRows(ins, 1);
    const rid = (ins.data as { id: string }[])[0].id;
    for (const c of [anonClient(), cO, cC, cH, cAdmin]) {
      const ok = await c
        .from("reviews")
        .select("id, author_role, rating, comment, created_at")
        .eq("id", rid);
      expectRows(ok, 1);
      const all = await c.from("reviews").select("*").eq("id", rid);
      expect(all.error?.code).toBe("42501");
    }
  });
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
    // T-090: reports.admin_note is gone, so the column cannot be written or read by anyone.
    const gone = await svc.from("reports").select("admin_note").limit(1);
    expect(gone.error).not.toBeNull();
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
