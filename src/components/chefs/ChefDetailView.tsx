"use client";
// Public chef page (T-041). Reads only GET /api/chefs/:id (docs/api-contract.md section 7), so it
// can show nothing private: no address, phone, email, kitchen photos or check statuses. All chef
// text is rendered as plain text (React escapes it). The "Book" button is a stub until WO-4b.
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch, isMockEnabled } from "@/lib/api/client";
import type { PublicChefDetail, PublicDish } from "@/lib/api/types";
import {
  dishPhotoUrl,
  eatByText,
  formatDollars,
  formatMinutes,
} from "@/lib/chef/dishes";
import { MockBadge } from "@/components/MockBadge";
import {
  allergenText,
  groupDatesByMonth,
  isChefDetail,
  locationLabels,
  shortDayLabel,
  windowText,
} from "@/lib/search/detail";
import { profilePhotoUrl, rateText, ratingText } from "@/lib/search/search";

type State =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "ready"; chef: PublicChefDetail };

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";
const sectionCls =
  "flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700";

/** MOCK photo paths are made up: never ask a real storage project for them. */
const storageBase = () =>
  isMockEnabled() ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL;

function ChefPhoto({ name, path }: { name: string; path: string }) {
  const url = profilePhotoUrl(path, storageBase());
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Storage file; no fixed host for next/image
      <img
        src={url}
        alt={`Photo of ${name}`}
        width={112}
        height={112}
        className="size-28 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="chef-photo-fallback"
      className="flex size-28 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-4xl font-semibold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function DishImage({ dish }: { dish: PublicDish }) {
  const url = dishPhotoUrl(dish.photoPath, storageBase());
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Storage file; no fixed host for next/image
      <img
        src={url}
        alt={`Photo of ${dish.name}`}
        width={96}
        height={96}
        className="size-24 shrink-0 rounded-md object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`No photo to show for ${dish.name}`}
      data-testid="dish-photo-fallback"
      className="flex size-24 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-500 p-1 text-center text-xs text-zinc-700 dark:text-zinc-300"
    >
      Photo not available
    </div>
  );
}

function Dish({ dish, currency }: { dish: PublicDish; currency: string }) {
  const cost = formatDollars(dish.ingredientCostCents);
  return (
    <li
      data-testid="dish"
      className="flex gap-4 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
    >
      <DishImage dish={dish} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
        <h3 className="text-base font-semibold">{dish.name}</h3>
        {dish.description && <p className="text-sm">{dish.description}</p>}
        <p className="text-sm">
          <span className="font-medium">Cuisine:</span> {dish.cuisine}
        </p>
        <p className="text-sm">
          <span className="font-medium">Cooking time:</span>{" "}
          {formatMinutes(dish.cookMinutes)}
          {" · "}
          <span className="font-medium">Serves:</span> {dish.servings}
        </p>
        <p className="text-sm">
          <span className="font-medium">Estimated ingredient cost:</span> {cost}
          {currency === "CAD" ? "" : ` ${currency}`}
        </p>
        <p className="text-sm">
          <span className="font-medium">Eat by:</span>{" "}
          {eatByText(dish.shelfLifeDays)}
        </p>
        {/* Allergens are words in a box with a heading word, never only a colour. */}
        <p
          data-testid="dish-allergens"
          className="mt-1 rounded-md border-2 border-amber-700 bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-50"
        >
          <span aria-hidden="true">&#9888; </span>
          {allergenText(dish.allergens)}
        </p>
      </div>
    </li>
  );
}

