// Original SVG ornaments for the "Grandma's table" look (T-069). Drawn for this project: no
// third-party art, no people, no external files. Colours come from the --art-* tokens in
// globals.css so light and dark mode each get their own palette. All of it is decoration, hidden
// from screen readers. Motion (steam) is switched off by prefers-reduced-motion in globals.css.

/** The steam lines above a pot. Three wavy strokes that drift up and fade. */
function Steam({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <g
      fill="none"
      strokeWidth="5"
      strokeLinecap="round"
      transform={`translate(${x} ${y})`}
    >
      <path className="steam steam-1" d="M170 140c-14-16 14-26 0-44" />
      <path className="steam steam-2" d="M200 132c-14-18 14-30 0-52" />
      <path className="steam steam-3" d="M230 140c-14-16 14-26 0-44" />
    </g>
  );
}

/**
 * The small pot in the site header. Drawn small-first (T-126): one solid silhouette of lid, knob,
 * body and two lugs, with a clear gap between lid and body, so it reads at 16, 24 and 36 px. It
 * has one colour (currentColor) and no thin lines.
 */
export function PotMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <circle cx="12" cy="4.4" r="1.8" />
      <path d="M3.5 11.2C3.5 8 7.2 6.6 12 6.6s8.5 1.4 8.5 4.6z" />
      <path d="M4.5 12.8h15v5.2a3.6 3.6 0 0 1-3.6 3.6H8.1A3.6 3.6 0 0 1 4.5 18z" />
      <rect x="0.8" y="13.6" width="3.7" height="2.4" rx="1.2" />
      <rect x="19.5" y="13.6" width="3.7" height="2.4" rx="1.2" />
    </svg>
  );
}

/** One basil leaf, drawn pointing right from the origin. */
const LEAF = "M0 0C10-20 40-22 56 0C40 22 10 20 0 0Z";

function Sprig({
  transform,
  leaves = 5,
}: {
  transform?: string;
  leaves?: number;
}) {
  const items = Array.from({ length: leaves }, (_, i) => i);
  return (
    <g transform={transform}>
      <path
        d="M0 0C30-6 60-22 96-24"
        fill="none"
        stroke="var(--art-herb-dark)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {items.map((i) => {
        const t = i / (leaves - 1);
        const x = 14 + t * 72;
        const y = -3 - t * 20;
        const up = i % 2 === 0;
        return (
          <g
            key={i}
            transform={`translate(${x} ${y}) rotate(${up ? -52 : 50}) scale(${0.85 - t * 0.2})`}
          >
            <path
              d={LEAF}
              fill={up ? "var(--art-herb)" : "var(--art-herb-light)"}
              stroke="var(--art-herb-dark)"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M6 0H46"
              stroke="var(--art-herb-dark)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      <path
        d="M96-24C104-34 114-30 112-38C106-36 98-34 96-24Z"
        fill="var(--art-herb)"
        stroke="var(--art-herb-dark)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** The big picture in the hero: a pot on a plate, a wooden spoon, basil. It is the first paint and the fallback of the 3D pot (T-126). */
export function HeroArt({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="10 0 420 370"
      className={className}
    >
      {/* wooden spoon, behind the pot */}
      <g transform="rotate(24 330 210)">
        <rect
          x="323"
          y="96"
          width="14"
          height="170"
          rx="7"
          fill="var(--art-wood)"
          stroke="var(--art-wood-dark)"
          strokeWidth="3"
        />
        <ellipse
          cx="330"
          cy="92"
          rx="26"
          ry="34"
          fill="var(--art-wood)"
          stroke="var(--art-wood-dark)"
          strokeWidth="3"
        />
        <ellipse
          cx="330"
          cy="90"
          rx="15"
          ry="22"
          fill="none"
          stroke="var(--art-wood-dark)"
          strokeWidth="2"
          opacity="0.5"
        />
      </g>
      {/* plate */}
      <circle
        cx="200"
        cy="215"
        r="150"
        fill="var(--art-plate)"
        stroke="var(--art-gold)"
        strokeWidth="4"
      />
      <circle
        cx="200"
        cy="215"
        r="136"
        fill="none"
        stroke="var(--art-gold)"
        strokeWidth="2.5"
        strokeDasharray="1 8"
        strokeLinecap="round"
      />
      {/* pot */}
      <g transform="translate(0 18)">
        <Steam />
        <path
          d="M110 205h-24a11 11 0 0 0 0 22h24M290 205h24a11 11 0 0 1 0 22h-24"
          fill="none"
          stroke="var(--art-red-dark)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M110 205h180v50a55 55 0 0 1-55 55h-70a55 55 0 0 1-55-55z"
          fill="var(--art-red)"
          stroke="var(--art-red-dark)"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path
          d="M128 224v26"
          stroke="var(--art-cream)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M118 205A82 38 0 0 1 282 205Z"
          fill="var(--art-red)"
          stroke="var(--art-red-dark)"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path
          d="M140 192c10-12 28-18 46-19"
          fill="none"
          stroke="var(--art-cream)"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.55"
        />
        <circle
          cx="200"
          cy="165"
          r="11"
          fill="var(--art-gold)"
          stroke="var(--art-red-dark)"
          strokeWidth="3"
        />
        <rect
          x="104"
          y="198"
          width="192"
          height="14"
          rx="7"
          fill="var(--art-gold)"
          stroke="var(--art-red-dark)"
          strokeWidth="3"
        />
      </g>
      <Sprig transform="translate(40 332) rotate(-18)" leaves={5} />
      <Sprig
        transform="translate(360 330) scale(-1 1) rotate(-30)"
        leaves={4}
      />
    </svg>
  );
}

/** A small basil sprig, used as a divider flourish. */
export function SprigMark({ className = "h-7 w-12" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-4 -48 130 56"
      className={className}
    >
      <Sprig leaves={5} />
    </svg>
  );
}

/** An empty plate with a fork and a spoon, for "nothing to show yet". */
export function EmptyPlate({ className = "size-28" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 200 140"
      className={className}
    >
      <g
        fill="none"
        stroke="var(--art-wood-dark)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 30v26a8 8 0 0 0 16 0V30M30 56v54M30 30v-8" />
        <path d="M170 110V62c-12-2-14-26 0-34c14 8 12 32 0 34" />
      </g>
      <circle
        cx="100"
        cy="70"
        r="52"
        fill="var(--art-plate)"
        stroke="var(--art-gold)"
        strokeWidth="4"
      />
      <circle
        cx="100"
        cy="70"
        r="36"
        fill="none"
        stroke="var(--art-gold)"
        strokeWidth="2.5"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      <Sprig transform="translate(78 84) scale(0.55)" leaves={4} />
    </svg>
  );
}

/** A five-point star for the rating badge. */
export function Star({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
    >
      <path
        d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.6l-5.9 3.2 1.2-6.5L2.5 9.7l6.6-.9z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
