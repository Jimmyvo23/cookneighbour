// Shared helpers for the admin chef-queue route tests (T-035). LOCAL Supabase only.
import { expect } from "vitest";
import { GET as listRoute } from "@/app/api/admin/chefs/route";
import { GET as detailRoute } from "@/app/api/admin/chefs/[id]/route";
import { POST as approveRoute } from "@/app/api/admin/chefs/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/admin/chefs/[id]/reject/route";
import { PATCH as checksRoute } from "@/app/api/admin/chefs/[id]/checks/route";
import { POST as kitchenRoute } from "@/app/api/admin/chefs/[id]/kitchen-review/route";
import {
  application,
  newAdmin,
  readyChef,
  submit,
  svc,
  upload,
  type Chef,
} from "./chef-helpers";

export { newAdmin };

type Handler = (request: Request) => Promise<Response> | Response;
type IdRoute = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response> | Response;

const forId =
  (route: IdRoute) =>
  (id: string): Handler =>
  (request) =>
    route(request, { params: Promise.resolve({ id }) });

/** The list route with a real query string (the browser helper uses a fixed URL). */
export const listWith =
  (qs = ""): Handler =>
  (request) =>
    listRoute(
      new Request(`http://localhost/api/admin/chefs?${qs}`, {
        method: "GET",
        headers: request.headers,
      }),
    );
export const detailOf = forId(detailRoute);
export const approveOf = forId(approveRoute);
export const rejectOf = forId(rejectRoute);
export const checksOf = forId(checksRoute);
export const kitchenOf = forId(kitchenRoute);

/**
 * A chef whose application is complete, with every stored file really present (readyChef leaves
 * the dish photo as a path only), already submitted so the MOCK checks are `pending`.
 */
export async function submittedChef(
  opts: { chefHome?: boolean; name?: string } = {},
) {
  const c = await readyChef(opts);
  const dishes = await svc
    .from("dishes")
    .select("photo_path")
    .eq("chef_id", c.id);
  expect(dishes.error).toBeNull();
  for (const d of dishes.data ?? [])
    await upload("dish-photos", d.photo_path as string);
  const r = await c.b.call(submit, { body: {} });
  expect(r.status, r.text).toBe(200);
  return c;
}

/** Marks the ID and food-handler checks `verified` on the files the admin sees now. */
export async function verifyFiles(admin: Chef, chef: Chef) {
  const app = await application(chef.b);
  const r = await admin.b.call(checksOf(chef.id), {
    method: "PATCH",
    body: {
      idCheck: "verified",
      idDocumentPath: app.documents.idDocumentPath,
      foodHandlerCheck: "verified",
      foodHandlerPath: app.documents.foodHandlerPath,
    },
  });
  expect(r.status, r.text).toBe(200);
  return app;
}

/** Complete, submitted and both file checks verified: ready to approve. */
export async function approvableChef(
  admin: Chef,
  opts: { chefHome?: boolean; name?: string } = {},
) {
  const c = await submittedChef(opts);
  await verifyFiles(admin, c);
  return c;
}

export async function notificationsOf(userId: string) {
  const r = await svc
    .from("notifications")
    .select("type, title, body, booking_id, read_at")
    .eq("user_id", userId)
    .order("created_at");
  expect(r.error).toBeNull();
  return r.data ?? [];
}

/** A real customer (or chef) whose JWT carries role 'admin' in user_metadata and app_metadata. */
export async function withAdminClaims(who: Chef) {
  const { Browser, PASSWORD, login } = await import("./chef-helpers");
  const upd = await svc.auth.admin.updateUserById(who.id, {
    user_metadata: { role: "admin", display_name: "Sneaky" },
    app_metadata: { role: "admin" },
  });
  expect(upd.error).toBeNull();
  const b = new Browser();
  const res = await b.call(login, {
    body: { email: who.email, password: PASSWORD },
  });
  expect(res.status, res.text).toBe(200);
  return b;
}
