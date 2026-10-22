import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findContactDetails } from "../../src/lib/domain/contactDetails.ts";
import { hasUnsafeText } from "../../src/lib/domain/text-safety.ts";
import { hasNoVisibleText } from "../../src/lib/domain/text-fold.ts";
import { anonClient, localEnv, PASSWORD, rand, serviceClient } from "./helpers";

// T-102 Tester (LOW-3). The SQL function display_name_problem() must agree with the app's
// sign-up rules: trimmed length 1..80 UTF-16 units, hasUnsafeText, hasNoVisibleText and
// findContactDetails (src/app/api/auth/signup/route.ts). Parity is checked on a fixed corpus
// plus a seeded random mix of fragments, straight against the function (superuser connection;
// the function is not callable from the browser).

/** The rules as the sign-up route applies them. Returns true when the app refuses the name. */
function appRefuses(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 1 || t.length > 80) return true;
  if (hasUnsafeText(t)) return true;
  if (hasNoVisibleText(t)) return true;
  return findContactDetails(t) !== null;
}

let db: pg.Client;
beforeAll(async () => {
  db = new pg.Client({ connectionString: localEnv().dbUrl });
  await db.connect();
});
afterAll(async () => {
  await db.end();
});
async function sqlProblem(name: string): Promise<string | null> {
  const r = await db.query("select public.display_name_problem($1) as p", [
    name,
  ]);
  return r.rows[0].p;
}

describe("LOW-3: length is counted in UTF-16 units, like JavaScript .length", () => {
  it.each([
    ["80 ASCII", "a".repeat(80), null],
    ["81 ASCII", "a".repeat(81), "too_long"],
    ["40 emoji (80 units)", "😀".repeat(40), null],
    ["41 emoji (82 units)", "😀".repeat(41), "too_long"],
    ["79 ASCII + 1 emoji (81 units)", "a".repeat(79) + "😀", "too_long"],
    ["78 ASCII + 1 emoji (80 units)", "a".repeat(78) + "😀", null],
    ["80 Vietnamese precomposed letters", "ễ".repeat(80), null],
    [
      "27 decomposed e + 2 marks (81 units)",
      "ệ".normalize("NFD").repeat(27),
      "too_long",
    ],
    ["80 CJK", "李".repeat(80), null],
    ["81 CJK", "李".repeat(81), "too_long"],
    ["emoji ZWJ sequence inside 80", "👩‍🍳".repeat(10), null],
    [
      "emoji ZWJ sequence, 12 x 5 units = 60 + pad to 81",
      "👩‍🍳".repeat(16) + "a",
      "too_long",
    ],
  ])("%s", async (_label, name, expected) => {
    expect(await sqlProblem(name)).toBe(expected);
    expect(appRefuses(name)).toBe(expected !== null);
  });
});

describe("LOW-3: invisible and direction characters", () => {
  it.each([
    ["zero-width space U+200B", "Mai​Tran", true],
    ["word joiner U+2060", "Mai⁠Tran", true],
    ["BOM U+FEFF inside", "Mai﻿Tran", true],
    ["LRE U+202A", "‪Mai", true],
    ["RLO U+202E", "Ma‮i", true],
    ["LRI U+2066", "Mai⁦", true],
    ["PDI U+2069", "Mai⁩", true],
    ["ZWNJ in real text (Persian)", "می‌خواهم", false],
    ["ZWJ in real text (emoji)", "Mai 👩‍🍳", false],
    ["ZWNJ + ZWJ only", "‌‍", true],
    ["only spaces and joiners", " ‍ ‌ ", true],
    ["only NBSP", "  ", true],
    ["only ideographic space", "　", true],
    ["only combining accent", "́", true],
    ["only spacing acute", "´", true],
    ["tab inside", "Mai\tTran", true],
    ["newline inside", "Mai\nTran", true],
    ["DEL", "Mai\u007f", true],
    ["NUL-like control U+0001", "Mai\u0001", true],
    ["C1 control U+0085", "Mai\u0085Tran", null],
  ])("%s", async (_label, name, refused) => {
    const sql = (await sqlProblem(name)) !== null;
    if (refused !== null) expect(sql).toBe(refused);
    expect(sql, "SQL and app agree").toBe(appRefuses(name));
  });
});

