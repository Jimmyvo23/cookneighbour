// T-030 demo data. Pure data, no I/O, so it can be unit-tested (src/lib/seed-data.test.ts).
// Everything here is FICTIONAL: invented names, example.com emails, 555-01xx phone numbers and
// made-up street addresses. No real people. Statuses of ID, food-handler, police and kitchen
// checks are MOCK values; nothing was verified by anyone.

export type Allergen =
  | "peanuts"
  | "tree_nuts"
  | "milk"
  | "eggs"
  | "fish"
  | "shellfish"
  | "soy"
  | "wheat"
  | "sesame"
  | "mustard"
  | "sulphites";

export interface SeedDish {
  name: string;
  description: string;
  cuisine: string;
  cookMinutes: number;
  ingredientCostCents: number;
  servings: number;
  allergens: Allergen[];
  shelfLifeDays: number;
}

type Check = "not_started" | "pending" | "verified" | "failed";

export interface SeedChef {
  key: string;
  email: string;
  displayName: string;
  status: "pending" | "approved" | "rejected";
  bio: string;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number;
  servicePrefix: string;
  radiusKm: number;
  locationOptions: ("customer_home" | "chef_home")[];
  chefHomeEnabled: boolean;
  rating: { avg: number; count: number };
  /** MOCK check statuses. */
  checks: { id: Check; foodHandler: Check; police: Check; kitchen: Check };
  rejectReason?: string;
  kitchen?: { line: string; city: string; postalCode: string };
  unavailableWeekdays: number[]; // 0 = Sunday
  dishes: SeedDish[];
}

export interface SeedCustomer {
  key: string;
  email: string;
  displayName: string;
  phone: string; // fictional 555-01xx number
  addressLine: string; // fictional
  city: string;
  postalCode: string; // shape-valid, GTA prefix
}

export const DEMO_CHEF_PASSWORD = "DemoChef!2026";
export const DEMO_CUSTOMER_PASSWORD = "DemoCustomer!2026";
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_NAME = "Demo Admin";

export const customers: SeedCustomer[] = [
  {
    key: "customer-1",
    email: "customer1@example.com",
    displayName: "Demo Customer One",
    phone: "+14165550101",
    addressLine: "100 Fictional Way",
    city: "Mississauga",
    postalCode: "L5B1A1",
  },
  {
    key: "customer-2",
    email: "customer2@example.com",
    displayName: "Demo Customer Two",
    phone: "+14165550102",
    addressLine: "200 Imaginary Court",
    city: "Brampton",
    postalCode: "L6Y1A1",
  },
  {
    key: "customer-3",
    email: "customer3@example.com",
    displayName: "Demo Customer Three",
    phone: "+14165550103",
    addressLine: "300 Pretend Crescent",
    city: "Toronto",
    postalCode: "M5V1A1",
  },
];

const ok: SeedChef["checks"] = {
  id: "verified",
  foodHandler: "verified",
  police: "verified",
  kitchen: "verified",
};
const pendingChecks: SeedChef["checks"] = {
  id: "pending",
  foodHandler: "pending",
  police: "not_started",
  kitchen: "not_started",
};

