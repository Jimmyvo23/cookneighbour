// Pure helpers for the chef application UI (T-033). Validation reuses the server's own pure rules
// (src/lib/domain/chef-application.ts) so the form and the API agree; the server stays the authority.
import { ApiClientError } from "@/lib/api/client";
import type {
  ApplicationMissingItem,
  ChefApplication,
  LocationType,
  MockCheckStatus,
  UpdateChefApplicationRequest,
} from "@/lib/api/types";
import { parseUpdateBody } from "@/lib/domain/chef-application";

export type FieldErrors = Record<string, string>;

export function parseList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "25", "25.5" or "$25.50" to cents; null when it is not a plain amount with up to 2 decimals. */
export function dollarsToCents(text: string): number | null {
  const m = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

export function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export interface ProfileValues {
  bio: string;
  cuisines: string;
  languages: string;
  rate: string;
  prefix: string;
  radius: string;
  locationOptions: LocationType[];
}

export function buildProfilePatch(v: ProfileValues): {
  body?: UpdateChefApplicationRequest;
  errors: FieldErrors;
} {
  const rate = dollarsToCents(v.rate);
  const radius = /^\d{1,3}$/.test(v.radius.trim())
    ? Number(v.radius.trim())
    : NaN;
  const raw: Record<string, unknown> = {
    bio: v.bio,
    cuisines: parseList(v.cuisines),
    languages: parseList(v.languages),
    // NaN and null fail the server's range check with its message.
    hourlyRateCents: rate ?? NaN,
    servicePostalPrefix: v.prefix,
    serviceRadiusKm: radius,
    locationOptions: v.locationOptions,
  };
  const { value, errors } = parseUpdateBody(raw);
  return Object.keys(errors).length
    ? { errors }
    : { body: value as UpdateChefApplicationRequest, errors: {} };
}

export function buildKitchenPatch(v: {
  line: string;
  city: string;
  postalCode: string;
}): { body?: UpdateChefApplicationRequest; errors: FieldErrors } {
  const { value, errors } = parseUpdateBody({ kitchenAddress: v });
  return Object.keys(errors).length
    ? { errors }
    : { body: value as UpdateChefApplicationRequest, errors: {} };
}

const MISSING_TEXT: Record<ApplicationMissingItem, string> = {
  displayName: "Your display name",
  bio: "A short bio",
  photo: "A profile photo",
  cuisines: "At least one cuisine",
  languages: "At least one language you speak",
  hourlyRate: "Your hourly rate",
  servicePostalPrefix: "The postal code area you serve",
  locationOptions: "Where you can cook",
  idDocument: "A government ID file",
  foodHandler: "A Food Handler Certificate file",
  allergenAcknowledgement: "The allergen-awareness acknowledgement",
  phoneVerified: "Phone verification (MOCK)",
  sampleDish: "At least one active dish with a photo",
  kitchenAddress: "Your kitchen address",
  kitchenPhotos: "At least one kitchen photo",
  kitchenHygieneAcknowledgement: "The kitchen-hygiene acknowledgement (MOCK)",
};

export function describeMissing(item: ApplicationMissingItem | string): string {
  return MISSING_TEXT[item as ApplicationMissingItem] ?? String(item);
}

export function checkStatusText(s: MockCheckStatus): string {
  return {
    not_started: "Not started",
    pending: "Pending review",
    verified: "Verified",
    failed: "Failed",
  }[s];
}

export interface StatusView {
  kind: "draft" | "submitted" | "rejected" | "approved";
  title: string;
  text: string;
}

/** The chef's status for display. A pending chef counts as "submitted" once submit has moved the
 *  ID or food-handler check out of `not_started`; the API has no separate "submitted" flag. */
export function statusView(
  a: Pick<ChefApplication, "status" | "rejectReason" | "checks">,
): StatusView {
  if (a.status === "approved")
    return {
      kind: "approved",
      title: "Approved",
      text: "An admin approved your application. You can still edit your profile; changing documents or kitchen details sends those checks back for review.",
    };
  if (a.status === "rejected")
    return {
      kind: "rejected",
      title: "Not approved",
      text: `Reason: ${a.rejectReason ?? "No reason was given."} Fix the items and submit again.`,
    };
  const started =
    a.checks.id !== "not_started" || a.checks.foodHandler !== "not_started";
  return started
    ? {
        kind: "submitted",
        title: "Submitted, waiting for review",
        text: "An admin reviews applications by hand. You will see the result here.",
      }
    : {
        kind: "draft",
        title: "Draft, not submitted yet",
        text: "Fill in every section, then submit your application for review.",
      };
}

/** A clear message for any error from the API or the upload step. */
export function describeError(err: unknown): string {
  if (err instanceof Error && err.name === "UploadError") return err.message;
  if (!(err instanceof ApiClientError))
    return "Something went wrong. Please try again.";
  switch (err.code) {
    case "APPLICATION_INCOMPLETE": {
      const list = (err.missing ?? []).map(describeMissing).join("; ");
      return list
        ? `Your application is not complete yet. Still needed: ${list}.`
        : "Your application is not complete yet.";
    }
    case "INVALID_STATE":
      return `${err.message} Reload the page if this keeps happening.`;
    case "NOT_FOUND":
      return "The server could not find that file. Upload it again.";
    case "FORBIDDEN":
      return "You are not allowed to do that. Log in as a chef.";
    case "UNAUTHENTICATED":
      return "Your session ended. Log in again.";
    case "VALIDATION_FAILED":
      return err.message;
    default:
      return err.message;
  }
}
