// Shared request/response types for the CookNeighbour API (contract v1).
// Source of truth for behaviour: docs/api-contract.md. TYPES ONLY: no runtime code, no imports
// from server-only modules, so both Frontend and Backend may import this file.
// Money is integer cents. Dates are ISO strings. Anything marked MOCK is simulated.

// ---------------------------------------------------------------------------
// Enums (mirror the Postgres enums in supabase/migrations/)
// ---------------------------------------------------------------------------
export type UserRole = "customer" | "chef" | "admin";
export type SignUpRole = Exclude<UserRole, "admin">;
export type ChefStatus = "pending" | "approved" | "rejected";
export type LocationType = "customer_home" | "chef_home";
/** MOCK: ID, food handler and kitchen checks. */
export type MockCheckStatus = "not_started" | "pending" | "verified" | "failed";
/** MOCK. */
export type PoliceCheckStatus = MockCheckStatus;

// ---------------------------------------------------------------------------
// Errors (every non-2xx response uses this body)
// ---------------------------------------------------------------------------
export type ApiErrorCode =
  | "BAD_REQUEST" // 400 malformed JSON or wrong content type
  | "UNAUTHENTICATED" // 401
  | "FORBIDDEN" // 403
  | "NOT_FOUND" // 404 (also used when the caller may not know the row exists)
  | "EMAIL_IN_USE" // 409
  | "PHONE_IN_USE" // 409 (proposed rule, T-028)
  | "PHONE_NOT_SUBMITTED" // 409
  | "PHONE_NOT_VERIFIED" // 409
  | "INVALID_STATE" // 409 action not allowed in the current status
  | "APPLICATION_INCOMPLETE" // 409 approve/submit with missing items
  | "VALIDATION_FAILED" // 422 see fields
  | "INVALID_CREDENTIALS" // 401 login only
  | "RATE_LIMITED" // 429
  | "INTERNAL"; // 500

export interface ApiError {
  error: {
    code: ApiErrorCode;
    /** Safe to show to the user. Never contains secrets, hashes or other users' data. */
    message: string;
    /** Per-field messages for VALIDATION_FAILED, keyed by request field name. */
    fields?: Record<string, string>;
    /** APPLICATION_INCOMPLETE: names of the missing items. */
    missing?: string[];
    /** RATE_LIMITED: seconds until the caller may retry (also sent as Retry-After). */
    retryAfterSeconds?: number;
  };
}

