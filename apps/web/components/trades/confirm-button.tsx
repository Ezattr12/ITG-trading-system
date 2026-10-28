"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Two-step confirm for destructive actions (Phase 3).
 * First click arms the button ("Click again to confirm"),
 * second click submits the surrounding form. No window.confirm,
 * no accidental deletes.
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
    <Button
      type={armed ? "submit" : "button"}
      variant={variant}
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
