import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Loading state: the shared PageSkeleton, matching the six
 * routes that already streamed (dashboard, trades, analytics,
 * levels, notifications, coach). Added by the 2026-11-02
 * performance task: this route previously had no loading
 * boundary, so a navigation waited for the FULL server render
 * before the screen changed at all (measured production TTFB
 * 2.5–6.3s on the routes without one, versus under 1s on the
 * routes with one). The skeleton is real streaming — content
 * arrives as soon as it is ready — not a delay. No fake text,
 * no fake numbers — only muted blocks.
 */
export default function Loading() {
  return <PageSkeleton />;
}
