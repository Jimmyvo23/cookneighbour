// Cuisine chips: each cuisine always gets the same warm tint (five tints, picked from the name).
// The visually hidden ", " keeps the sentence "Cuisines: Vietnamese, Thai" for screen readers.
export function chipClass(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return `chip-${h + 1}`;
}

export function CuisineChips({ items }: { items: string[] }) {
  if (!items.length) return <>not listed</>;
  return (
    <>
      {items.map((c, i) => (
        <span key={`${c}-${i}`}>
          {i > 0 && <span className="sr-only">, </span>}
          <span className={`chip ${chipClass(c)}`}>{c}</span>
        </span>
      ))}
    </>
  );
}
