// T-126 v2: the three demo pots on the home map. DEMO data only: each pot points at a seeded demo
// dish (scripts/seed-data.ts). demo-pots.test.ts checks every field against the seed, so the home
// page can never show a dish, cook, city or time that does not exist.

export interface DemoPot {
  key: "mississauga" | "brampton" | "toronto";
  city: "Mississauga" | "Brampton" | "Toronto";
  /** The seed displayName, for example "Chef Lan (demo)". */
  chefName: string;
  /** Short label shown on the card. */
  dishName: string;
  /** The exact seed dish name. */
  seedDishName: string;
  /** One of the chef's seed cuisines, used for the API lookup. */
  cuisine: string;
  cookMinutes: number;
}

export const DEMO_POTS: readonly DemoPot[] = [
  {
    key: "mississauga",
    city: "Mississauga",
    chefName: "Chef Lan (demo)",
    dishName: "Pho bo",
    seedDishName: "Pho bo (beef noodle soup)",
    cuisine: "Vietnamese",
    cookMinutes: 240,
  },
  {
    key: "brampton",
    city: "Brampton",
    chefName: "Chef Harpreet (demo)",
    dishName: "Chole and roti",
    seedDishName: "Chole and roti",
    cuisine: "Indian",
    cookMinutes: 90,
  },
  {
    key: "toronto",
    city: "Toronto",
    chefName: "Chef Devon (demo)",
    dishName: "Brown stew fish",
    seedDishName: "Brown stew fish",
    cuisine: "Jamaican",
    cookMinutes: 70,
  },
];

/** 240 -> "about 4 h", 90 -> "about 1.5 h", 70 -> "about 1 h 10 min", 45 -> "about 45 min". */
export function cookTimeText(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `about ${h} h`;
  if (m === 30) return `about ${h}.5 h`;
  return `about ${h} h ${m} min`;
}

/** "Pho bo by Chef Lan (demo)" */
export function potLabel(p: DemoPot): string {
  return `${p.dishName} by ${p.chefName}`;
}
