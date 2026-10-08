import { beforeEach, describe, expect, it } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/me/route";
import { POST as phone } from "@/app/api/me/phone/route";
import { POST as verify } from "@/app/api/me/phone/verify/route";
import { PUT as address } from "@/app/api/me/address/route";
import { addressHash, phoneHash } from "@/lib/domain/hash";
import {
  Browser,
  PASSWORD,
  freshLimits,
  newEmail,
  newPhone,
  service,
} from "./harness";

const PEPPER = "api-test-pepper";
const svc = service();

beforeEach(() => freshLimits());

async function signedUp(
  role: "customer" | "chef" = "customer",
  name = "Test Person",
) {
  const b = new Browser();
  const email = newEmail(role);
  const res = await b.call(signup, {
    body: { email, password: PASSWORD, role, displayName: name },
  });
  expect(res.status, res.text).toBe(201);
  return { b, email, id: res.body.user.id as string };
}

describe("CSRF content-type rule on every state-changing route", () => {
  const routes = [
    ["signup", signup, "POST"],
    ["login", login, "POST"],
    ["logout", logout, "POST"],
    ["patch me", patchMe, "PATCH"],
    ["phone", phone, "POST"],
    ["verify", verify, "POST"],
    ["address", address, "PUT"],
  ] as const;
  it.each(routes)(
    "%s rejects a missing or non-JSON content type with 400 BAD_REQUEST",
    async (_n, h, method) => {
      const { b } = await signedUp();
      for (const contentType of [
        null,
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
        "application/json-evil",
        "application/jsonx",
      ]) {
        const res = await b.call(h, { method, contentType, body: {} });
        expect(res.status, `${contentType}`).toBe(400);
        expect(res.body.error.code).toBe("BAD_REQUEST");
      }
    },
  );
  it("malformed JSON and non-object bodies are 400; charset is accepted", async () => {
    const b = new Browser();
    expect((await b.call(login, { raw: "{nope" })).body.error.code).toBe(
      "BAD_REQUEST",
    );
    expect((await b.call(login, { raw: "[1]" })).body.error.code).toBe(
      "BAD_REQUEST",
    );
    const ok = await b.call(login, {
      contentType: "application/json; charset=utf-8",
      body: { email: "a@b.co", password: "x" },
    });
    expect(ok.status).toBe(401); // parsed fine, credentials wrong
  });
});

