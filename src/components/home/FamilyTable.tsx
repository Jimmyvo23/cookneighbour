// T-126 v2: "one table, many cultures". A family table seen from above with shared dishes, chopsticks,
// a spoon and a fork. Static SVG, decorative (aria-hidden), no people. On hover of `.home-table` the
// steam rises, the bowls bob and the chopsticks lift (rules in globals.css; none under reduced motion).
export function FamilyTable({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 210"
      className={`family-table ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="30"
        y="20"
        width="340"
        height="170"
        rx="22"
        fill="var(--table-top)"
      />
      <g className="ft-steam">
        <path
          d="M186 52c-7-9 7-12 0-22M200 50c-7-9 7-12 0-22M214 52c-7-9 7-12 0-22"
          stroke="var(--surface)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <g className="ft-centre">
        <circle cx="200" cy="105" r="46" fill="var(--surface)" />
        <circle cx="200" cy="105" r="34" fill="var(--art-gold)" />
        <g fill="var(--gold-wash)">
          <circle cx="190" cy="98" r="6" />
          <circle cx="208" cy="112" r="6" />
          <circle cx="196" cy="116" r="5" />
        </g>
      </g>
      <g className="ft-bob ft-b1">
        <circle cx="96" cy="70" r="28" fill="var(--surface)" />
        <circle cx="96" cy="70" r="20" fill="var(--art-red)" />
      </g>
      <g className="ft-bob ft-b2">
        <circle cx="300" cy="62" r="22" fill="var(--surface)" />
        <circle cx="300" cy="62" r="15" fill="var(--art-clay)" />
      </g>
      <g className="ft-bob ft-b3">
        <circle cx="304" cy="140" r="28" fill="var(--surface)" />
        <circle cx="304" cy="140" r="20" fill="var(--herb)" />
      </g>
      <g className="ft-chop">
        <path
          d="M70 130l44 30M78 124l44 30"
          stroke="var(--art-wood-dark)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <g className="ft-spoon">
        <path
          d="M136 168h40"
          stroke="var(--art-clay)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <ellipse cx="128" cy="168" rx="10" ry="7" fill="var(--art-clay)" />
      </g>
      <g className="ft-fork">
        <path
          d="M226 172h44"
          stroke="var(--art-clay)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M226 166v12M219 166v12"
          stroke="var(--art-clay)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
