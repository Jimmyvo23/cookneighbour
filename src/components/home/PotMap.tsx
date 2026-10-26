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

/**
 * Pot position on the 520 x 330 map: `x` is the centre and `base` the bottom of the pot (map units),
 * `w` the pot width in percent of the map, `vb` the pot's own drawing box (the box has headroom for the
 * lifted lid, and the dish bubble is drawn above it, outside the box).
 */
const SPOT: Record<
  PotKey,
  { x: number; base: number; w: number; vb: [number, number, number, number] }
> = {
  mississauga: { x: 120, base: 224, w: 18, vb: [58, 58, 128, 138] },
  brampton: { x: 262, base: 168, w: 19, vb: [300, 94, 172, 104] },
  toronto: { x: 424, base: 216, w: 19, vb: [104, 96, 172, 118] },
};

function place(p: PotKey) {
  const s = SPOT[p];
  const widthU = (s.w / 100) * 520;
  const heightU = (s.vb[3] / s.vb[2]) * widthU;
  return {
    left: (s.x / 520) * 100,
    top: ((s.base - heightU / 2) / 330) * 100,
  };
}

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
        Tap or click a pot on the map: who is cooking near you?
      </p>
      <div className="pot-map-scene">
        <MapArt />
        {DEMO_POTS.map((p) => {
          const s = SPOT[p.key];
          const at = place(p.key);
          return (
            <button
              key={p.key}
              type="button"
              className={`pot-btn${open === p.key ? " is-open" : ""}`}
              style={{
                left: `${at.left}%`,
                top: `${at.top}%`,
                ["--pot-w" as string]: `${s.w}%`,
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
            <svg
              viewBox="-42 -42 84 84"
              className="pot-card-dish"
              aria-hidden="true"
              focusable="false"
            >
              <DishArt pot={current.key} />
            </svg>
            <div className="pot-card-text">
              <p>
                <b>{current.dishName}</b>
                <span className="mock-badge pot-demo">DEMO</span>
              </p>
              <p>
                {current.chefName.replace(" (demo)", "")} · {current.city} ·{" "}
                {cookTimeText(current.cookMinutes)}
              </p>
              <Link
                href={
                  found
                    ? chefPath(found.id)
                    : `/search?${new URLSearchParams({ city: current.city, cuisine: current.cuisine }).toString()}`
                }
                className="pot-card-link"
              >
                {found
                  ? `See ${current.chefName.replace(" (demo)", "")}`
                  : `Find ${article(current.cuisine)} ${current.cuisine} cook`}
              </Link>
            </div>
          </>
        ) : (
          <div className="pot-card-text">
            <p>
              <b>Neighbours are cooking.</b>
            </p>
            <p>Pick a pot to see the dish, the cook and how long it takes.</p>
          </div>
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
      <text x="120" y="250" textAnchor="middle" className="pot-map-label">
        Mississauga
      </text>
      <text x="262" y="196" textAnchor="middle" className="pot-map-label">
        Brampton
      </text>
      <text x="424" y="242" textAnchor="middle" className="pot-map-label">
        Toronto
      </text>
      <ellipse cx="120" cy="226" rx="40" ry="8" fill="var(--map-shadow)" />
      <ellipse cx="262" cy="170" rx="40" ry="8" fill="var(--map-shadow)" />
      <ellipse cx="424" cy="218" rx="40" ry="8" fill="var(--map-shadow)" />
    </svg>
  );
}

/** The dish picture, drawn around (0, 0) with a radius of 38: used in the bubble and in the card. */
function DishArt({ pot }: { pot: PotKey }) {
  return (
    <g>
      <circle r="38" fill="var(--pot-bubble-bg)" />
      <circle r="30" fill="var(--pot-bubble-fill)" />
      {pot === "mississauga" && (
        <>
          <path
            d="M-22 -4c7 5 14-5 22 0s15-5 22 0M-22 6c7 5 14-5 22 0s15-5 22 0"
            stroke="var(--pot-bubble-bg)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="-12" cy="-14" rx="6" ry="3" fill="var(--pot-herb)" />
          <ellipse cx="12" cy="14" rx="6" ry="3" fill="var(--pot-herb)" />
        </>
      )}
      {pot === "brampton" && (
        <g fill="var(--pot-bubble-bg)">
          <circle cx="-8" cy="-8" r="5" />
          <circle cx="8" cy="-12" r="5" />
          <circle cx="14" cy="4" r="5" />
          <circle cx="-4" cy="10" r="5" />
          <circle cx="2" cy="0" r="5" />
        </g>
      )}
      {pot === "toronto" && (
        <g fill="var(--pot-bubble-bg)">
          <path d="M-22 0c14-14 34-14 44 0-10 12-30 12-44 0Z" />
          <path d="M22 0l9-7v14Z" />
          <circle cx="-12" cy="-2" r="2.5" fill="var(--pot-bubble-fill)" />
        </g>
      )}
    </g>
  );
}

/** One pot with its lid, steam and a dish bubble. The lid and bubble move only when `.is-open`. */
function PotArt({ pot }: { pot: PotKey }) {
  const { vb } = SPOT[pot];
  const bubbleAt: Record<PotKey, [number, number]> = {
    mississauga: [122, -23],
    brampton: [386, 7],
    toronto: [190, 9],
  };
  const [bx, by] = bubbleAt[pot];
  return (
    <svg
      viewBox={vb.join(" ")}
      className="pot-art"
      aria-hidden="true"
      focusable="false"
    >
      {pot === "mississauga" && (
        <>
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
            fill="var(--pot-lid-red)"
          />
          <rect
            x="170"
            y="126"
            width="14"
            height="10"
            rx="5"
            fill="var(--pot-lid-red)"
          />
          <Steam cx={122} y={92} />
          <g className="pot-art-lid">
            <rect
              x="64"
              y="100"
              width="116"
              height="14"
              rx="7"
              fill="var(--pot-lid-red)"
            />
            <rect
              x="112"
              y="90"
              width="20"
              height="12"
              rx="6"
              fill="var(--pot-lid-red)"
            />
          </g>
        </>
      )}
      {pot === "brampton" && (
        <>
          <path
            d="M320 150h132c-4 30-30 46-66 46s-62-16-66-46Z"
            fill="var(--art-clay)"
          />
          <path
            d="M306 152c0-10 14-10 14-2M466 152c0-10-14-10-14-2"
            stroke="var(--pot-lid-red)"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
          />
          <Steam cx={386} y={124} />
          <g className="pot-art-lid">
            <path d="M322 150c10-22 118-22 128 0Z" fill="var(--pot-lid-red)" />
            <rect
              x="376"
              y="126"
              width="20"
              height="10"
              rx="5"
              fill="var(--pot-lid-red)"
            />
          </g>
        </>
      )}
      {pot === "toronto" && (
        <>
          <rect
            x="120"
            y="150"
            width="140"
            height="62"
            rx="20"
            fill="var(--herb)"
          />
          <rect
            x="108"
            y="166"
            width="16"
            height="12"
            rx="6"
            fill="var(--pot-herb-lid)"
          />
          <rect
            x="256"
            y="166"
            width="16"
            height="12"
            rx="6"
            fill="var(--pot-herb-lid)"
          />
          <Steam cx={190} y={128} />
          <g className="pot-art-lid">
            <path d="M114 152c4-18 148-18 152 0Z" fill="var(--pot-herb-lid)" />
            <rect
              x="180"
              y="128"
              width="20"
              height="10"
              rx="5"
              fill="var(--pot-herb-lid)"
            />
          </g>
        </>
      )}
      <g className="pot-art-bubble">
        <g transform={`translate(${bx} ${by}) scale(1.6)`}>
          <DishArt pot={pot} />
        </g>
      </g>
    </svg>
  );
}

/** Two wisps either side of the pot's middle, so the keyboard focus ring above the pot never
 *  crosses a caramel stroke (T-126 v2: the ring must keep 3:1 against what is behind it). */
function Steam({ cx, y }: { cx: number; y: number }) {
  const wisp = (x: number) => `M${x} ${y}c-8-10 8-14 0-26`;
  return (
    <g className="pot-art-steam">
      <path
        d={`${wisp(cx - 14)}${wisp(cx + 14)}`}
        stroke="var(--map-steam)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}
