import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITG TraderOS",
  description:
    "Institutional Trading & Performance Management System — a gamified trading journal for ITG traders.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
