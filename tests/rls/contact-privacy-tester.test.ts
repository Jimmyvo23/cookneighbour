// T-065 tester additions: DST edges of the D-52 window, strangers, customer-home bookings,
// grants on the helper functions. Fresh chefs and customers per test; fixed far dates are used
// only for the pure date maths on one private booking.
import { describe, expect, inject, it } from "vitest";
import {
  anonClient,
  clientFor,
  expectRows,
  makeBooking,
  makeChef,
  makeCustomer,
  serviceClient,
} from "./helpers";

inject("fx");
const svc = serviceClient();

const torontoParts = (iso: string) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

// T-127: the four cases used fixed dates (2026-10-24 ...). The database refuses a visit date in the
// past, so the first case failed on 2026-10-25 and the others would follow. The cases are now built
// from the NEXT two daylight-saving changes in Toronto (the first Sunday of November and the second
// Sunday of March), so the test keeps exercising both edges and never goes stale. The expected UTC
// instant is worked out from the Toronto wall clock with Intl, independent of the database.
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const torontoToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
/** The nth Sunday (1-based) of a month, as YYYY-MM-DD. */
const nthSunday = (year: number, month: number, n: number) => {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (7 - first.getUTCDay()) % 7;
  return isoDay(
    new Date(Date.UTC(year, month - 1, 1 + offset + 7 * (n - 1), 12)),
  );
};
/** The first change of that kind whose day minus 8 is tomorrow or later (a visit day must not be past). */
const nextChange = (kind: "fall" | "spring", today: string) => {
  const year = Number(today.slice(0, 4));
  for (let y = year; y <= year + 2; y++) {
    const day = kind === "fall" ? nthSunday(y, 11, 1) : nthSunday(y, 3, 2);
    if (addDays(day, -8) > today) return day;
  }
  throw new Error("no daylight-saving change found");
};
/** 00:00 Toronto on `day` as a UTC instant, found by trying both offsets and checking the wall clock. */
const torontoMidnightUtc = (day: string) => {
  for (const hours of [4, 5]) {
    const t = new Date(`${day}T0${hours}:00:00.000Z`);
    if (torontoParts(t.toISOString()) === `${day} 00:00:00`)
      return t.toISOString();
  }
  throw new Error(`no Toronto midnight for ${day}`);
};

const today = torontoToday();
const fall = nextChange("fall", today);
const spring = nextChange("spring", today);

describe(`D-52 window across daylight saving changes (next fall-back ${fall} and spring-forward ${spring}, Toronto)`, () => {
  // last visit day -> expected first hidden instant, i.e. 00:00 Toronto on last day + 8
  const make = (last: string): [string, string, string] => {
    const hidden = addDays(last, 8);
    return [last, `${hidden} 00:00:00`, torontoMidnightUtc(hidden)];
  };
  const cases: [string, string, string][] = [
    // ends on the change day itself (fall-back: still EDT at 00:00)
    make(addDays(fall, -8)),
    // window spans the fall-back change, ends in EST
    make(addDays(fall, -2)),
    // ends on the spring-forward day itself (still EST at 00:00)
    make(addDays(spring, -8)),
    // window spans the spring-forward change, ends in EDT
    make(addDays(spring, -4)),
  ];
  it.each(cases)(
    "last day %s hides at %s Toronto",
    async (last, local, utc) => {
      const chef = await makeChef(svc, "cpt-dst-chef" + last);
      const cust = await makeCustomer(svc, "cpt-dst-cust" + last);
      const b = await makeBooking(svc, {
        customer: cust,
        chef,
        dates: [last],
        status: "accepted",
      });
      const ends = (
        await svc.rpc("booking_contact_ends_at", { p_booking: b.id })
      ).data as string;
      expect(new Date(ends).toISOString()).toBe(utc);
      expect(torontoParts(ends)).toBe(local);
      const at = (ms: number) =>
        svc.rpc("booking_contact_open", {
          p_booking: b.id,
          p_status: "completed",
          p_at: new Date(new Date(ends).getTime() + ms).toISOString(),
        });
      expect((await at(-1000)).data).toBe(true); // 23:59:59 Toronto on last day + 7
      expect((await at(0)).data).toBe(false); // 00:00:00 on last day + 8
      expect((await at(1000)).data).toBe(false);
    },
  );

  it("uses the LAST visit day of a multi-day booking, not the first", async () => {
    const chef = await makeChef(svc, "cpt-multi-chef");
    const cust = await makeCustomer(svc, "cpt-multi-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: ["2027-04-05", "2027-04-06", "2027-04-07"],
      status: "accepted",
    });
    const ends = (await svc.rpc("booking_contact_ends_at", { p_booking: b.id }))
      .data as string;
    expect(torontoParts(ends)).toBe("2027-04-15 00:00:00");
  });

  it("a booking with no days has no window and shows no contact", async () => {
    const chef = await makeChef(svc, "cpt-nodays-chef");
    const cust = await makeCustomer(svc, "cpt-nodays-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: [],
      status: "accepted",
    });
    expect(
      (await svc.rpc("booking_contact_ends_at", { p_booking: b.id })).data,
    ).toBeNull();
    expectRows(
      await (
        await clientFor(cust)
      ).rpc("get_booking_contact", {
        p_booking: b.id,
      }),
      0,
    );
  });
});

