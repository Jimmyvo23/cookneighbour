"use client";
// One chef in the results list (T-040). Public data only (contract section 7): never an address.
import Link from "next/link";
import { useState } from "react";
import { isMockEnabled } from "@/lib/api/client";
import type { PublicChefSearchItem } from "@/lib/api/types";
import {
  chefPath,
  distanceText,
  locationText,
  profilePhotoUrl,
  rateText,
  ratingText,
} from "@/lib/search/search";

function ChefPhoto({ name, path }: { name: string; path: string }) {
  // MOCK photo paths are made up: never ask a real storage project for them.
  const url = profilePhotoUrl(
    path,
    isMockEnabled() ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Storage file; no fixed host for next/image
      <img
        src={url}
        alt={`Photo of ${name}`}
        width={80}
        height={80}
        className="size-20 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  // No picture to show: the initial stands in. The name is right next to it, so it is hidden from
  // screen readers.
  return (
    <div
      aria-hidden="true"
      data-testid="chef-photo-fallback"
      className="flex size-20 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-2xl font-semibold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export function ResultCard({
  item,
  selected,
  mapOpen,
  onShowOnMap,
}: {
  item: PublicChefSearchItem;
  /** The pin for this chef's city is selected on the map. */
  selected: boolean;
  mapOpen: boolean;
  onShowOnMap: (city: string) => void;
}) {
  const distance = distanceText(item.distanceKm);
  return (
    <li
      data-testid="chef-result"
      data-selected={selected ? "true" : undefined}
      className={`flex gap-4 rounded-lg border p-4 ${
        selected
          ? "border-2 border-indigo-800 bg-indigo-50 dark:border-indigo-300 dark:bg-indigo-950"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <ChefPhoto name={item.displayName} path={item.photoPath} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
        <h3 className="text-lg font-semibold">
          <Link
            href={chefPath(item.id)}
            data-chef-link={item.id}
            className="text-emerald-800 underline dark:text-emerald-300"
          >
            {item.displayName}
          </Link>
        </h3>
        {item.chefHomeOnly && (
          <p>
            <span
              data-testid="chef-home-only"
              className="inline-block rounded-md border-2 border-amber-700 bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-950"
            >
              Chef&apos;s home only
            </span>{" "}
            <span className="text-sm">
              You would go to their kitchen; they do not come to you.
            </span>
          </p>
        )}
        <p className="text-sm">
          <span className="font-medium">Cuisines:</span>{" "}
          {item.cuisines.length ? item.cuisines.join(", ") : "not listed"}
        </p>
        <p className="text-sm">
          <span className="font-medium">Languages:</span>{" "}
          {item.languages.length ? item.languages.join(", ") : "not listed"}
        </p>
        <p className="text-sm">
          <span className="font-semibold">
            {rateText(item.hourlyRateCents, item.currency)}
          </span>
          {" · "}
          {ratingText(item.ratingAvg, item.reviewCount)}
        </p>
        <p className="text-sm">
          {item.serviceCity ? `Works around ${item.serviceCity}` : ""}
          {distance ? ` · ${distance}` : ""}
          {item.serviceCity || distance ? " · " : ""}
          {locationText(item)}
        </p>
        {mapOpen && item.serviceCity && (
          <p>
            <button
              type="button"
              onClick={() => onShowOnMap(item.serviceCity as string)}
              aria-pressed={selected}
              className="min-h-11 rounded-md border-2 border-indigo-800 px-3 text-sm font-semibold text-indigo-950 hover:bg-indigo-50 dark:border-indigo-300 dark:text-indigo-100 dark:hover:bg-indigo-950"
            >
              Show on map
              <span className="sr-only">
                {" "}
                for {item.displayName} ({item.serviceCity})
              </span>
            </button>
          </p>
        )}
      </div>
    </li>
  );
}
