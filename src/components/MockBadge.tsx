// Reusable MOCK label (PLAN.md Rec-4). Use it wherever SMS, ID, payment or other checks are simulated.
export function MockBadge({
  children = "MOCK",
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span data-testid="mock-badge" className={`mock-badge ${className}`}>
      <span aria-hidden="true">&#9888;</span>
      {children}
    </span>
  );
}