export interface Page<T> {
  items: T[];
  /** Pass back as ?cursor= for the next page; null when there is no more. */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Auth and own profile
// ---------------------------------------------------------------------------
export interface SignUpRequest {
  email: string;
  /** 8 to 72 characters. */
  password: string;
  role: SignUpRole;
  /** 1 to 80 characters. Public for chefs and in review snapshots. Never the email. */
  displayName: string;
}
export interface SignUpResponse {
  user: MeProfile;
  /** True when a session cookie was set (email confirmation off in the demo). */
  signedIn: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  user: MeProfile;
}
export interface LogoutResponse {
  ok: true;
}

export interface MeProfile {
  id: string;
  role: UserRole;
  displayName: string;
  country: string;
  currency: string;
  language: string;
}

export interface MePrivate {
  /** Masked, e.g. "+1******4567". The full number is never returned to the owner's browser either. */
  phoneMasked: string | null;
  /** MOCK SMS verification. */
  phoneVerified: boolean;
  address: {
    line: string;
    city: string;
    postalCode: string;
    postalPrefix: string;
  } | null;
}

export interface MeResponse {
  profile: MeProfile;
  private: MePrivate;
  /** Present only when role is "chef". */
  chef: ChefOwnSummary | null;
}

export interface UpdateMeRequest {
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Phone (MOCK SMS) and home address
// ---------------------------------------------------------------------------
export interface PhoneSubmitRequest {
  /** Any common Canadian format; the server normalizes to +1XXXXXXXXXX. */
  phone: string;
}
export interface PhoneSubmitResponse {
  phoneMasked: string;
  /** Always true while SMS is simulated. Show a visible MOCK badge. */
  mock: true;
  /** Hint to display in the UI. */
  mockHint: "MOCK: no SMS was sent. Enter any 6 digits.";
}
export interface PhoneVerifyRequest {
  /** MOCK: any 6 digits is accepted in demo mode. */
  code: string;
}
export interface PhoneVerifyResponse {
  phoneVerified: true;
  mock: true;
}

export interface AddressRequest {
  line: string;
  city: string;
  /** Any spacing or case; must be a GTA postal code (prefix in postal_prefixes). */
  postalCode: string;
}
export interface AddressResponse {
  address: NonNullable<MePrivate["address"]>;
}

// ---------------------------------------------------------------------------
// Chef application (own)
// ---------------------------------------------------------------------------
export type DocumentKind = "id_document" | "food_handler" | "kitchen_photo";

export interface ChefOwnSummary {
  status: ChefStatus;
  displayName: string;
  bio: string | null;
  photoPath: string | null;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  servicePostalPrefix: string | null;
  serviceRadiusKm: number;
  locationOptions: LocationType[];
  /** Set by an admin after the MOCK kitchen review. */
  chefHomeEnabled: boolean;
  country: string;
  currency: string;
  language: string;
}

/** Items still needed before an application can be submitted (also sent as `error.missing`). */
export type ApplicationMissingItem =
  | "displayName"
  | "bio"
  | "photo"
  | "cuisines"
  | "languages"
  | "hourlyRate"
  | "servicePostalPrefix"
  | "locationOptions"
  | "idDocument"
  | "foodHandler"
  | "allergenAcknowledgement"
  | "phoneVerified"
  | "sampleDish"
  // Only when "chef_home" is in locationOptions:
  | "kitchenAddress"
  | "kitchenPhotos"
  | "kitchenHygieneAcknowledgement";

export interface ChefApplication extends ChefOwnSummary {
  rejectReason: string | null;
  /** MOCK statuses, read-only for the chef. */
  checks: {
    id: MockCheckStatus;
    foodHandler: MockCheckStatus;
    kitchen: MockCheckStatus;
    police: PoliceCheckStatus;
  };
  /** Object names, always starting with "<chefId>/". Never URLs. */
  documents: {
    idDocumentPath: string | null;
    foodHandlerPath: string | null;
    kitchenPhotoPaths: string[];
  };
  kitchenAddress: { line: string; city: string; postalCode: string } | null;
  allergenAckAt: string | null;
  kitchenHygieneAckAt: string | null;
  /** What is still missing before the application can be submitted. Empty means ready to submit. */
  missing: ApplicationMissingItem[];
}

/** The display name is not editable here: use PATCH /api/me (profiles is the single source). */
export interface UpdateChefApplicationRequest {
  bio?: string | null;
  /** Object name in bucket profile-photos, "<chefId>/...". */
  photoPath?: string | null;
  cuisines?: string[];
  languages?: string[];
  hourlyRateCents?: number;
  servicePostalPrefix?: string;
  serviceRadiusKm?: number;
  locationOptions?: LocationType[];
  /** Required (with kitchen photos and hygiene ack) when locationOptions includes chef_home. */
  kitchenAddress?: { line: string; city: string; postalCode: string };
  /** true records the acknowledgement time (server clock); false is rejected. */
  acknowledgeAllergenStatement?: true;
  /** MOCK acknowledgement. */
  acknowledgeKitchenHygiene?: true;
}

export interface RegisterDocumentRequest {
  kind: DocumentKind;
  /** Object name the client already uploaded with supabase-js: "<chefId>/<file>". */
  path: string;
}
export interface RegisterDocumentResponse {
  application: ChefApplication;
}
export interface RemoveDocumentRequest {
  kind: "kitchen_photo";
  path: string;
}

export interface SubmitApplicationResponse {
  application: ChefApplication;
  /** MOCK: verification of ID and food-handler documents is simulated. */
  mock: true;
}

// ---------------------------------------------------------------------------
// Dishes and availability (own; contract sections 5A and 5B, v1.1)
// ---------------------------------------------------------------------------
export interface Dish {
  id: string;
  name: string;
  /** Object name in bucket dish-photos, "<chefId>/dish-<uuid>.<ext>". Never a URL. */
  photoPath: string | null;
  description: string | null;
  cuisine: string;
  /** 5 to 360. */
  cookMinutes: number;
  /** 0 to 50000. */
  ingredientCostCents: number;
  /** 1 to 50. */
  servings: number;
  /** Lower case, up to 14 entries. */
  allergens: string[];
  /** 0 to 7: the "eat by" date is the visit date plus this. */
  shelfLifeDays: number;
  isActive: boolean;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDishRequest {
  /** 1 to 120 characters. */
  name: string;
  cuisine: string;
  cookMinutes: number;
  photoPath?: string | null;
  description?: string | null;
  ingredientCostCents?: number;
  servings?: number;
  allergens?: string[];
  shelfLifeDays?: number;
}
/** Any subset of the create fields. `isActive: false` deactivates, `true` reactivates. */
export interface UpdateDishRequest extends Partial<CreateDishRequest> {
  isActive?: boolean;
}
export interface ChefDishListResponse {
  items: Dish[];
}

export interface AvailabilityResponse {
  /** Available dates (YYYY-MM-DD, America/Toronto) from `today` on, ascending. */
  days: string[];
  /** The server's today, so a calendar needs no clock of its own. */
  today: string;
  /** Last date that can be marked: today + 180 days. */
  lastBookableDay: string;
}
export interface SetAvailabilityRequest {
  /** Dates to mark available: not in the past, not after `lastBookableDay`. */
  add?: string[];
  /** Dates to clear (any valid date). */
  remove?: string[];
}

// ---------------------------------------------------------------------------
// Admin: chef queue and MOCK checks
// ---------------------------------------------------------------------------
export interface AdminChefListItem {
  id: string;
  displayName: string;
  status: ChefStatus;
  cuisines: string[];
  createdAt: string;
  checks: ChefApplication["checks"];
  chefHomeEnabled: boolean;
  locationOptions: LocationType[];
}
export interface AdminChefListQuery {
  /** Default "pending". */
  status?: ChefStatus | "all";
  /** "pending": only chefs with at least one MOCK check (ID, food handler, kitchen) still `pending`. */
  checks?: "pending";
  /** 1 to 50, default 20. */
  limit?: number;
  cursor?: string;
}
export type AdminChefListResponse = Page<AdminChefListItem>;

export interface SignedDocumentUrl {
  kind: DocumentKind;
  path: string;
  /** Short-lived signed URL (300 seconds). Never store or log it. */
  url: string;
  expiresInSeconds: number;
}
export interface AdminChefDetail {
  application: ChefApplication;
  /** Contact for the admin's review only. */
  email: string | null;
  documents: SignedDocumentUrl[];
}

export interface RejectChefRequest {
  /** 3 to 500 characters. Shown to the chef. */
  reason: string;
}
export interface AdminChefActionResponse {
  application: ChefApplication;
}

/**
 * MOCK checks. Any subset may be sent, at least one. Sending idCheck requires idDocumentPath and
 * sending foodHandlerCheck requires foodHandlerPath: the paths the admin viewed. The server saves
 * only if they still match the stored values, else 409 INVALID_STATE.
 */
export interface AdminChecksRequest {
  idCheck?: MockCheckStatus;
  idDocumentPath?: string;
  foodHandlerCheck?: MockCheckStatus;
  foodHandlerPath?: string;
  policeCheck?: PoliceCheckStatus;
}
export interface KitchenReviewRequest {
  decision: "approve" | "reject";
  /** Required for reject (3 to 500 characters). */
  note?: string;
  /** Kitchen photo paths the admin viewed. Must equal the stored paths, else 409 INVALID_STATE. */
  reviewedPhotoPaths: string[];
  /**
   * Kitchen address the admin viewed. Must equal the stored address, else 409 INVALID_STATE.
   * `null` when no kitchen address is stored (then it must still be missing).
   */
  reviewedAddress: { line: string; city: string; postalCode: string } | null;
}

// ---------------------------------------------------------------------------
// Public chef listing (read-only basics; search and distance come in WO-4)
// ---------------------------------------------------------------------------
export interface PublicChef {
  id: string;
  displayName: string;
  bio: string | null;
  /** Object name in the public profile-photos bucket. */
  photoPath: string | null;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  servicePostalPrefix: string | null;
  serviceCity: string | null;
  serviceRadiusKm: number;
  locationOptions: LocationType[];
  chefHomeEnabled: boolean;
  ratingAvg: number;
  reviewCount: number;
  currency: string;
}
export interface PublicChefListQuery {
  cuisine?: string;
  language?: string;
  /** First three characters of a GTA postal code, e.g. "L5B". */
  prefix?: string;
  limit?: number;
  cursor?: string;
}
export type PublicChefListResponse = Page<PublicChef>;

export interface PostalPrefix {
  prefix: string;
  city: string;
  lat: number;
  lng: number;
}
export interface PostalPrefixListResponse {
  items: PostalPrefix[];
}