describe("POST /api/auth/signup", () => {
  it("validates fields (422) and rejects unknown keys and the admin role", async () => {
    const b = new Browser();
    const res = await b.call(signup, {
      body: {
        email: "nope",
        password: "short",
        role: "admin",
        displayName: "",
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      "displayName",
      "email",
      "password",
      "role",
    ]);
    const long = await b.call(signup, {
      body: {
        email: newEmail("x"),
        password: "x".repeat(73),
        role: "customer",
        displayName: "y".repeat(81),
      },
    });
    expect(Object.keys(long.body.error.fields).sort()).toEqual([
      "displayName",
      "password",
    ]);
    const extra = await b.call(signup, {
      body: {
        email: newEmail("x"),
        password: PASSWORD,
        role: "customer",
        displayName: "A",
        userId: "x",
      },
    });
    expect(extra.status).toBe(422);
    expect(extra.body.error.fields.userId).toBeTruthy();
  });

  it("creates a customer, sets a session cookie, returns no tokens", async () => {
    const { b, email, id } = await signedUp("customer", "Mai Tran");
    expect(b.jar.size).toBeGreaterThan(0);
    const me = await b.call(getMe, { method: "GET" });
    expect(me.status).toBe(200);
    expect(me.body.profile).toMatchObject({
      id,
      role: "customer",
      displayName: "Mai Tran",
      country: "CA",
      currency: "CAD",
    });
    expect(me.body.chef).toBeNull();
    const again = await new Browser().call(signup, {
      body: { email, password: PASSWORD, role: "customer", displayName: "X" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("response bodies hold no tokens or hashes", async () => {
    const b = new Browser();
    const res = await b.call(signup, {
      body: {
        email: newEmail("t"),
        password: PASSWORD,
        role: "customer",
        displayName: "T",
      },
    });
    expect(res.text).not.toMatch(/access_token|refresh_token|hash|jwt/i);
    expect(res.body.signedIn).toBe(true);
  });

  it("a signed-in caller gets 409 INVALID_STATE", async () => {
    const { b } = await signedUp();
    const res = await b.call(signup, {
      body: {
        email: newEmail("z"),
        password: PASSWORD,
        role: "customer",
        displayName: "Z",
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE");
  });

  it("a chef sign-up creates a pending chefs row and a not_started chef_private row", async () => {
    const { b, id } = await signedUp("chef", "Chef Tester");
    const chef = await svc
      .from("chefs")
      .select("status, display_name")
      .eq("profile_id", id)
      .single();
    expect(chef.data).toEqual({
      status: "pending",
      display_name: "Chef Tester",
    });
    const cp = await svc
      .from("chef_private")
      .select(
        "police_check_status, id_check_status, food_handler_status, kitchen_status",
      )
      .eq("chef_id", id)
      .single();
    expect(cp.data).toEqual({
      police_check_status: "not_started",
      id_check_status: "not_started",
      food_handler_status: "not_started",
      kitchen_status: "not_started",
    });
    const me = await b.call(getMe, { method: "GET" });
    expect(me.body.profile.role).toBe("chef");
    expect(me.body.chef).toMatchObject({
      status: "pending",
      displayName: "Chef Tester",
      chefHomeEnabled: false,
    });
  });

  it("a customer sign-up creates no chef rows", async () => {
    const { id } = await signedUp("customer");
    const chef = await svc
      .from("chefs")
      .select("profile_id")
      .eq("profile_id", id);
    expect(chef.data).toEqual([]);
  });

  it("is rate limited: the 11th attempt from one IP in an hour is 429 with Retry-After", async () => {
    const b = new Browser();
    for (let i = 0; i < 10; i++) {
      const r = await b.call(signup, {
        body: {
          email: "bad",
          password: "x",
          role: "customer",
          displayName: "A",
        },
      });
      expect(r.status).toBe(422);
    }
    const r = await b.call(signup, {
      body: { email: "bad", password: "x", role: "customer", displayName: "A" },
    });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    expect(r.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("login and logout", () => {
  it("logs in, and the same 401 message is used for a wrong password and an unknown email", async () => {
    const { email } = await signedUp();
    const b = new Browser();
    const ok = await b.call(login, {
      body: { email: email.toUpperCase(), password: PASSWORD },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.user.role).toBe("customer");
    expect(ok.text).not.toMatch(/access_token|refresh_token/);
    expect((await b.call(getMe, { method: "GET" })).status).toBe(200);
    const bad = await new Browser().call(login, {
      body: { email, password: "wrong-password-1" },
    });
    const unknown = await new Browser().call(login, {
      body: { email: newEmail("ghost"), password: "wrong-password-1" },
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.body).toEqual(bad.body);
  });

  it("validates input (422) and rate limits after 10 tries per IP and email", async () => {
    const b = new Browser();
    expect(
      (await b.call(login, { body: { email: "", password: "" } })).status,
    ).toBe(422);
    const email = newEmail("brute");
    for (let i = 0; i < 10; i++)
      expect(
        (await b.call(login, { body: { email, password: "nope-nope-1" } }))
          .status,
      ).toBe(401);
    const r = await b.call(login, { body: { email, password: "nope-nope-1" } });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
  });

  it("logout ends the session; without a session it is still 200", async () => {
    const { b } = await signedUp();
    const out = await b.call(logout);
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    expect((await b.call(getMe, { method: "GET" })).status).toBe(401);
    expect((await new Browser().call(logout)).status).toBe(200);
  });
});

describe("GET and PATCH /api/me", () => {
  it("GET is 401 without a session", async () => {
    const r = await new Browser().call(getMe, { method: "GET" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("PATCH is 401 without a session", async () => {
    const r = await new Browser().call(patchMe, {
      method: "PATCH",
      body: { displayName: "x" },
    });
    expect(r.status).toBe(401);
  });

  it("PATCH changes the display name, and a chef's public copy too; role never changes", async () => {
    const cust = await signedUp("customer", "Old Name");
    const r = await cust.b.call(patchMe, {
      method: "PATCH",
      body: { displayName: "  New Name " },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: "New Name", role: "customer" });
    const chef = await signedUp("chef", "Chef Old");
    await chef.b.call(patchMe, {
      method: "PATCH",
      body: { displayName: "Chef New" },
    });
    const row = await svc
      .from("chefs")
      .select("display_name")
      .eq("profile_id", chef.id)
      .single();
    expect(row.data?.display_name).toBe("Chef New");
    const prof = await svc
      .from("profiles")
      .select("display_name, role")
      .eq("id", chef.id)
      .single();
    expect(prof.data).toEqual({ display_name: "Chef New", role: "chef" });
  });

  it("PATCH rejects unknown keys (role, id, country) and bad names with 422 and changes nothing", async () => {
    const { b, id } = await signedUp("customer", "Keep Me");
    for (const body of [
      { role: "admin" },
      { id: "x" },
      { country: "US" },
      { displayName: "" },
      { displayName: "y".repeat(81) },
      { displayName: 5 },
    ]) {
      const r = await b.call(patchMe, { method: "PATCH", body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    const prof = await svc
      .from("profiles")
      .select("display_name, role")
      .eq("id", id)
      .single();
    expect(prof.data).toEqual({ display_name: "Keep Me", role: "customer" });
  });
});

describe("phone (MOCK SMS)", () => {
  it("submit: 401 anonymous, 422 malformed", async () => {
    expect(
      (await new Browser().call(phone, { body: { phone: newPhone() } })).status,
    ).toBe(401);
    const { b } = await signedUp();
    for (const p of ["", "abc", "123", "+44 20 7946 0958", 4165550101, null]) {
      freshLimits(); // validation errors count toward the limit; reset so every case reaches validation
      const r = await b.call(phone, { body: { phone: p } });
      expect(r.status, String(p)).toBe(422);
      expect(r.body.error.fields.phone).toBeTruthy();
    }
    expect(
      (await b.call(phone, { body: { phone: newPhone(), extra: 1 } })).status,
    ).toBe(422);
  });

  it("submit stores the E.164 number and the peppered hash, unverified; response is masked and flagged MOCK", async () => {
    const { b, id } = await signedUp();
    const p = newPhone();
    const national = `(${p.slice(2, 5)}) ${p.slice(5, 8)}-${p.slice(8)}`;
    const r = await b.call(phone, { body: { phone: national } });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({
      phoneMasked: `+1******${p.slice(-4)}`,
      mock: true,
      mockHint: "MOCK: no SMS was sent. Enter any 6 digits.",
    });
    expect(r.text).not.toContain(p);
    const row = await svc
      .from("profile_private")
      .select("phone_e164, phone_hash, phone_verified")
      .eq("profile_id", id)
      .single();
    expect(row.data).toEqual({
      phone_e164: p,
      phone_hash: phoneHash(p, PEPPER),
      phone_verified: false,
    });
  });

  it("verify: 401, 409 PHONE_NOT_SUBMITTED, 422 for anything but 6 digits, then success (any 6 digits)", async () => {
    expect(
      (await new Browser().call(verify, { body: { code: "123456" } })).status,
    ).toBe(401);
    const { b, id } = await signedUp();
    const none = await b.call(verify, { body: { code: "123456" } });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("PHONE_NOT_SUBMITTED");
    await b.call(phone, { body: { phone: newPhone() } });
    for (const code of ["12345", "1234567", "abcdef", "12 456", 123456, ""]) {
      const r = await b.call(verify, { body: { code } });
      expect(r.status, String(code)).toBe(422);
      expect(r.body.error.fields.code).toBeTruthy();
    }
    const ok = await b.call(verify, { body: { code: "000000" } });
    expect(ok).toMatchObject({
      status: 200,
      body: { phoneVerified: true, mock: true },
    });
    const row = await svc
      .from("profile_private")
      .select("phone_verified")
      .eq("profile_id", id)
      .single();
    expect(row.data?.phone_verified).toBe(true);
    expect((await b.call(verify, { body: { code: "111111" } })).status).toBe(
      200,
    ); // idempotent
    const me = await b.call(getMe, { method: "GET" });
    expect(me.body.private.phoneVerified).toBe(true);
    expect(me.text).not.toMatch(/phone_hash|address_hash|"phone_e164"/);
  });

  it("a different verified owner makes the number PHONE_IN_USE; unverified holders do not block", async () => {
    const p = newPhone();
    const a = await signedUp();
    const c = await signedUp();
    const d = await signedUp();
    // c holds it unverified: does not block a
    await c.b.call(phone, { body: { phone: p } });
    expect((await a.b.call(phone, { body: { phone: p } })).status).toBe(200);
    expect((await a.b.call(verify, { body: { code: "123456" } })).status).toBe(
      200,
    );
    // d cannot take a verified number
    const taken = await d.b.call(phone, { body: { phone: p } });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("PHONE_IN_USE");
    // c verifying loses the race (unique index)
    const lost = await c.b.call(verify, { body: { code: "123456" } });
    expect(lost.status).toBe(409);
    expect(lost.body.error.code).toBe("PHONE_IN_USE");
    // the owner may resubmit the same number and stays verified
    expect((await a.b.call(phone, { body: { phone: p } })).status).toBe(200);
    const row = await svc
      .from("profile_private")
      .select("phone_verified")
      .eq("profile_id", a.id)
      .single();
    expect(row.data?.phone_verified).toBe(true);
    // a different number resets verification
    await a.b.call(phone, { body: { phone: newPhone() } });
    const row2 = await svc
      .from("profile_private")
      .select("phone_verified")
      .eq("profile_id", a.id)
      .single();
    expect(row2.data?.phone_verified).toBe(false);
  });

  it("rate limits: 6th phone submit and 11th verify per account are 429", async () => {
    const { b } = await signedUp();
    for (let i = 0; i < 5; i++)
      expect(
        (await b.call(phone, { body: { phone: newPhone() } })).status,
      ).toBe(200);
    const r = await b.call(phone, { body: { phone: newPhone() } });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    for (let i = 0; i < 10; i++)
      expect((await b.call(verify, { body: { code: "123456" } })).status).toBe(
        200,
      );
    expect((await b.call(verify, { body: { code: "123456" } })).status).toBe(
      429,
    );
  });
});

describe("PUT /api/me/address", () => {
  const good = {
    line: "100 Fictional Street",
    city: "Mississauga",
    postalCode: "l5b 1a1",
  };

  it("is 401 anonymously and 422 with field messages", async () => {
    expect(
      (await new Browser().call(address, { method: "PUT", body: good })).status,
    ).toBe(401);
    const { b } = await signedUp();
    const r = await b.call(address, {
      method: "PUT",
      body: { line: "", city: "x".repeat(81), postalCode: "12345" },
    });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.error.fields).sort()).toEqual([
      "city",
      "line",
      "postalCode",
    ]);
    const nonGta = await b.call(address, {
      method: "PUT",
      body: { ...good, postalCode: "K1A 0B1" },
    });
    expect(nonGta.status).toBe(422);
    expect(nonGta.body.error.fields.postalCode).toBe("Not a GTA postal code.");
    expect(
      (await b.call(address, { method: "PUT", body: { ...good, userId: "x" } }))
        .status,
    ).toBe(422);
  });

  it("stores the normalized address and hash for the caller only; hash is never returned", async () => {
    const { b, id } = await signedUp();
    const other = await signedUp();
    const r = await b.call(address, { method: "PUT", body: good });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({
      address: {
        line: "100 Fictional Street",
        city: "Mississauga",
        postalCode: "L5B1A1",
        postalPrefix: "L5B",
      },
    });
    expect(r.text).not.toMatch(/hash/i);
    const row = await svc
      .from("profile_private")
      .select("postal_code, postal_prefix, address_hash")
      .eq("profile_id", id)
      .single();
    expect(row.data).toEqual({
      postal_code: "L5B1A1",
      postal_prefix: "L5B",
      address_hash: addressHash("100 fictional st.", "L5B1A1", PEPPER),
    });
    const untouched = await svc
      .from("profile_private")
      .select("address_line")
      .eq("profile_id", other.id)
      .single();
    expect(untouched.data?.address_line).toBeNull();
    const me = await b.call(getMe, { method: "GET" });
    expect(me.body.private.address).toEqual({
      line: "100 Fictional Street",
      city: "Mississauga",
      postalCode: "L5B1A1",
      postalPrefix: "L5B",
    });
    expect(me.text).not.toMatch(/hash/i);
  });
});
