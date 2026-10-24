// Drawn stars (an SVG, not text glyphs). The number is always in the text for screen readers, and
// a filled star differs from an empty one by shape (fill versus outline), not only by colour.
const PATH =
  "M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6 6 20.9l1.3-6.7-5-4.7 6.8-.8z";

export function Star({
  filled,
  size = 20,
}: {
  filled: boolean;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-success "
    >
      <path
        d={PATH}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "4 out of 5" with the stars drawn beside it. */
export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" data-testid="stars">
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} filled={n <= value} />
        ))}
      </span>
      <span className="font-medium">{value} out of 5</span>
    </span>
  );
}
