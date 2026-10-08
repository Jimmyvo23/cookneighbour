// Server side of the admin chef-queue routes (T-035, contract section 6).
//
// Authorization (contract section 2, rule 4): requireAdmin() takes the identity from getUser() and
// the role from profiles.role (requireCaller), answers 403 for any other role, and only then
// builds the service-role client. JWT metadata is never read. Reads use the user-scoped client so
// the admin RLS policies apply too; writes use the service role.
//
// Decisions that touch more than one table (approve, reject, kitchen review) run as ONE database
// function each (migration 20261010120000), which locks the chef's rows, re-reads everything and
// writes in one transaction. The check-then-write races the T-026 and T-031 reviews found cannot
// happen. The MOCK checks route is one conditional UPDATE.
//
// MOCK: ID, food-handler, kitchen and police statuses are simulated outcomes recorded here by an
// admin. Nothing verifies a real document. Logs carry the admin id and chef id only: never a
// document, a signed URL, a reason or an email.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure } from "@/lib/api/errors";
import type {
  AdminChefDetail,
  AdminChefListItem,
  AdminChefListResponse,
  ChefApplication,
  SignedDocumentUrl,
} from "@/lib/api/types";
import {
  encodeCursor,
  isUuid,
  type ParsedChecks,
  type ParsedKitchenReview,
  type ParsedListQuery,
} from "@/lib/domain/admin-chefs";
import { checkStoragePath } from "@/lib/domain/chef-application";
import { requireCaller, type Caller } from "@/lib/server/caller";
import {
  loadState,
  toApplication,
  type ChefState,
} from "@/lib/server/chef-application";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export const SIGNED_URL_SECONDS = 300;

export interface AdminCaller extends Caller {
  /** Service-role client. Created only after the role check. */
  admin: SupabaseClient;
}

/** 401 without a session, 403 unless profiles.role is 'admin'; only then the service role. */
export async function requireAdmin(): Promise<AdminCaller> {
  const caller = await requireCaller();
  if (caller.role !== "admin")
    throw new ApiFailure("FORBIDDEN", "Only admins can do this.");
  return { ...caller, admin: createAdminClient() };
}

function logDecision(action: string, adminId: string, chefId: string) {
  console.info(`api: admin ${action} admin=${adminId} chef=${chefId}`);
}

const notFound = () =>
  new ApiFailure("NOT_FOUND", "No chef application with that id.");

/** A chef id that is not a uuid, or names no chef, is a 404 (before any body check). */
export async function requireChefExists(
  a: AdminCaller,
  id: string,
): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const r = await a.supabase
    .from("chefs")
    .select("profile_id")
    .eq("profile_id", id)
    .maybeSingle();
  if (r.error) throw new Error(`chef lookup failed: ${r.error.message}`);
  if (!r.data) throw notFound();
}

// ---------------------------------------------------------------------------
// GET /api/admin/chefs
// ---------------------------------------------------------------------------
const LIST_COLUMNS =
  "profile_id, status, display_name, cuisines, created_at, chef_home_enabled, location_options, chef_private!inner(id_check_status, food_handler_status, kitchen_status, police_check_status)";

function mapListItem(r: Row): AdminChefListItem {
  const raw = r.chef_private;
  const p = (Array.isArray(raw) ? raw[0] : raw) as Row;
  return {
    id: r.profile_id as string,
    displayName: r.display_name as string,
    status: r.status as AdminChefListItem["status"],
    cuisines: (r.cuisines as string[]) ?? [],
    createdAt: new Date(r.created_at as string).toISOString(),
    // MOCK statuses.
    checks: {
      id: p.id_check_status as ChefApplication["checks"]["id"],
      foodHandler:
        p.food_handler_status as ChefApplication["checks"]["foodHandler"],
      kitchen: p.kitchen_status as ChefApplication["checks"]["kitchen"],
      police: p.police_check_status as ChefApplication["checks"]["police"],
    },
    chefHomeEnabled: r.chef_home_enabled as boolean,
    locationOptions: r.location_options as AdminChefListItem["locationOptions"],
  };
}