describe("contact access", () => {
  it("a stranger and anon get nothing, even for an accepted open booking", async () => {
    const chef = await makeChef(svc, "cpt-str-chef");
    const cust = await makeCustomer(svc, "cpt-str-cust");
    const stranger = await makeCustomer(svc, "cpt-str-other");
    const otherChef = await makeChef(svc, "cpt-str-otherchef");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: ["2027-06-10"],
      status: "accepted",
    });
    for (const p of [stranger, otherChef])
      expectRows(
        await (
          await clientFor(p)
        ).rpc("get_booking_contact", {
          p_booking: b.id,
        }),
        0,
      );
    const anon = await anonClient().rpc("get_booking_contact", {
      p_booking: b.id,
    });
    expect(anon.error !== null || (anon.data as unknown[]).length === 0).toBe(
      true,
    );
    // The two parties do see each other, and visible_until matches booking_contact_ends_at.
    const ends = (await svc.rpc("booking_contact_ends_at", { p_booking: b.id }))
      .data as string;
    for (const p of [cust, chef]) {
      const r = await (
        await clientFor(p)
      ).rpc("get_booking_contact", {
        p_booking: b.id,
      });
      expectRows(r, 1);
      expect(
        new Date((r.data as { visible_until: string }[])[0].visible_until),
      ).toEqual(new Date(ends));
    }
  });

  it("customer-home booking: the chef sees the customer's address and no kitchen snapshot is made", async () => {
    const chef = await makeChef(svc, "cpt-ch-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const cust = await makeCustomer(svc, "cpt-ch-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: ["2027-06-20"],
      location: "customer_home",
    });
    const a = await svc.rpc("answer_booking", {
      p_booking: b.id,
      p_chef: chef.id,
      p_action: "accept",
      p_reason: null,
    });
    expect(a.data).toMatchObject({ result: "ok" });
    const snap = await svc
      .from("booking_kitchen_addresses")
      .select("booking_id")
      .eq("booking_id", b.id);
    expect(snap.data).toEqual([]);
    // The customer (own home) gets no chef address back.
    const mine = await (
      await clientFor(cust)
    ).rpc("get_booking_contact", {
      p_booking: b.id,
    });
    expectRows(mine, 1);
    expect(
      (mine.data as { address_line: string | null }[])[0].address_line,
    ).toBeNull();
    // Declining never creates a snapshot either.
    const chef2 = await makeChef(svc, "cpt-ch2-chef", {
      options: ["customer_home", "chef_home"],
      chefHomeEnabled: true,
    });
    const b2 = await makeBooking(svc, {
      customer: cust,
      chef: chef2,
      dates: ["2027-06-22"],
      location: "chef_home",
    });
    await svc.rpc("answer_booking", {
      p_booking: b2.id,
      p_chef: chef2.id,
      p_action: "decline",
      p_reason: "busy",
    });
    const s2 = await svc
      .from("booking_kitchen_addresses")
      .select("booking_id")
      .eq("booking_id", b2.id);
    expect(s2.data).toEqual([]);
  });

  it("helper functions are not callable from a browser role", async () => {
    const chef = await makeChef(svc, "cpt-gr-chef");
    const cust = await makeCustomer(svc, "cpt-gr-cust");
    const b = await makeBooking(svc, {
      customer: cust,
      chef,
      dates: ["2027-06-25"],
      status: "accepted",
    });
    for (const c of [
      anonClient(),
      await clientFor(cust),
      await clientFor(chef),
    ]) {
      const e = await c.rpc("booking_contact_ends_at", { p_booking: b.id });
      expect(e.error).not.toBeNull();
      const o = await c.rpc("booking_contact_open", {
        p_booking: b.id,
        p_status: "accepted",
      });
      expect(o.error).not.toBeNull();
    }
    // answer_booking stays server-only too.
    for (const c of [anonClient(), await clientFor(chef)]) {
      const r = await c.rpc("answer_booking", {
        p_booking: b.id,
        p_chef: chef.id,
        p_action: "decline",
        p_reason: null,
      });
      expect(r.error).not.toBeNull();
    }
  });
});
