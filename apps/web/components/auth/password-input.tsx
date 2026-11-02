"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Password field with a visibility toggle (spec §37).
 *
 * Master Web UI Redesign (Task 4 sweep) — PRESENTATION
 * ONLY: the input rides the v2 form system (.itg2-input),
 * and .itg2-input-toggle restores the right-side
 * clearance for the toggle that the layered pr-16
 * utility used to supply (the unlayered input recipe's
 * padding shorthand defeats it — see itg2.css). The
 * spread props, the password/text type switch and the
 * toggle behaviour are exactly as before.
 */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="itg2-input itg2-input-toggle" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1/2 h-8 -translate-y-1/2"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
