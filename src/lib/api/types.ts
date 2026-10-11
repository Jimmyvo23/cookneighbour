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
  | "ADDRESS_NOT_SET" // 409 no usable home address saved (free trial, T-038)
  | "FREE_TRIAL_USED" // 409 free first booking not available (generic on purpose, T-038)
  | "APPLICATION_INCOMPLETE" // 409 approve/submit with missing items
  | "DOUBLE_BOOKED" // 409 the chef already has an active booking on a requested date (T-042)
  | "TOO_MANY_OPEN_REQUESTS" // 409 D-28: three requests are already waiting for an answer (T-042)
  | "REQUEST_EXPIRED" // 409 answering a request past its expiry (T-042, D-19)
  | "CONTACT_DETAILS_NOT_ALLOWED" // 422 text shared before acceptance looks like a phone number, email or URL (T-042, D-34)
  | "DATE_BOOKED" // 409 the chef clears a date that has an open booking (T-042, D-22)
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
    /** Booking requests (T-042): every domain problem found, with stable codes (section 7A). */
    issues?: BookingIssue[];
    /** DATE_BOOKED (T-042): the dates (YYYY-MM-DD) that have an open booking. */
    dates?: string[];
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
  /** MOCK checks that are `failed`, in the order id, foodHandler, kitchen, police (contract v1.3.1). */
  failedChecks: ("id" | "foodHandler" | "kitchen" | "police")[];
  /** True when the chef is `approved` and `failedChecks` is not empty (D-21). */
  flagged: boolean;
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
// Public search and chef detail (contract v1.3, section 7). No auth needed.
// ---------------------------------------------------------------------------
/** Query of GET /api/chefs. Everything is optional; send at most one of postalCode and city. */
export interface PublicChefSearchQuery {
  /** Full GTA postal code ("L5B 1A1") or its first three characters ("L5B"). */
  postalCode?: string;
  /** A GTA city from GET /api/reference/postal-prefixes ("Mississauga"). */
  city?: string;
  cuisine?: string;
  language?: string;
  /** Comma-separated allergens to avoid (A-17): chef needs one active dish free of all of them. */
  avoidAllergens?: string;
  /** Hourly rate bounds, integer cents. */
  minRateCents?: number;
  maxRateCents?: number;
  /** YYYY-MM-DD: the chef ticked this date inside the booking window (D-15). */
  date?: string;
  locationType?: LocationType;
  /** 1 to 50, default 20. */
  limit?: number;
  cursor?: string;
}

/** One search result. Nothing private: no address, phone, email, documents, kitchen photos or statuses. */
export interface PublicChefSearchItem {
  id: string;
  displayName: string;
  /** Object name in the public profile-photos bucket. */
  photoPath: string;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  currency: string;
  ratingAvg: number;
  reviewCount: number;
  serviceCity: string | null;
  serviceRadiusKm: number;
  /** Straight line between postal-area centres (A-1), 0.1 km steps; null without a search point. */
  distanceKm: number | null;
  /** Options a customer can really book: chef_home only when the kitchen was approved. */
  locationOptions: LocationType[];
  /** True when the chef can only be booked at their own home (A-18): the label for results out of reach. */
  chefHomeOnly: boolean;
}
export type PublicChefSearchResponse = Page<PublicChefSearchItem>;

/** An active dish as customers see it (no createdAt, isActive or currency noise). */
export interface PublicDish {
  id: string;
  name: string;
  photoPath: string | null;
  description: string | null;
  cuisine: string;
  cookMinutes: number;
  ingredientCostCents: number;
  servings: number;
  allergens: string[];
  shelfLifeDays: number;
}

/** GET /api/chefs/:id. */
export interface PublicChefDetail {
  id: string;
  displayName: string;
  bio: string;
  photoPath: string;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  currency: string;
  ratingAvg: number;
  reviewCount: number;
  serviceCity: string | null;
  serviceRadiusKm: number;
  locationOptions: LocationType[];
  /** Active dishes, oldest first. At least one (a chef without one is not public, A-20). */
  dishes: PublicDish[];
  /** Ticked dates from tomorrow on, ascending, without dates the chef is already booked on (A-19, D-27, T-042). */
  bookableDates: string[];
  /** The server's window (Toronto, D-15). */
  today: string;
  /**
   * Tomorrow (D-27: no same-day bookings); `bookableDates` never contains an earlier day. The real
   * route always sends it; it is optional in the type only until the mock adapter adds it (T-062).
   */
  firstBookableDay?: string;
  lastBookableDay: string;
}

export interface PostalPrefix {
  prefix: string;
  city: string;
  lat: number;
  lng: number;
}
export interface PostalPrefixListResponse {
  items: PostalPrefix[];
}

// ---------------------------------------------------------------------------
// Bookings (contract v1.4, section 7A, T-042)
// ---------------------------------------------------------------------------
export type BookingStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "cancelled"
  | "completed"
  | "no_show_customer"
  | "no_show_chef"
  | "expired";
export type GroceryOption = "customer_buys" | "chef_shops";

export type BookingIssueCode =
  | "DAYS_COUNT"
  | "DATE_INVALID"
  | "DATE_DUPLICATE"
  | "DATE_IN_PAST"
  | "DATE_TOO_SOON"
  | "DATE_BEYOND_WINDOW"
  | "CHEF_NOT_BOOKABLE"
  | "LOCATION_NOT_OFFERED"
  | "CHEF_HOME_NOT_ENABLED"
  | "CHEF_UNAVAILABLE"
  | "DOUBLE_BOOKED"
  | "POSTAL_NOT_GTA"
  | "CHEF_NO_SERVICE_AREA"
  | "OUTSIDE_SERVICE_AREA"
  | "NO_DISHES"
  | "DISH_NOT_FOUND"
  | "DISH_INACTIVE"
  | "DISH_DUPLICATE"
  | "QUANTITY_INVALID"
  | "VISIT_TOO_LONG"
  | "INTAKE_MISSING"
  | "ALLERGY_NOT_ACKNOWLEDGED";