export async function listChefs(
  a: AdminCaller,
  q: ParsedListQuery,
): Promise<AdminChefListResponse> {
  let query = a.supabase.from("chefs").select(LIST_COLUMNS);
  if (q.status !== "all") query = query.eq("status", q.status);
  if (q.checksPending)
    query = query.or(
      "id_check_status.eq.pending,food_handler_status.eq.pending,kitchen_status.eq.pending",
      { referencedTable: "chef_private" },
    );
  if (q.cursor) {
    // Both values were matched against a strict shape in decodeCursor (timestamp and uuid), so
    // nothing but those characters reaches the filter string.
    const { createdAt, id } = q.cursor;
    query = query.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},profile_id.lt.${id})`,
    );
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("profile_id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw new Error(`chef list failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(mapListItem),
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor(last.created_at as string, last.profile_id as string)
        : null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/chefs/:id
// ---------------------------------------------------------------------------
export async function loadApplication(
  a: AdminCaller,
  id: string,
): Promise<{ state: ChefState; application: ChefApplication }> {
  if (!isUuid(id)) throw notFound();
  const state = await loadState(a.supabase, id);
  if (!state) throw notFound();
  return { state, application: toApplication(state) };
}

async function signedDocuments(
  a: AdminCaller,
  chefId: string,
  application: ChefApplication,
): Promise<SignedDocumentUrl[]> {
  const wanted: { kind: SignedDocumentUrl["kind"]; path: string }[] = [];
  const d = application.documents;
  if (d.idDocumentPath)
    wanted.push({ kind: "id_document", path: d.idDocumentPath });
  if (d.foodHandlerPath)
    wanted.push({ kind: "food_handler", path: d.foodHandlerPath });
  for (const path of d.kitchenPhotoPaths)
    wanted.push({ kind: "kitchen_photo", path });

  const out: SignedDocumentUrl[] = [];
  for (const w of wanted) {
    // The bucket comes from the kind, never from stored text, and the stored path must still look
    // like one of our own file names in this chef's folder (defence in depth: the database
    // already enforces the folder). A path that fails is skipped, never signed.
    const check = checkStoragePath(w.kind, chefId, w.path);
    if (!check.ok) continue;
    const { data, error } = await a.admin.storage
      .from(check.bucket)
      .createSignedUrl(check.path, SIGNED_URL_SECONDS);
    // A missing object has no URL; the application still lists the path. Never log the URL.
    if (error || !data?.signedUrl) continue;
    out.push({
      kind: w.kind,
      path: w.path,
      url: data.signedUrl,
      expiresInSeconds: SIGNED_URL_SECONDS,
    });
  }
  return out;
}

export async function chefDetail(
  a: AdminCaller,
  id: string,
): Promise<AdminChefDetail> {
  const { application } = await loadApplication(a, id);
  const user = await a.admin.auth.admin.getUserById(id);
  if (user.error && user.error.status !== 404)
    throw new Error(`email lookup failed: ${user.error.message}`);
  return {
    application,
    email: user.data?.user?.email ?? null,
    documents: await signedDocuments(a, id, application),
  };
}

// ---------------------------------------------------------------------------
// Decisions (database functions) and MOCK checks
// ---------------------------------------------------------------------------
async function callDecision(
  a: AdminCaller,
  fn: string,
  args: Record<string, unknown>,
): Promise<Row> {
  const { data, error } = await a.admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? {}) as Row;
}

async function actionResult(
  a: AdminCaller,
  id: string,
): Promise<ChefApplication> {
  return (await loadApplication(a, id)).application;
}

