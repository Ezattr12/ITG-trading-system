import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getUnreadNotificationCount } from "@/lib/discipline/queries";

/**
 * Minimal app header (Phase 2). Navigation grows in later phases.
 * Phase 6: async, so it can show the unread-notification count
 * (in-app only). When Supabase is not configured there is no
 * session and no badge — never a fake count.
 */
export async function AppHeader({ email }: { email: string | null }) {
  let unread = 0;
  let currentUser: Awaited<ReturnType<typeof getCurrentUser>> = null;
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    currentUser = user;
    if (user) {
      unread = await getUnreadNotificationCount(
        await createServerSupabaseClient(),
        user.id,
      );
    }
  }
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="font-bold">
          ITG TraderOS
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/trades" className="text-muted-foreground hover:text-foreground">
            Trades
          </Link>
          <Link href="/analytics" className="text-muted-foreground hover:text-foreground">
            Analytics
          </Link>
          <Link href="/risk" className="text-muted-foreground hover:text-foreground">
            Risk
          </Link>
          <Link href="/plan" className="text-muted-foreground hover:text-foreground">
            Plan
          </Link>
          <Link href="/psychology" className="text-muted-foreground hover:text-foreground">
            Psychology
          </Link>
          <Link href="/calendar" className="text-muted-foreground hover:text-foreground">
            Calendar
          </Link>
          <Link href="/progress" className="text-muted-foreground hover:text-foreground">
            Progress
          </Link>
          <Link href="/goals" className="text-muted-foreground hover:text-foreground">
            Goals
          </Link>
          <Link href="/levels" className="text-muted-foreground hover:text-foreground">
            Levels
          </Link>
          <Link href="/achievements" className="text-muted-foreground hover:text-foreground">
            Achievements
          </Link>
          <Link href="/certificates" className="text-muted-foreground hover:text-foreground">
            Certificates
          </Link>
          <Link href="/reports" className="text-muted-foreground hover:text-foreground">
            Reports
          </Link>
          <Link href="/reviews/weekly" className="text-muted-foreground hover:text-foreground">
            Weekly Review
          </Link>
          <Link href="/coach" className="text-muted-foreground hover:text-foreground">
            AI Coach
          </Link>
          <Link href="/notifications" className="text-muted-foreground hover:text-foreground">
            Notifications
            {unread > 0 ? (
              <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
          <Link href="/profile" className="text-muted-foreground hover:text-foreground">
            Profile
          </Link>
          {currentUser?.profile?.role === "admin" ? (
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              Admin
            </Link>
          ) : null}
          <span className="hidden text-muted-foreground sm:inline">{email ?? ""}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
