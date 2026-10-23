"use client";
// Public chef page (T-041). Reads only GET /api/chefs/:id (docs/api-contract.md section 7), so it
// can show nothing private: no address, phone, email, kitchen photos or check statuses. All chef
// text is rendered as plain text (React escapes it). "Book" links to the booking flow (T-043).
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
import { CuisineChips } from "@/components/chips";
import { EmptyPlate, PotMark, Star } from "@/components/Ornaments";
import { PublicReviews } from "@/components/reviews/PublicReviews";
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

const linkCls = "font-medium underline";
const sectionCls = "card flex flex-col gap-3 p-4";

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
        width={144}
        height={144}
        className="size-28 object-cover sm:size-36"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      data-testid="chef-photo-fallback"
      className="flex size-28 items-center justify-center bg-[var(--gold-wash)] font-display text-6xl font-bold text-goldtext sm:size-36"
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
        className="size-24 object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`No photo to show for ${dish.name}`}
      data-testid="dish-photo-fallback"
      className="flex size-24 items-center justify-center bg-sunken p-1 text-center text-xs text-muted"
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
      className="chef-card flex flex-col gap-4 p-4 sm:flex-row sm:gap-5"
    >
      <div className="polaroid self-start">
        <DishImage dish={dish} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
        <h3 className="text-xl">{dish.name}</h3>
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
          <span className="stamp">{eatByText(dish.shelfLifeDays)}</span>
        </p>
        {/* Allergens are words in a box with a heading word, never only a colour. */}
        <p data-testid="dish-allergens" className="allergen mt-1 self-start">
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
      <p className="hint">
        {windowText(chef.firstBookableDay, chef.lastBookableDay)} These are the
        days the chef marked as available and has not been booked on. Same-day
        booking is not possible.
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
              className="rounded-xl border-2 border-line bg-surface p-3"
            >
              <summary className="min-h-11 cursor-pointer py-2 font-display text-lg font-bold">
                {g.label} ({g.dates.length}{" "}
                {g.dates.length === 1 ? "day" : "days"})
              </summary>
              <ul
                aria-label={`Available days in ${g.label}`}
                className="mt-2 flex flex-wrap gap-2"
              >
                {g.dates.map((d) => (
                  <li key={d} data-testid="bookable-date" className="day">
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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <BackLink />

      {state.kind === "loading" && (
        <div className="flex items-center gap-4">
          <PotMark className="size-14" />
          <p role="status" data-testid="loading">
            Loading the chef...
          </p>
        </div>
      )}

      {state.kind === "notFound" && (
        <div
          data-testid="not-found"
          className="flex flex-col items-start gap-3"
        >
          <EmptyPlate className="size-28" />
          <h1 className="text-2xl">Chef not found</h1>
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
          <h1 className="text-2xl">The chef page did not load</h1>
          <p>Something went wrong on our side or the connection dropped.</p>
          <p>
            <button
              type="button"
              onClick={() => void load()}
              className="btn-secondary"
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
      <header className="band flex flex-col items-center gap-5 sm:flex-row">
        <div className="polaroid">
          <ChefPhoto name={chef.displayName} path={chef.photoPath} />
        </div>
        <div className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
          <h1 className="hero-title text-3xl sm:text-5xl">
            {chef.displayName}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="price-tag">
              {rateText(chef.hourlyRateCents, chef.currency)}
            </span>
            <span className="rating-badge">
              {chef.reviewCount > 0 && <Star />}
              {ratingText(chef.ratingAvg, chef.reviewCount)}
            </span>
          </p>
          {chef.serviceCity && (
            <p className="text-[var(--hero-ink)]">
              Works around {chef.serviceCity}, up to {chef.serviceRadiusKm} km
              away
            </p>
          )}
        </div>
      </header>

      <section aria-labelledby="about-h" className={sectionCls}>
        <h2 id="about-h" className="text-2xl">
          About
        </h2>
        <p className="[overflow-wrap:anywhere] whitespace-pre-line">
          {chef.bio}
        </p>
        <p className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm">
          <span className="font-medium">Cuisines:</span>{" "}
          <CuisineChips items={chef.cuisines} />
        </p>
        <p className="text-sm">
          <span className="font-medium">Languages:</span>{" "}
          {chef.languages.length ? chef.languages.join(", ") : "not listed"}
        </p>
      </section>

      <section aria-labelledby="where-h" className={sectionCls}>
        <h2 id="where-h" className="text-2xl">
          Where the chef can cook
        </h2>
        <ul className="list-disc pl-5" data-testid="location-options">
          {options.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        {hasChefHome && (
          <p className="hint">
            The chef&apos;s kitchen was reviewed by an admin{" "}
            <MockBadge>MOCK check</MockBadge> Nothing was inspected for real.
            The address is not shown here.
          </p>
        )}
      </section>

      <section aria-labelledby="dishes-h" className={sectionCls}>
        <h2 id="dishes-h" className="text-2xl">
          Dishes
        </h2>
        <p className="hint">
          Costs are estimates. Always read the allergens: you will also fill in
          an allergy form when booking opens.
        </p>
        <ul aria-label="Dishes on the menu" className="flex flex-col gap-5">
          {chef.dishes.map((d) => (
            <Dish key={d.id} dish={d} currency={chef.currency} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="dates-h" className={sectionCls}>
        <h2 id="dates-h" className="text-2xl">
          Available days
        </h2>
        <Dates chef={chef} />
      </section>

      <PublicReviews chefId={chef.id} />

      <section aria-labelledby="book-h" className={sectionCls}>
        <h2 id="book-h" className="text-2xl">
          Book this chef
        </h2>
        {chef.bookableDates.length > 0 ? (
          <>
            <p id={hintId} className="hint">
              Pick 1 to 3 days and the dishes for each day, then review the
              estimate. Nothing is sent or charged until you confirm on the last
              step. You need to be logged in as a customer.
            </p>
            <p>
              <Link
                href={`/chefs/${encodeURIComponent(chef.id)}/book`}
                aria-describedby={hintId}
                data-testid="book-link"
                className="btn"
              >
                Book {chef.displayName}
              </Link>
            </p>
          </>
        ) : (
          <p id={hintId} data-testid="book-unavailable">
            This chef has no free days to book right now. Check back later or{" "}
            <Link href="/search" className={linkCls}>
              search for another home cook
            </Link>
            .
          </p>
        )}
      </section>
    </>
  );
}