export async function approveChef(
  a: AdminCaller,
  id: string,
): Promise<ChefApplication> {
  const r = await callDecision(a, "admin_approve_chef", { p_chef_id: id });
  switch (r.result) {
    case "ok":
      logDecision("approved chef", a.userId, id);
      return actionResult(a, id);
    case "not_found":
      throw notFound();
    case "invalid_state":
      throw new ApiFailure(
        "INVALID_STATE",
        r.status === "approved"
          ? "This chef is already approved."
          : "This application was rejected. The chef has to update it and submit it again first.",
      );
    case "incomplete":
      throw new ApiFailure(
        "APPLICATION_INCOMPLETE",
        "The application is not complete yet.",
        { missing: r.missing as string[] },
      );
    case "unverified": {
      const what = (r.unverified as string[])
        .map((x) => (x === "idCheck" ? "ID" : "food handler"))
        .join(" and ");
      throw new ApiFailure(
        "INVALID_STATE",
        `The ${what} check must be verified (MOCK) before approving.`,
      );
    }
    default:
      throw new Error("approve: unexpected result");
  }
}

export async function rejectChef(
  a: AdminCaller,
  id: string,
  reason: string,
): Promise<ChefApplication> {
  const r = await callDecision(a, "admin_reject_chef", {
    p_chef_id: id,
    p_reason: reason,
  });
  switch (r.result) {
    case "ok":
      logDecision("rejected chef", a.userId, id);
      return actionResult(a, id);
    case "not_found":
      throw notFound();
    case "invalid_state":
      throw new ApiFailure(
        "INVALID_STATE",
        "This application is already rejected.",
      );
    default:
      throw new Error("reject: unexpected result");
  }
}

const STALE_FILE =
  "The file changed after you opened it. Reload the application and review it again.";

/**
 * MOCK checks. One conditional UPDATE: the reviewed paths must equal the stored paths in the same
 * statement (B1), so a file swapped after the admin opened it is never marked. The update also
 * bumps chef_private.updated_at (trigger), which stops a chef write that read the old row.
 */
export async function setChecks(
  a: AdminCaller,
  id: string,
  c: ParsedChecks,
): Promise<ChefApplication> {
  // MOCK: simulated outcomes recorded by the admin.
  const columns: Record<string, unknown> = {};
  if (c.idCheck !== undefined) columns.id_check_status = c.idCheck;
  if (c.foodHandlerCheck !== undefined)
    columns.food_handler_status = c.foodHandlerCheck;
  if (c.policeCheck !== undefined) columns.police_check_status = c.policeCheck;
  let q = a.admin.from("chef_private").update(columns).eq("chef_id", id);
  if (c.idCheck !== undefined) q = q.eq("id_document_path", c.idDocumentPath!);
  if (c.foodHandlerCheck !== undefined)
    q = q.eq("food_handler_path", c.foodHandlerPath!);
  const r = await q.select("chef_id");
  if (r.error) throw new Error(`checks update failed: ${r.error.message}`);
  if (r.data.length === 0) throw new ApiFailure("INVALID_STATE", STALE_FILE);
  logDecision("set checks", a.userId, id);
  return actionResult(a, id);
}

export async function reviewKitchen(
  a: AdminCaller,
  id: string,
  k: ParsedKitchenReview,
): Promise<ChefApplication> {
  const r = await callDecision(a, "admin_review_kitchen", {
    p_chef_id: id,
    p_decision: k.decision,
    p_note: k.note,
    p_photos: k.reviewedPhotoPaths,
    p_address: k.reviewedAddress,
  });
  switch (r.result) {
    case "ok":
      logDecision(`kitchen ${k.decision}`, a.userId, id);
      return actionResult(a, id);
    case "not_found":
      throw notFound();
    case "stale":
      throw new ApiFailure(
        "INVALID_STATE",
        "The kitchen photos or address changed after you opened them. Reload the application and review them again.",
      );
    case "not_offered":
      throw new ApiFailure(
        "INVALID_STATE",
        "This chef does not offer cooking at their own home.",
      );
    case "incomplete":
      throw new ApiFailure(
        "APPLICATION_INCOMPLETE",
        "The kitchen details are not complete yet.",
        { missing: r.missing as string[] },
      );
    default:
      throw new Error("kitchen review: unexpected result");
  }
}
