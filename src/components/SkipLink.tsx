// T-052: "Skip to main content", the first Tab stop on every page (WCAG 2.4.1). It shows only
// while it has focus. Its target is ONE anchor in the layout (`SkipTarget`, after the account
// bar), not a <main> id: earlier pages stay mounted but hidden after in-app navigation
// (lessons-learned section 3), so an id on a page could name a hidden copy. The layout persists,
// so this id exists once.
export const SKIP_TARGET_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${SKIP_TARGET_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:min-h-11 focus:rounded-md focus:border-2 focus:border-ink focus:bg-surface focus:px-4 focus:py-2 focus:font-bold focus:text-ink focus:underline"
    >
      Skip to main content
    </a>
  );
}

/** The place the skip link jumps to: the next Tab goes to the first control of the page. */
export function SkipTarget() {
  return <div id={SKIP_TARGET_ID} tabIndex={-1} className="outline-none" />;
}
