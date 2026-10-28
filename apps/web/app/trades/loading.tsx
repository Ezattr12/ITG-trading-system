import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Loading state (Phase 16). A skeleton that matches the page
 * shape, so navigation feels instant and the layout does not
 * jump when the real content arrives. No fake text, no fake
 * numbers — only muted blocks.
 */
export default function Loading() {
  return <PageSkeleton />;
}
