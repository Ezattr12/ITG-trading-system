"use client";

import { useState } from "react";

/**
 * Two-step confirm for destructive actions (Phase 3).
 * First click arms the button ("Click again to confirm"),
 * second click submits the surrounding form. No window.confirm,
 * no accidental deletes.
 *
 * Master Web UI Redesign Page 4: the shadcn Button is
 * replaced by a native button on the v2 system — outline
 * renders as `.itg2-btn-ghost`, the destructive default as
 * `.itg2-btn-danger` (box + type + paint in itg2.css's
 * unlayered tail, like every bare-button v2 class). The
 * two-step arm behaviour is byte-identical; an armed
 * danger button adds a brightness lift so the state reads
 * visually as well as in the label. Used only by the trade
 * detail page (screenshot delete, cancel trade).
 */
export function ConfirmButton({
  label,
  confirmLabel,
  variant = "destructive",
}: {
  label: string;
  confirmLabel: string;
  variant?: "destructive" | "outline";
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type={armed ? "submit" : "button"}
      className={
        variant === "outline"
          ? "itg2-btn-ghost"
          : `itg2-btn-danger${armed ? " brightness-125" : ""}`
      }
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
