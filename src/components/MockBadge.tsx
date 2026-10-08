// Reusable MOCK label (PLAN.md Rec-4). Use it wherever SMS, ID, payment or other checks are simulated.
export function MockBadge({
  children = "MOCK",
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      data-testid="mock-badge"
      className={`inline-flex items-center gap-1.5 rounded-md border-2 border-amber-600 bg-amber-100 px-2.5 py-1 text-sm font-bold text-amber-950 ${className}`}
    >
      <span aria-hidden="true">&#9888;</span>
      {children}
    </span>
  );
}