export interface BookingIssue {
  code: BookingIssueCode;
  message: string;
  /** Zero-based index of the day (in the order sent) when the issue belongs to one day. */
  dayIndex?: number;
  dishId?: string;
}

export interface BookingIntakeRequest {
  /** true = "I have no allergies" (explicit answer, D-23). Then allergens and allergyNotes must be empty. */
  noAllergies?: boolean;
  /** Values of the allergen picker (ALLERGEN_CHOICES), lower case. */
  allergens?: string[];
  /** Free text, up to 300 characters. */
  allergyNotes?: string;
  /** true = "no dietary needs". Then dietaryNotes must be empty. */
  noDietaryNeeds?: boolean;
  /** Free text, up to 500 characters. */
  dietaryNotes?: string;
}

export interface BookingRequestBody {
  chefId: string;
  locationType: LocationType;
  /** customer_home only: the cooking address (a GTA postal code). Not allowed for chef_home. */
  address?: { line: string; city: string; postalCode: string };
  days: { date: string; dishes: { dishId: string; quantity?: number }[] }[];
  groceryOption: GroceryOption;
  /** Mandatory for create; may be left out of an estimate. */
  intake?: BookingIntakeRequest;
  allergyConflictAcknowledged?: boolean;
  /** Ask for the free first booking (default false). */
  useFreeTrial?: boolean;
}

export interface BookingDayEstimate {
  date: string;
  cookMinutes: number;
  labourCents: number;
  ingredientsCents: number;
  travelCents: number;
  platformFeeCents: number;
}

export interface BookingEstimate {
  cookMinutes: number;
  labourCents: number;
  /** Labour before the free trial waiver (equals labourCents without the trial). */
  labourBeforeWaiverCents: number;
  freeTrialWaivedCents: number;
  ingredientsCents: number;
  travelCents: number;
  /** Shown, never collected (MOCK). Not part of totalCents. */
  platformFeeCents: number;
  platformFeePercent: number;
  platformFeeCollected: false;
  totalCents: number;
  currency: string;
  travelRateCentsPerKm: number;
  distanceKm: number | null;
  exceedsSoftLimit: boolean;
  days: BookingDayEstimate[];
}

export interface AllergyConflictView {
  dishId: string;
  dishName: string;
  allergens: string[];
}

export type FreeTrialBlocker =
  "PHONE_NOT_SUBMITTED" | "PHONE_NOT_VERIFIED" | "ADDRESS_NOT_SET" | "USED";

export interface BookingEstimateResponse {
  ok: boolean;
  issues: BookingIssue[];
  estimate: BookingEstimate | null;
  allergyConflicts: AllergyConflictView[];
  freeTrial: { eligible: boolean; blocker: FreeTrialBlocker | null };
  today: string;
  firstBookableDay: string;
  /** When a request made now would expire if the chef does not answer (D-19, D-27). */
  wouldExpireAt: string | null;
}

export interface BookingDishView {
  dishId: string | null;
  name: string;
  quantity: number;
  cookMinutes: number;
  ingredientCostCents: number;
  servings: number;
  allergens: string[];
  /** Visit date plus the dish's shelf-life days (A-7). */
  eatByDate: string;
}

export interface BookingDayView {
  dayNumber: number;
  date: string;
  cookMinutes: number;
  dishes: BookingDishView[];
}

export interface BookingPerson {
  id: string;
  displayName: string;
}

export interface BookingDetail {
  id: string;
  status: BookingStatus;
  /** Who is looking: decides what is hidden before acceptance. */
  viewerRole: "customer" | "chef";
  locationType: LocationType;
  groceryOption: GroceryOption;
  isFreeTrial: boolean;
  createdAt: string;
  expiresAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  chef: BookingPerson & { photoPath: string | null };
  customer: BookingPerson;
  days: BookingDayView[];
  estimate: Omit<
    BookingEstimate,
    | "labourBeforeWaiverCents"
    | "freeTrialWaivedCents"
    | "exceedsSoftLimit"
    | "days"
  >;
  intake: {
    allergies: string;
    dietaryNotes: string;
    allergyConflictAcknowledged: boolean;
  };
  allergyConflicts: AllergyConflictView[];
  /** null until accepted, except the customer's own cooking address (customer_home, customer view). */
  cookingPlace: { line: string; city: string; postalCode: string } | null;
  /** The other party's phone, null until accepted. */
  contact: { displayName: string; phone: string | null } | null;
  /** MOCK: nothing is ever charged. */
  payment: { mock: true; collected: false };
}

export interface BookingSummary {
  id: string;
  status: BookingStatus;
  locationType: LocationType;
  groceryOption: GroceryOption;
  isFreeTrial: boolean;
  createdAt: string;
  expiresAt: string | null;
  firstDay: string;
  dates: string[];
  totalCents: number;
  currency: string;
  /** The chef for a customer, the customer for a chef. */
  counterparty: BookingPerson;
}
export type BookingListResponse = Page<BookingSummary>;

export type BookingListStatus = BookingStatus | "open" | "all";
export interface DeclineBookingRequest {
  /** Required (D-34), 3 to 500 characters, no phone numbers, emails or URLs. */
  reason: string;
}
