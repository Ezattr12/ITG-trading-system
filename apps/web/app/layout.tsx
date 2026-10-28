import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
