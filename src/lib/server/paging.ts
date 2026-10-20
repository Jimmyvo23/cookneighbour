// One parser for the list queries of T-048 (contract section 7D): `limit` (1 to 50, default 20),
// `cursor` (opaque, from booking-views.ts) and a few named enum parameters. Anything unknown, sent
// twice or invalid is 422 with `fields.<name>`, all reported at once.
import "server-only";
import { validationFailed } from "@/lib/api/errors";
import { decodeListCursor } from "@/lib/server/booking-views";

export interface ListParams {
  limit: number;
  cursor: { c: string; i: string } | null;
  /** The enum parameters that were sent (trimmed); missing ones are undefined. */
  values: Record<string, string | undefined>;
}

export function parseListParams(
  params: URLSearchParams,
  enums: Record<string, readonly string[]> = {},
): ListParams {
  const errors: Record<string, string> = {};
  const one = (k: string): string | undefined => {
    const all = params.getAll(k);
    if (all.length > 1) {
      errors[k] = "Send this only once.";
      return undefined;
    }
    const v = (all[0] ?? "").trim();
    return v === "" ? undefined : v;
  };
  let limit = 20;
  const l = one("limit");
  if (l !== undefined) {
    if (!/^\d{1,3}$/.test(l) || Number(l) < 1 || Number(l) > 50)
      errors.limit = "Use a whole number from 1 to 50.";
    else limit = Number(l);
  }
  let cursor: ListParams["cursor"] = null;
  const c = one("cursor");
  if (c !== undefined) {
    cursor = decodeListCursor(c);
    if (!cursor) errors.cursor = "That page marker is not valid.";
  }
  const values: Record<string, string | undefined> = {};
  for (const [k, allowed] of Object.entries(enums)) {
    const v = one(k);
    if (v !== undefined && !allowed.includes(v))
      errors[k] = `Use one of: ${allowed.join(", ")}.`;
    values[k] = v;
  }
  for (const k of new Set(params.keys()))
    if (k !== "limit" && k !== "cursor" && !(k in enums))
      errors[k] = "Unknown parameter.";
  if (Object.keys(errors).length) throw validationFailed(errors);
  return { limit, cursor, values };
}
