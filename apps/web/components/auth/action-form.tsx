"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Client wrapper for auth/onboarding Server Actions.
 * Shows the action's error/message, disables submit while
 * Supabase is not configured, and navigates on `redirectTo`.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  extra,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: ReactNode;
  extra?: ReactNode;
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
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {state.message}
        </p>
      )}
      {children}
      <Button type="submit" className="w-full" disabled={pending || !configured}>
        {pending ? "Please wait…" : submitLabel}
      </Button>
      {extra}
    </form>
  );
}
