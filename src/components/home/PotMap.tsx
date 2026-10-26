"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isMockEnabled } from "@/lib/api/client";
import {
  cookTimeText,
  DEMO_POTS,
  potLabel,
  type DemoPot,
} from "@/lib/home/demo-pots";
import { chefPath } from "@/lib/search/search";

// T-126 v2: a drawn map of the GTA with three tappable DEMO pots. Not a real map (no tiles, no
// street detail). Each pot is tied to a seeded demo dish (src/lib/home/demo-pots.ts, pinned to the
// seed by a test). An open pot shows its dish in the card and links to that chef's page when the
// public search finds the chef; until then (or if it fails) the link goes to /search.

type PotKey = DemoPot["key"];
type Links = Partial<Record<PotKey, { id: string }>>;

/** Pot centres on the 520 x 330 map, in percent, and the width of each pot drawing. */
const SPOT: Record<PotKey, { left: number; top: number; width: number }> = {
  mississauga: { left: 23.1, top: 52.6, width: 12.5 },
  brampton: { left: 50, top: 28.5, width: 14 },
  toronto: { left: 80.8, top: 53.9, width: 12.5 },
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

async function lookup(p: DemoPot, signal: AbortSignal) {
  const qs = new URLSearchParams({ city: p.city, cuisine: p.cuisine });
  const res = await fetch(`/api/chefs?${qs.toString()}`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    items?: { id?: unknown; displayName?: unknown }[];
  };
  const hit = body.items?.find((i) => i.displayName === p.chefName);
  return typeof hit?.id === "string" ? { id: hit.id } : null;
}

export function PotMap() {
  const [open, setOpen] = useState<PotKey | null>(null);
  const [links, setLinks] = useState<Links>({});

  useEffect(() => {
    // MOCK mode has no real chefs to link to, so every pot keeps the /search link.
    if (isMockEnabled()) return;
    const ctl = new AbortController();
    for (const p of DEMO_POTS) {
      lookup(p, ctl.signal)
        .then((hit) => {
          if (hit && !ctl.signal.aborted) {
            setLinks((prev) => ({ ...prev, [p.key]: hit }));
          }
        })
        .catch(() => {
          // Offline or blocked: the fallback link stays. No error shown, nothing to retry.
        });
    }
    return () => ctl.abort();
  }, []);

  const current = DEMO_POTS.find((p) => p.key === open) ?? null;
  const found = current ? links[current.key] : undefined;

  return (
    <div className="pot-map">
      <p className="pot-map-hint">
        Tap a pot on the map: who is cooking near you?
      </p>
      <div className="pot-map-scene">
        <MapArt />
        {DEMO_POTS.map((p) => {
          const s = SPOT[p.key];
          return (
            <button
              key={p.key}
              type="button"
              className={`pot-btn${open === p.key ? " is-open" : ""}`}
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                ["--pot-w" as string]: `${s.width}%`,
              }}
              aria-label={potLabel(p)}
              aria-pressed={open === p.key}
              onMouseEnter={() => setOpen(p.key)}
              onFocus={() => setOpen(p.key)}
              onClick={() => setOpen(p.key)}
            >
              <PotArt pot={p.key} />
            </button>
          );
        })}
      </div>
      <div className="pot-card" aria-live="polite" data-testid="pot-card">
        {current ? (
          <>
            <p>
              <b>{current.dishName}</b>
              <span className="mock-badge pot-demo">DEMO</span>
            </p>
            <p>
              {current.chefName} · {current.city} ·{" "}
              {cookTimeText(current.cookMinutes)}
            </p>
            <Link
              href={found ? chefPath(found.id) : "/search"}
              className="pot-card-link"
            >
              {found
                ? `See ${current.chefName.replace(" (demo)", "")}`
                : `Find ${article(current.cuisine)} ${current.cuisine} cook`}
            </Link>
          </>
        ) : (
          <>
            <p>
              <b>Neighbours are cooking.</b>
            </p>
            <p>Pick a pot to see the dish, the cook and how long it takes.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** The drawn GTA map: land, Lake Ontario, a park and three roads. Illustration only. */
function MapArt() {
  return (
    <svg
      viewBox="0 0 520 330"
      className="pot-map-art"
      role="img"
      aria-label="Drawn map of Brampton, Mississauga and Toronto, not to scale"
    >
      <rect width="520" height="330" fill="var(--map-land)" />
      <path
        d="M0 262 C120 240 230 290 340 262 S470 250 520 268 V330 H0Z"
        fill="var(--map-lake)"
      />
      <text x="372" y="306" className="pot-map-label pot-map-lake-label">
        Lake Ontario
      </text>
      <g
        stroke="var(--map-road)"
        fill="none"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path
          d="M30 70 C150 110 230 60 360 120 S470 150 510 140"
          strokeWidth="10"
        />
        <path d="M140 20 C160 120 170 200 200 250" strokeWidth="10" />
        <path d="M330 30 C320 120 340 190 360 250" strokeWidth="8" />
      </g>
      <ellipse cx="420" cy="200" rx="38" ry="22" fill="var(--map-park)" />
      <text x="150" y="246" className="pot-map-label">
        Mississauga
      </text>
      <text x="150" y="112" className="pot-map-label">
        Brampton
      </text>
      <text x="388" y="168" className="pot-map-label">
        Toronto
      </text>
      <ellipse cx="120" cy="216" rx="34" ry="8" fill="var(--map-shadow)" />
      <ellipse cx="260" cy="130" rx="34" ry="8" fill="var(--map-shadow)" />
      <ellipse cx="420" cy="214" rx="34" ry="8" fill="var(--map-shadow)" />
    </svg>
  );
}

/** One pot with its lid, steam and a dish bubble. The lid and bubble move only when `.is-open`. */
function PotArt({ pot }: { pot: PotKey }) {
  if (pot === "mississauga") {
    return (
      <svg viewBox="58 36 128 160" className="pot-art" aria-hidden="true">
        <rect
          x="70"
          y="110"
          width="104"
          height="84"
          rx="16"
          fill="var(--art-red)"
        />
        <rect
          x="60"
          y="126"
          width="14"
          height="10"
          rx="5"
          fill="var(--art-red-dark)"
        />
        <rect
          x="170"
          y="126"
          width="14"
          height="10"
          rx="5"
          fill="var(--art-red-dark)"
        />
        <Steam d="M104 92c-8-10 8-14 0-26M124 90c-8-10 8-14 0-26M144 92c-8-10 8-14 0-26" />
        <g className="pot-art-lid">
          <rect
            x="64"
            y="100"
            width="116"
            height="14"
            rx="7"
            fill="var(--art-red-dark)"
          />
          <rect
            x="112"
            y="90"
            width="20"
            height="12"
            rx="6"
            fill="var(--art-red-dark)"
          />
        </g>
        <g className="pot-art-bubble">
          <circle cx="122" cy="44" r="38" fill="var(--surface)" />
          <circle cx="122" cy="44" r="30" fill="var(--gold-wash)" />
          <path
            d="M100 40c7 5 14-5 22 0s15-5 22 0M100 50c7 5 14-5 22 0s15-5 22 0"
            stroke="var(--gold)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="110" cy="30" rx="6" ry="3" fill="var(--herb)" />
          <ellipse cx="134" cy="58" rx="6" ry="3" fill="var(--herb)" />
          <rect
            x="126"
            y="26"
            width="10"
            height="7"
            rx="2"
            fill="var(--art-red)"
          />
        </g>
      </svg>
    );
  }
  if (pot === "brampton") {
    return (
      <svg viewBox="300 36 172 160" className="pot-art" aria-hidden="true">
        <path
          d="M320 150h132c-4 30-30 46-66 46s-62-16-66-46Z"
          fill="var(--map-steel)"
        />
        <path
          d="M306 152c0-10 14-10 14-2M466 152c0-10-14-10-14-2"
          stroke="var(--map-steel-dark)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
        <Steam d="M366 128c-8-10 8-14 0-26M386 126c-8-10 8-14 0-26M406 128c-8-10 8-14 0-26" />
        <g className="pot-art-lid">
          <path d="M322 150c10-22 118-22 128 0Z" fill="var(--map-steel-dark)" />
          <rect
            x="376"
            y="126"
            width="20"
            height="10"
            rx="5"
            fill="var(--map-steel-dark)"
          />
        </g>
        <g className="pot-art-bubble">
          <circle cx="386" cy="76" r="38" fill="var(--surface)" />
          <circle cx="386" cy="76" r="30" fill="var(--art-red)" />
          <g fill="var(--gold-wash)">
            <circle cx="374" cy="68" r="5" />
            <circle cx="390" cy="64" r="5" />
            <circle cx="398" cy="80" r="5" />
            <circle cx="380" cy="86" r="5" />
            <circle cx="388" cy="76" r="5" />
          </g>
          <ellipse cx="372" cy="94" rx="6" ry="3" fill="var(--herb-wash)" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="104 36 172 180" className="pot-art" aria-hidden="true">
      <rect
        x="120"
        y="150"
        width="140"
        height="62"
        rx="20"
        fill="var(--herb)"
      />
      <rect x="108" y="166" width="16" height="12" rx="6" fill="var(--herb)" />
      <rect x="256" y="166" width="16" height="12" rx="6" fill="var(--herb)" />
      <Steam d="M168 132c-8-10 8-14 0-26M190 130c-8-10 8-14 0-26M212 132c-8-10 8-14 0-26" />
      <g className="pot-art-lid">
        <path d="M114 152c4-18 148-18 152 0Z" fill="var(--herb)" />
        <rect
          x="180"
          y="128"
          width="20"
          height="10"
          rx="5"
          fill="var(--herb)"
        />
      </g>
      <g className="pot-art-bubble">
        <circle cx="190" cy="80" r="38" fill="var(--surface)" />
        <circle cx="190" cy="80" r="30" fill="var(--art-red-dark)" />
        <path
          d="M168 80c14-14 34-14 44 0-10 12-30 12-44 0Z"
          fill="var(--gold-wash)"
        />
        <path d="M212 80l9-7v14Z" fill="var(--gold-wash)" />
        <circle cx="178" cy="78" r="2.5" fill="var(--art-red-dark)" />
        <ellipse cx="196" cy="98" rx="5" ry="3" fill="var(--herb-wash)" />
      </g>
    </svg>
  );
}

function Steam({ d }: { d: string }) {
  return (
    <g className="pot-art-steam">
      <path
        d={d}
        stroke="var(--map-steam)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}
