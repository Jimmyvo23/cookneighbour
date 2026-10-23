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
        className="size-20 shrink-0 rounded-full border-2 border-gold object-cover"
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
      className="flex size-20 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-[var(--gold-wash)] font-display text-3xl font-bold text-goldtext"
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
      className={`card flex gap-4 p-4 sm:gap-5 sm:p-5 ${
        selected ? "!border-2 !border-primary !bg-[var(--tint)]" : ""
      }`}
    >
      <ChefPhoto name={item.displayName} path={item.photoPath} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 [overflow-wrap:anywhere]">
        <h3 className="text-xl">
          <Link
            href={chefPath(item.id)}
            data-chef-link={item.id}
            className="underline"
          >
            {item.displayName}
          </Link>
        </h3>
        {item.chefHomeOnly && (
          <p>
            <span data-testid="chef-home-only" className="tag">
              Chef&apos;s home only
            </span>{" "}
            <span className="hint">
              You would go to their kitchen; they do not come to you.
            </span>
          </p>
        )}
        <p className="text-[0.9375rem]">
          <span className="font-bold text-muted">Cuisines:</span>{" "}
          {item.cuisines.length ? item.cuisines.join(", ") : "not listed"}
        </p>
        <p className="text-[0.9375rem]">
          <span className="font-bold text-muted">Languages:</span>{" "}
          {item.languages.length ? item.languages.join(", ") : "not listed"}
        </p>
        <p className="text-[0.9375rem]">
          <span className="text-base font-bold">
            {rateText(item.hourlyRateCents, item.currency)}
          </span>
          {" · "}
          {ratingText(item.ratingAvg, item.reviewCount)}
        </p>
        <p className="text-[0.9375rem]">
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
              className="btn-secondary !min-h-11 !px-3 !text-[0.9375rem]"
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