export const chefs: SeedChef[] = [
  {
    key: "lan-vietnamese",
    email: "chef.lan@example.com",
    displayName: "Chef Lan (demo)",
    status: "approved",
    bio: "Fictional demo chef. Retired schoolteacher cooking northern and southern Vietnamese family meals, mild or spicy.",
    cuisines: ["Vietnamese"],
    languages: ["English", "Vietnamese"],
    hourlyRateCents: 2200,
    servicePrefix: "L5B",
    radiusKm: 20,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    rating: { avg: 4.9, count: 14 },
    checks: ok,
    kitchen: {
      line: "10 Example Lane",
      city: "Mississauga",
      postalCode: "L5B2B2",
    },
    unavailableWeekdays: [0],
    dishes: [
      {
        name: "Pho bo (beef noodle soup)",
        description:
          "Slow-simmered beef bone broth, rice noodles, herbs and lime.",
        cuisine: "Vietnamese",
        cookMinutes: 240,
        ingredientCostCents: 3800,
        servings: 6,
        allergens: ["soy", "fish"],
        shelfLifeDays: 2,
      },
      {
        name: "Bun cha Ha Noi",
        description:
          "Grilled pork patties in sweet-sour broth with vermicelli and herbs.",
        cuisine: "Vietnamese",
        cookMinutes: 90,
        ingredientCostCents: 2600,
        servings: 4,
        allergens: ["fish", "soy"],
        shelfLifeDays: 2,
      },
      {
        name: "Ca kho to (caramelized fish in clay pot)",
        description:
          "Catfish braised in caramel sauce with pepper, served with rice.",
        cuisine: "Vietnamese",
        cookMinutes: 75,
        ingredientCostCents: 2400,
        servings: 4,
        allergens: ["fish"],
        shelfLifeDays: 2,
      },
      {
        name: "Goi cuon (fresh spring rolls)",
        description:
          "Shrimp, pork, herbs and vermicelli in rice paper with peanut dip.",
        cuisine: "Vietnamese",
        cookMinutes: 60,
        ingredientCostCents: 1800,
        servings: 6,
        allergens: ["shellfish", "peanuts", "soy"],
        shelfLifeDays: 1,
      },
    ],
  },
  {
    key: "hoa-vietnamese",
    email: "chef.hoa@example.com",
    displayName: "Chef Hoa (demo)",
    status: "approved",
    bio: "Fictional demo chef. Vegetarian and vegan Vietnamese home cooking, travels to your kitchen.",
    cuisines: ["Vietnamese", "Vegetarian"],
    languages: ["English", "Vietnamese"],
    hourlyRateCents: 2000,
    servicePrefix: "L4W",
    radiusKm: 15,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 4.6, count: 5 },
    checks: { ...ok, kitchen: "not_started" },
    unavailableWeekdays: [1],
    dishes: [
      {
        name: "Banh xeo chay (vegan crepes)",
        description: "Crisp turmeric crepes with mushrooms and bean sprouts.",
        cuisine: "Vietnamese",
        cookMinutes: 80,
        ingredientCostCents: 1700,
        servings: 4,
        allergens: ["soy"],
        shelfLifeDays: 2,
      },
      {
        name: "Canh chua chay (sweet-sour soup)",
        description: "Pineapple, tomato and tamarind soup with tofu.",
        cuisine: "Vietnamese",
        cookMinutes: 50,
        ingredientCostCents: 1400,
        servings: 5,
        allergens: ["soy"],
        shelfLifeDays: 2,
      },
      {
        name: "Com chien nam (mushroom fried rice)",
        description: "Wok-fried rice with three kinds of mushrooms.",
        cuisine: "Vietnamese",
        cookMinutes: 35,
        ingredientCostCents: 1100,
        servings: 4,
        allergens: ["soy", "sesame"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "maria-filipino",
    email: "chef.maria@example.com",
    displayName: "Chef Maria (demo)",
    status: "approved",
    bio: "Fictional demo chef. Filipino party-size classics made the way a lola would.",
    cuisines: ["Filipino"],
    languages: ["English", "Tagalog"],
    hourlyRateCents: 2300,
    servicePrefix: "L5N",
    radiusKm: 25,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    rating: { avg: 4.8, count: 21 },
    checks: ok,
    kitchen: {
      line: "20 Sample Street",
      city: "Mississauga",
      postalCode: "L5N3C3",
    },
    unavailableWeekdays: [0, 6],
    dishes: [
      {
        name: "Chicken adobo",
        description:
          "Chicken braised in soy sauce, vinegar, garlic and bay leaf.",
        cuisine: "Filipino",
        cookMinutes: 60,
        ingredientCostCents: 1900,
        servings: 6,
        allergens: ["soy"],
        shelfLifeDays: 3,
      },
      {
        name: "Pancit canton",
        description:
          "Stir-fried egg noodles with vegetables, chicken and shrimp.",
        cuisine: "Filipino",
        cookMinutes: 55,
        ingredientCostCents: 2100,
        servings: 8,
        allergens: ["wheat", "eggs", "shellfish", "soy"],
        shelfLifeDays: 2,
      },
      {
        name: "Sinigang na baboy",
        description: "Sour tamarind pork soup with greens and radish.",
        cuisine: "Filipino",
        cookMinutes: 110,
        ingredientCostCents: 2700,
        servings: 6,
        allergens: ["fish"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "harpreet-indian",
    email: "chef.harpreet@example.com",
    displayName: "Chef Harpreet (demo)",
    status: "approved",
    bio: "Fictional demo chef. Punjabi home cooking: dals, curries and fresh rotis.",
    cuisines: ["Indian", "Punjabi"],
    languages: ["English", "Punjabi", "Hindi"],
    hourlyRateCents: 2400,
    servicePrefix: "L6P",
    radiusKm: 25,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    rating: { avg: 4.7, count: 18 },
    checks: ok,
    kitchen: {
      line: "30 Placeholder Road",
      city: "Brampton",
      postalCode: "L6P4D4",
    },
    unavailableWeekdays: [],
    dishes: [
      {
        name: "Dal makhani",
        description: "Slow-cooked black lentils with butter and cream.",
        cuisine: "Indian",
        cookMinutes: 180,
        ingredientCostCents: 1500,
        servings: 6,
        allergens: ["milk"],
        shelfLifeDays: 3,
      },
      {
        name: "Chole and roti",
        description: "Spiced chickpea curry with fresh whole-wheat flatbread.",
        cuisine: "Indian",
        cookMinutes: 90,
        ingredientCostCents: 1300,
        servings: 6,
        allergens: ["wheat"],
        shelfLifeDays: 2,
      },
      {
        name: "Butter chicken",
        description: "Tandoori-style chicken in a creamy tomato sauce.",
        cuisine: "Indian",
        cookMinutes: 100,
        ingredientCostCents: 2800,
        servings: 6,
        allergens: ["milk", "tree_nuts"],
        shelfLifeDays: 3,
      },
    ],
  },
  {
    key: "giulia-italian",
    email: "chef.giulia@example.com",
    displayName: "Chef Giulia (demo)",
    status: "approved",
    bio: "Fictional demo chef. Sunday-style Italian: sauces, fresh pasta and bakes.",
    cuisines: ["Italian"],
    languages: ["English", "Italian"],
    hourlyRateCents: 2800,
    servicePrefix: "L6H",
    radiusKm: 20,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 4.5, count: 9 },
    checks: { ...ok, kitchen: "not_started" },
    unavailableWeekdays: [1, 2],
    dishes: [
      {
        name: "Lasagna al forno",
        description: "Layered pasta with beef ragu, besciamella and parmesan.",
        cuisine: "Italian",
        cookMinutes: 150,
        ingredientCostCents: 3200,
        servings: 8,
        allergens: ["wheat", "milk", "eggs"],
        shelfLifeDays: 3,
      },
      {
        name: "Minestrone",
        description: "Thick vegetable and bean soup.",
        cuisine: "Italian",
        cookMinutes: 75,
        ingredientCostCents: 1500,
        servings: 8,
        allergens: ["wheat"],
        shelfLifeDays: 3,
      },
      {
        name: "Eggplant parmigiana",
        description: "Baked eggplant, tomato sauce and mozzarella.",
        cuisine: "Italian",
        cookMinutes: 95,
        ingredientCostCents: 2200,
        servings: 6,
        allergens: ["milk", "eggs", "wheat"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "devon-jamaican",
    email: "chef.devon@example.com",
    displayName: "Chef Devon (demo)",
    status: "approved",
    bio: "Fictional demo chef. Jamaican Sunday dinner: jerk, stew peas, rice and peas.",
    cuisines: ["Jamaican", "Caribbean"],
    languages: ["English"],
    hourlyRateCents: 2500,
    servicePrefix: "M9W",
    radiusKm: 30,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    rating: { avg: 4.8, count: 11 },
    checks: ok,
    kitchen: {
      line: "40 Make-Believe Avenue",
      city: "Toronto",
      postalCode: "M9W5E5",
    },
    unavailableWeekdays: [2],
    dishes: [
      {
        name: "Jerk chicken",
        description:
          "Pimento-wood style jerk chicken with scotch bonnet marinade.",
        cuisine: "Jamaican",
        cookMinutes: 120,
        ingredientCostCents: 2300,
        servings: 6,
        allergens: ["soy"],
        shelfLifeDays: 3,
      },
      {
        name: "Rice and peas",
        description: "Coconut rice with kidney beans and thyme.",
        cuisine: "Jamaican",
        cookMinutes: 50,
        ingredientCostCents: 900,
        servings: 8,
        allergens: [],
        shelfLifeDays: 3,
      },
      {
        name: "Brown stew fish",
        description: "Fried snapper simmered in a savoury vegetable gravy.",
        cuisine: "Jamaican",
        cookMinutes: 70,
        ingredientCostCents: 2900,
        servings: 4,
        allergens: ["fish", "soy"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "minjun-korean",
    email: "chef.minjun@example.com",
    displayName: "Chef Min-jun (demo)",
    status: "approved",
    bio: "Fictional demo chef. Korean home cooking: stews, banchan and bibimbap.",
    cuisines: ["Korean"],
    languages: ["English", "Korean"],
    hourlyRateCents: 2600,
    servicePrefix: "L3R",
    radiusKm: 20,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 4.4, count: 6 },
    checks: { ...ok, kitchen: "not_started" },
    unavailableWeekdays: [0],
    dishes: [
      {
        name: "Kimchi jjigae",
        description: "Aged kimchi and pork stew with tofu.",
        cuisine: "Korean",
        cookMinutes: 45,
        ingredientCostCents: 1600,
        servings: 4,
        allergens: ["soy", "fish", "shellfish"],
        shelfLifeDays: 3,
      },
      {
        name: "Bibimbap",
        description: "Rice bowl with seasoned vegetables, beef and gochujang.",
        cuisine: "Korean",
        cookMinutes: 80,
        ingredientCostCents: 2200,
        servings: 4,
        allergens: ["soy", "sesame", "eggs"],
        shelfLifeDays: 1,
      },
      {
        name: "Japchae",
        description:
          "Sweet potato noodles stir-fried with vegetables and beef.",
        cuisine: "Korean",
        cookMinutes: 60,
        ingredientCostCents: 1900,
        servings: 6,
        allergens: ["soy", "sesame"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "layla-lebanese",
    email: "chef.layla@example.com",
    displayName: "Chef Layla (demo)",
    status: "approved",
    bio: "Fictional demo chef. Lebanese mezze and slow-cooked mains for family tables.",
    cuisines: ["Lebanese", "Middle Eastern"],
    languages: ["English", "Arabic", "French"],
    hourlyRateCents: 2500,
    servicePrefix: "L4K",
    radiusKm: 25,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    rating: { avg: 4.7, count: 8 },
    checks: ok,
    kitchen: {
      line: "50 Invented Boulevard",
      city: "Vaughan",
      postalCode: "L4K6F6",
    },
    unavailableWeekdays: [5],
    dishes: [
      {
        name: "Kibbeh and tabbouleh",
        description: "Baked lamb kibbeh with a fresh parsley and bulgur salad.",
        cuisine: "Lebanese",
        cookMinutes: 120,
        ingredientCostCents: 2900,
        servings: 6,
        allergens: ["wheat", "tree_nuts"],
        shelfLifeDays: 2,
      },
      {
        name: "Hummus and fattoush",
        description: "Smooth chickpea hummus with crisp pita salad.",
        cuisine: "Lebanese",
        cookMinutes: 45,
        ingredientCostCents: 1200,
        servings: 6,
        allergens: ["sesame", "wheat"],
        shelfLifeDays: 2,
      },
      {
        name: "Chicken shawarma plate",
        description: "Marinated chicken, garlic sauce, pickles and rice.",
        cuisine: "Lebanese",
        cookMinutes: 90,
        ingredientCostCents: 2400,
        servings: 4,
        allergens: ["milk", "sesame"],
        shelfLifeDays: 2,
      },
    ],
  },
  // Pending applications (never visible in search until an admin approves).
  {
    key: "wei-chinese-pending",
    email: "chef.wei@example.com",
    displayName: "Chef Wei (demo, pending)",
    status: "pending",
    bio: "Fictional pending demo chef. Cantonese home-style dishes.",
    cuisines: ["Chinese", "Cantonese"],
    languages: ["English", "Cantonese", "Mandarin"],
    hourlyRateCents: 2300,
    servicePrefix: "L4B",
    radiusKm: 20,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 0, count: 0 },
    checks: pendingChecks,
    unavailableWeekdays: [],
    dishes: [
      {
        name: "Steamed fish with ginger and scallion",
        description: "Whole fish steamed and finished with hot oil.",
        cuisine: "Chinese",
        cookMinutes: 40,
        ingredientCostCents: 2600,
        servings: 4,
        allergens: ["fish", "soy"],
        shelfLifeDays: 1,
      },
      {
        name: "Congee with pork and century egg",
        description: "Slow-cooked rice porridge.",
        cuisine: "Chinese",
        cookMinutes: 120,
        ingredientCostCents: 1100,
        servings: 6,
        allergens: ["eggs", "soy"],
        shelfLifeDays: 2,
      },
    ],
  },
  {
    key: "selam-ethiopian-pending",
    email: "chef.selam@example.com",
    displayName: "Chef Selam (demo, pending)",
    status: "pending",
    bio: "Fictional pending demo chef. Ethiopian stews and injera.",
    cuisines: ["Ethiopian"],
    languages: ["English", "Amharic"],
    hourlyRateCents: 2200,
    servicePrefix: "M4K",
    radiusKm: 20,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 0, count: 0 },
    checks: pendingChecks,
    unavailableWeekdays: [],
    dishes: [
      {
        name: "Doro wat",
        description: "Slow-cooked chicken stew with berbere and eggs.",
        cuisine: "Ethiopian",
        cookMinutes: 150,
        ingredientCostCents: 2400,
        servings: 6,
        allergens: ["eggs"],
        shelfLifeDays: 3,
      },
      {
        name: "Misir wat",
        description: "Spiced red lentil stew.",
        cuisine: "Ethiopian",
        cookMinutes: 60,
        ingredientCostCents: 900,
        servings: 6,
        allergens: [],
        shelfLifeDays: 3,
      },
    ],
  },
  {
    key: "ana-portuguese-pending",
    email: "chef.ana@example.com",
    displayName: "Chef Ana (demo, pending)",
    status: "pending",
    bio: "Fictional pending demo chef. Portuguese seafood and roast chicken.",
    cuisines: ["Portuguese"],
    languages: ["English", "Portuguese"],
    hourlyRateCents: 2400,
    servicePrefix: "L5A",
    radiusKm: 15,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 0, count: 0 },
    checks: pendingChecks,
    unavailableWeekdays: [],
    dishes: [
      {
        name: "Frango no churrasco",
        description: "Charcoal-style piri-piri chicken with potatoes.",
        cuisine: "Portuguese",
        cookMinutes: 90,
        ingredientCostCents: 2000,
        servings: 4,
        allergens: [],
        shelfLifeDays: 2,
      },
    ],
  },
  // Rejected application (never visible in search).
  {
    key: "carlos-mexican-rejected",
    email: "chef.carlos@example.com",
    displayName: "Chef Carlos (demo, rejected)",
    status: "rejected",
    bio: "Fictional rejected demo chef. Mexican street food.",
    cuisines: ["Mexican"],
    languages: ["English", "Spanish"],
    hourlyRateCents: 2100,
    servicePrefix: "M6H",
    radiusKm: 15,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    rating: { avg: 0, count: 0 },
    checks: {
      id: "failed",
      foodHandler: "pending",
      police: "not_started",
      kitchen: "not_started",
    },
    rejectReason:
      "MOCK demo rejection: the ID document could not be read. Please upload a clearer copy.",
    unavailableWeekdays: [],
    dishes: [
      {
        name: "Tacos al pastor",
        description: "Marinated pork tacos with pineapple.",
        cuisine: "Mexican",
        cookMinutes: 70,
        ingredientCostCents: 2000,
        servings: 6,
        allergens: ["wheat"],
        shelfLifeDays: 2,
      },
    ],
  },
];
