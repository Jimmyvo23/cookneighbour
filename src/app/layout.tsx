import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  Atkinson_Hyperlegible_Next,
  Libre_Caslon_Text,
} from "next/font/google";
import "./globals.css";
import { AccountBar } from "@/components/AccountBar";
import { PotMark } from "@/components/Ornaments";
import { SkipLink, SkipTarget } from "@/components/SkipLink";

// Fonts are downloaded at build time and served from our own domain (CSP stays 'self').
// Both are free under the SIL Open Font License 1.1.
// Headings: Libre Caslon Text, a classic book serif. Body: Atkinson Hyperlegible Next, drawn by the
// Braille Institute so letters are hard to confuse; good for older readers and English learners.
const heading = Libre_Caslon_Text({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "700"],
  // Real italic for the home-page tagline, so the browser does not fake a slant.
  style: ["normal", "italic"],
  display: "swap",
});

const body = Atkinson_Hyperlegible_Next({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
  // No size metrics for this face in Next: globals.css has its own scaled fallback ("Atkinson Fallback").
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "CookNeighbour — prototype",
  description: "CookNeighbour prototype: hire a home cook for 1 to 3 days.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${heading.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SkipLink />
        {/* usePathname() in AccountBar needs a Suspense boundary on routes with dynamic segments
            (/admin/chefs/[id]); the bar streams in after the page shell. */}
        <header className="site-header">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 font-display text-xl font-bold text-link no-underline"
            >
              <PotMark />
              CookNeighbour
            </Link>
            <Suspense fallback={null}>
              <AccountBar />
            </Suspense>
          </div>
        </header>
        <SkipTarget />
        {children}
      </body>
    </html>
  );
}
