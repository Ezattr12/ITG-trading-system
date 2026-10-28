import type { ReactNode } from "react";
import { AppShellClient } from "./app-shell-client";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getUnreadNotificationCount } from "@/lib/discipline/queries";

/**
 * App shell (Phase 15). The single layout every signed-in page
 * renders: a collapsible left sidebar on desktop, a compact top
 * header, a bottom tab bar on mobile, and a slide-over drawer
 * for the full navigation. The server part resolves the unread
 * notification count and the admin flag — never a fake count —
 * and the client part owns the interactive shell state.
 *
 * `narrow` keeps form pages (Add trade, Profile) at a readable
 * reading width; every other page uses the wide content width.
 */
export async function AppShell({
  email,
  children,
  narrow = false,
}: {
  email: string | null;
  children: ReactNode;
  narrow?: boolean;
}) {
  let unread = 0;
  let isAdmin = false;
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    isAdmin = user?.profile?.role === "admin";
    if (user) {
      unread = await getUnreadNotificationCount(
        await createServerSupabaseClient(),
        user.id,
      );
    }
  }
  return (
    <AppShellClient email={email} unread={unread} isAdmin={isAdmin} narrow={narrow}>
      {children}
    </AppShellClient>
  );
}
