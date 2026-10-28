import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/*
 * Phase 18 — one font family for the whole app: Inter, loaded
 * with next/font/google. Inter was designed for UI and screens:
 * excellent legibility at small sizes, tabular figures for
 * financial numbers, a wide weight range (400-800 here), and a
 * neutral, professional, institutional feel with no decorative
 * character. next/font self-hosts the font at build time, so
 * there is no runtime external request and nothing that can
 * fail or render-block offline in production; if the variable
 * is ever missing, the system stack in globals.css and
 * tailwind.config.ts takes over with no layout shift. No other
 * font family is used anywhere in the app.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "ITG TraderOS",
  description:
    "Institutional Trading & Performance Management System — a gamified trading journal for ITG traders.",
  manifest: "/manifest.webmanifest",
};

// Mobile-first (Phase 15): the viewport must follow the device
// width. Without this, phones render the desktop layout scaled
// down — the "squeezed desktop" look reported on the live site.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12151d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