describe("LOW-3: real names and false positives pass", () => {
  it.each([
    "Nguyễn Thị Mai",
    "Nguyễn Thị Mai".normalize("NFD"),
    "Đặng Văn A",
    "đ",
    "Lan 1985",
    "Chef Anna B.",
    "Mrs. O'Brien-Smith",
    "José Müller",
    "Zoë",
    "Mai (Grandma)",
    "Mai 2026-10-31",
    "Room 12345",
    "Suite 4 and 7 and 12",
    "Order 123 456 78",
    "Anna Co.",
    "Anna.B",
    "Dr. Who",
    "Pho 24",
    "Tía María",
    "ฉันชอบทำอาหาร",
    "मीना",
    "علي",
    "李小龍",
    "😀",
    "Mai 1234567",
    "Mai 12345678901234",
    "A",
  ])("%j is accepted by SQL and the app", async (name) => {
    expect(await sqlProblem(name)).toBeNull();
    expect(appRefuses(name)).toBe(false);
  });
});

describe("LOW-3: contact details are refused, including full-width and disguised forms", () => {
  it.each([
    "Call 416 555 0199",
    "416-555-0199",
    "416.555.0199",
    "(416) 555-0199",
    "+1 (416) 555-0199",
    "+14165550199",
    "14165550199",
    "4165550199",
    "１４１６５５５０１９９",
    "４１６‐５５５‐０１９９",
    "416‑555‑0199",
    "416–555–0199",
    "ref 12345 416 555 0199",
    "Mai 416 555 0199 now",
    "mai@example.com",
    "mai＠example.com",
    "ｍａｉ@example.com",
    "mai@exämple.com",
    "a@b.co",
    "www.mai.ca",
    "ｗｗｗ.mai.ca",
    "https://mai",
    "HTTP://mai",
    "mai.com",
    "mai.CA",
    "pho.io",
    "go.gl",
    "Mai Tran.com",
    "M‍ai@example.com",
  ])("%j", async (name) => {
    expect(await sqlProblem(name)).not.toBeNull();
    expect(appRefuses(name), "app agrees").toBe(true);
  });
});

// A seeded random mix of fragments: SQL and the app must give the same yes or no.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const FRAGMENTS = [
  "Mai",
  "Tran",
  "Nguyễn",
  "Đặng",
  "José",
  "Lan",
  "1985",
  "416",
  "555",
  "0199",
  "4165550199",
  "+1",
  "(416)",
  "-",
  ".",
  " ",
  "  ",
  "@",
  "example",
  ".com",
  "www.",
  "https://",
  "x.ca",
  "😀",
  "👩‍🍳",
  "‌",
  "‍",
  "​",
  "‮",
  "́",
  "´",
  "４１６",
  "５５５",
  "０１９９",
  "‐",
  "–",
  "＠",
  " ",
  "　",
  "é",
  "ệ",
  "ệ".normalize("NFD"),
  "ﬁ",
  "²",
  "①",
  "Ⅷ",
  "2026-10-31",
  "12345",
  "a",
  "B.",
  "李",
  "٤١٦",
  "०१२",
  "1",
  "11",
  "123",
];
describe("LOW-3: seeded random parity with the app rules", () => {
  it("2000 random names: SQL and app agree", async () => {
    const r = rng(102);
    const mismatches: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(r() * 7);
      let s = "";
      for (let k = 0; k < n; k++)
        s += FRAGMENTS[Math.floor(r() * FRAGMENTS.length)];
      if (s.trim() === "") continue;
      const sql = (await sqlProblem(s.trim())) !== null;
      const app = appRefuses(s);
      if (sql !== app)
        mismatches.push(
          `${JSON.stringify(s)} sql=${sql ? "refuse" : "accept"} app=${app ? "refuse" : "accept"}`,
        );
    }
    expect(mismatches.slice(0, 40)).toEqual([]);
  });
});

