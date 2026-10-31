"use client";

import { useState } from "react";
import { X } from "lucide-react";

/**
 * Trade-saved banner (Phase 16). Shown on the trade page right
 * after a trade is saved (the save action redirects with
 * ?saved=1). A checkmark draws itself in over 400ms and the
 * banner fades in — a clear confirmation that does not block
 * the trader: it sits above the trade, it is dismissible, and
 * the trade itself is already saved underneath. The text, not
 * the animation, carries the confirmation.
 *
 * Master Web UI Redesign Page 4: the bar renders as
 * `.itg2-notice .itg2-notice-success` (profit-tinted glass);
 * the checkmark, text and dismiss behaviour are unchanged.
 * Used only by the trade detail page.
 */
export function TradeSavedBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="itg2-notice itg2-notice-success motion-fade-in mt-4 shadow-elevation-2"
    >
      <svg
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" strokeOpacity="0.4" />
        <path className="motion-check-draw" pathLength={24} d="M7 12.5l3.2 3.2L17 9" />
      </svg>
      <span className="min-w-0 flex-1">
        <strong>Trade saved.</strong> P&amp;L, ROI and R were calculated
        automatically from your entry — nothing was entered by hand.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss confirmation"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