function Dates({ chef }: { chef: PublicChefDetail }) {
  const groups = groupDatesByMonth(chef.bookableDates);
  return (
    <>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {windowText(chef.firstBookableDay ?? chef.today, chef.lastBookableDay)}{" "}
        These are the days the chef marked as available and has not been booked
        on. Same-day booking is not possible. Nothing here books the chef.
      </p>
      {groups.length === 0 ? (
        <p data-testid="no-dates">
          This chef has not marked any available days yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g, i) => (
            <details
              key={g.month}
              open={i === 0}
              className="rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
            >
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                {g.label} ({g.dates.length}{" "}
                {g.dates.length === 1 ? "day" : "days"})
              </summary>
              <ul
                aria-label={`Available days in ${g.label}`}
                className="mt-2 flex flex-wrap gap-2"
              >
                {g.dates.map((d) => (
                  <li
                    key={d}
                    data-testid="bookable-date"
                    className="rounded-md border border-zinc-400 px-2 py-1 text-sm"
                  >
                    <time dateTime={d}>{shortDayLabel(d)}</time>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function BackLink() {
  return (
    <p>
      <Link href="/search" className={linkCls}>
        Back to the search
      </Link>
    </p>
  );
}

export function ChefDetailView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const bookHintId = useId();

  // Only the newest request may change the screen.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState({ kind: "loading" });
    try {
      const chef = await apiFetch<PublicChefDetail>(
        `/api/chefs/${encodeURIComponent(id)}`,
      );
      if (mine !== seq.current) return;
      // A broken answer is the same as a failed load: the retry state, never a crash.
      setState(
        isChefDetail(chef) ? { kind: "ready", chef } : { kind: "error" },
      );
    } catch (err) {
      if (mine !== seq.current) return;
      // One state for every 404 (unknown, not a uuid, pending, rejected, hidden): nothing tells them apart.
      setState(
        err instanceof ApiClientError && err.status === 404
          ? { kind: "notFound" }
          : { kind: "error" },
      );
    }
  }, [id]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [load]);

  useEffect(() => {
    document.title =
      state.kind === "ready"
        ? `${state.chef.displayName} — CookNeighbour`
        : state.kind === "notFound"
          ? "Chef not found — CookNeighbour"
          : "Chef — CookNeighbour";
  }, [state]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <BackLink />

      {state.kind === "loading" && (
        <p role="status" data-testid="loading">
          Loading the chef...
        </p>
      )}

      {state.kind === "notFound" && (
        <div data-testid="not-found" className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Chef not found
          </h1>
          <p>
            We could not find this chef. The link may be wrong, or the chef is
            not available to book right now.
          </p>
          <p>
            <Link href="/search" className={linkCls}>
              Search for a home cook
            </Link>
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div
          role="alert"
          data-testid="load-error"
          className="flex flex-col gap-3"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            The chef page did not load
          </h1>
          <p>Something went wrong on our side or the connection dropped.</p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 rounded-md border-2 border-emerald-800 px-4 font-semibold text-emerald-900 hover:bg-emerald-50 dark:text-emerald-200 dark:hover:bg-emerald-950"
            >
              Try again
            </button>
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <Ready chef={state.chef} hintId={bookHintId} />
      )}
    </main>
  );
}

function Ready({ chef, hintId }: { chef: PublicChefDetail; hintId: string }) {
  const options = locationLabels(chef.locationOptions);
  const hasChefHome = chef.locationOptions.includes("chef_home");
  return (
    <>
      <header className="flex items-center gap-4">
        <ChefPhoto name={chef.displayName} path={chef.photoPath} />
        <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          <h1 className="text-2xl font-semibold tracking-tight">
            {chef.displayName}
          </h1>
          <p>
            <span className="font-semibold">
              {rateText(chef.hourlyRateCents, chef.currency)}
            </span>
            {" · "}
            {ratingText(chef.ratingAvg, chef.reviewCount)}
          </p>
          {chef.serviceCity && (
            <p className="text-sm">
              Works around {chef.serviceCity}, up to {chef.serviceRadiusKm} km
              away
            </p>
          )}
        </div>
      </header>

      <section aria-labelledby="about-h" className={sectionCls}>
        <h2 id="about-h" className="text-lg font-semibold">
          About
        </h2>
        <p className="[overflow-wrap:anywhere] whitespace-pre-line">
          {chef.bio}
        </p>
        <p className="text-sm">
          <span className="font-medium">Cuisines:</span>{" "}
          {chef.cuisines.length ? chef.cuisines.join(", ") : "not listed"}
        </p>
        <p className="text-sm">
          <span className="font-medium">Languages:</span>{" "}
          {chef.languages.length ? chef.languages.join(", ") : "not listed"}
        </p>
      </section>

      <section aria-labelledby="where-h" className={sectionCls}>
        <h2 id="where-h" className="text-lg font-semibold">
          Where the chef can cook
        </h2>
        <ul className="list-disc pl-5" data-testid="location-options">
          {options.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        {hasChefHome && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            The chef&apos;s kitchen was reviewed by an admin{" "}
            <MockBadge>MOCK check</MockBadge> Nothing was inspected for real.
            The address is not shown here.
          </p>
        )}
      </section>

      <section aria-labelledby="dishes-h" className={sectionCls}>
        <h2 id="dishes-h" className="text-lg font-semibold">
          Dishes
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Costs are estimates. Always read the allergens: you will also fill in
          an allergy form when booking opens.
        </p>
        <ul aria-label="Dishes on the menu" className="flex flex-col gap-3">
          {chef.dishes.map((d) => (
            <Dish key={d.id} dish={d} currency={chef.currency} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="dates-h" className={sectionCls}>
        <h2 id="dates-h" className="text-lg font-semibold">
          Available days
        </h2>
        <Dates chef={chef} />
      </section>

      <section aria-labelledby="book-h" className={sectionCls}>
        <h2 id="book-h" className="text-lg font-semibold">
          Book this chef
        </h2>
        <p id={hintId} className="text-sm text-zinc-700 dark:text-zinc-300">
          Booking opens soon. This button does nothing yet and no booking is
          made.
        </p>
        <p>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby={hintId}
            data-testid="book-stub"
            onClick={(e) => e.preventDefault()}
            className="min-h-11 cursor-not-allowed rounded-md bg-zinc-200 px-4 font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
          >
            Booking opens soon
          </button>
        </p>
      </section>
    </>
  );
}
