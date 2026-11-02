import { cn } from "@/lib/utils";

/**
 * Skeleton loaders (Phase 16). A muted shimmer block that holds
 * the layout while a route loads — the page never flashes in
 * empty and never jumps when real content arrives, because the
 * skeleton matches the shape of what is coming. The shimmer is
 * CSS-only and is disabled by the reduced-motion rules in
 * globals.css. Text is never faked: skeletons carry no words.
 * Phase 18: unchanged behaviour — the shimmer gradient already
 * uses the --muted / --secondary tokens, so it follows the new
 * token system with no edit. The card skeletons now carry the
 * shared card radius (rounded-xl) instead of the base .skeleton
 * radius, so a loading card matches a loaded card.
 * Task 10: the card and panel blocks now also carry
 * .itg2-skeleton (apps/web/app/itg2.css) — the L1 glass
 * surface at the v2 card radius (24px, so the rounded-xl is
 * gone: the class supplies the radius), so a loading page
 * wears the same glass as the loaded one. The title and lede
 * bars stay flat .skeleton shimmer — they stand in for text,
 * not for cards. Geometry (heights, grid, gaps) is unchanged.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton", className)} />;
}

/** Skeleton for a page title + lede + a grid of cards. */
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div aria-hidden="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-5 w-72 max-w-full" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="itg2-skeleton h-28" />
        ))}
      </div>
      <Skeleton className="itg2-skeleton mt-6 h-64 w-full" />
    </div>
  );
}
