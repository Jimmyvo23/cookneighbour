import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AccountBar } from "@/components/AccountBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CookNeighbour — prototype",
  description: "CookNeighbour prototype: hire a home cook for 1 to 3 days.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* usePathname() in AccountBar needs a Suspense boundary on routes with dynamic segments
            (/admin/chefs/[id]); the bar streams in after the page shell. */}
        <Suspense fallback={null}>
          <AccountBar />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