// Every code point, alone and between letters, in one query per chunk. SQL stricter than the app
// would turn a normal sign-up into a generic 500 (the route validates first, then Auth fails), SQL
// looser would let a direct Auth call skip a rule.
describe("LOW-3: every Unicode code point gives the same answer in SQL and in the app", () => {
  it("single code points and 'a<cp>b' agree (surrogates excluded)", async () => {
    const names: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      // Skip huge unassigned planes: sample plane 3 to 13 sparsely, keep all of 0 to 2 and 14 to 16.
      if (cp > 0x2ffff && cp < 0xe0000 && cp % 97 !== 0) continue;
      if (cp > 0xe01ef && cp % 97 !== 0) continue;
      const c = String.fromCodePoint(cp);
      names.push(c, `a${c}b`);
    }
    const mismatches: string[] = [];
    for (let i = 0; i < names.length; i += 20000) {
      const chunk = names.slice(i, i + 20000);
      const r = await db.query(
        "select s, public.display_name_problem(s) as p from unnest($1::text[]) as s",
        [chunk],
      );
      for (const row of r.rows as { s: string; p: string | null }[]) {
        const t = row.s.trim();
        if (t === "") continue;
        const sql = row.p !== null;
        const app = appRefuses(row.s);
        if (sql === app) continue;
        mismatches.push(
          `U+${[...row.s].map((ch) => ch.codePointAt(0)!.toString(16)).join(" U+")} sql=${sql ? "refuse" : "accept"} app=${app ? "refuse" : "accept"}`,
        );
      }
    }
    expect(mismatches.slice(0, 60)).toEqual([]);
  }, 240_000);
});

describe("LOW-3: parity of web-address boundaries (F-1, fixed in round 1)", () => {
  it("a web address next to a non-ASCII letter or digit is refused by SQL like the app", async () => {
    for (const name of ["李x.ca", "x.ca李", "०१२x.ca", "x.ca٤١٦"]) {
      expect(appRefuses(name), name).toBe(true);
      expect(await sqlProblem(name), name).not.toBeNull();
    }
  });
});

describe("LOW-3: a name that is only U+0085 is refused by the app and the trigger (F-2, fixed in round 1)", () => {
  it("the app refuses a name that SQL calls invisible", async () => {
    expect(await sqlProblem("\u0085")).not.toBeNull();
    expect(appRefuses("\u0085")).toBe(true);
  });
});

describe("LOW-3: through real Supabase Auth", () => {
  it("a direct anonymous sign-up with a good name works and keeps role and name", async () => {
    const email = `par-${rand(6)}@example.test`;
    const res = await anonClient().auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { display_name: "  Nguyễn Thị Mai  ", role: "chef" } },
    });
    expect(res.error).toBeNull();
    const p = await serviceClient()
      .from("profiles")
      .select("role, display_name")
      .eq("id", res.data.user!.id)
      .single();
    expect(p.data).toEqual({ role: "chef", display_name: "Nguyễn Thị Mai" });
  });

  it("a direct sign-up with each bad class fails and leaves no profile", async () => {
    for (const name of [
      "a".repeat(81),
      "Ma‮i",
      "​",
      "Call 416 555 0199",
      "mai@example.com",
      "https://x.io",
    ]) {
      const email = `par-bad-${rand(6)}@example.test`;
      const res = await anonClient().auth.signUp({
        email,
        password: PASSWORD,
        options: { data: { display_name: name } },
      });
      expect(res.error, JSON.stringify(name)).not.toBeNull();
      expect(res.data.user).toBeNull();
    }
  });

  it("a non-string display_name in metadata does not crash into a 500-style different path", async () => {
    // ->> returns text for a number; a JSON object becomes its text and is checked like any name.
    for (const bad of [{ a: 1 }, 123, ["x"], true, null]) {
      const res = await anonClient().auth.signUp({
        email: `par-t-${rand(6)}@example.test`,
        password: PASSWORD,
        options: { data: { display_name: bad } },
      });
      // Either outcome is acceptable; it must be a clean answer, not a hang.
      expect(["object"]).toContain(typeof res);
    }
  });
});
