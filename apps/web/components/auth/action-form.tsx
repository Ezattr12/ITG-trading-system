"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Client wrapper for auth/onboarding Server Actions.
 * Shows the action's error/message, disables submit while
 * Supabase is not configured, and navigates on `redirectTo`.
 *
 * `submitClassName` (Phase 19, Add Trade): when set, the
 * submit renders as a native <button> with that class
 * instead of the shadcn Button, so a page can use its own
 * premium button treatment (the gradient Save Trade button
 * with its light sweep) without fighting Tailwind's
 * utility cascade. Same pending/disabled behaviour either
 * way.
 *
 * Motion (Phase 16): error and success states fade in instead
 * of appearing abruptly, the submit button shows a spinner
 * while pending, and a success state shows a small check that
 * scales in. The message text is always present alongside the
 * icon — animation never carries the information alone.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  extra,
  submitClassName,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: ReactNode;
  extra?: ReactNode;
  submitClassName?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    action,
    { ok: false },
  );
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-4">
      {state.error && (
        <p role="alert" className="motion-fade-in flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="motion-fade-in flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="motion-scale-in mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </p>
      )}
      {children}
      {submitClassName ? (
        <button type="submit" className={submitClassName} disabled={pending || !configured} aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Please wait…
            </>
          ) : (
            submitLabel
          )}
        </button>
      ) : (
        <Button type="submit" className="w-full" disabled={pending || !configured} aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Please wait…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      )}
      {extra}
    </form>
  );
}
