import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { AppShell } from "@/components/app-shell";
import {
  MarkAllNotificationsReadForm,
  MarkNotificationReadForm,
} from "@/components/discipline/mark-read-form";
import { countUnread, sortNotifications } from "@/lib/discipline/notifications";
import { getNotifications } from "@/lib/discipline/queries";

export const metadata = { title: "Notifications — ITG TraderOS" };

/**
 * In-app notifications (Phase 6, spec §30).
 *
 * Rows are created server-side when a discipline reminder
 * escalates, a goal is reached or completed, or a risk event
 * occurs — in-app only, no email / SMS yet. A trader only ever
 * sees their own notifications (RLS).
 */

const TYPE_LABEL: Record<string, string> = {
  goal_reminder: "Goal",
  journal_reminder: "Journal",
  risk_warning: "Risk",
  discipline_warning: "Discipline",
  achievement: "Achievement",
  level_up: "Level up",
  weekly_report: "Weekly report",
  monthly_report: "Monthly report",
  system: "System",
};

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarding?.is_complete) redirect("/onboarding");

  const configured = isSupabaseConfigured();
  const supabase = await createServerSupabaseClient();
  const items = configured ? sortNotifications(await getNotifications(supabase, user.id)) : [];
  const unread = countUnread(items);

  return (
    <AppShell email={user.email}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="page-title">Notifications</h1>
            <p className="page-lede">
              {items.length === 0
                ? "No notifications yet."
                : `${unread} unread of ${items.length} total.`}
            </p>
          </div>
          {unread > 0 ? <MarkAllNotificationsReadForm /> : null}
        </div>

        {items.length === 0 ? (
          <p className="hero-card mt-6 sm:mt-8 card-surface-raised p-4 sm:p-6 text-muted-foreground">
            Nothing here yet. Goal completions, discipline reminders
            and risk warnings will appear here when they happen.
          </p>
        ) : (
          <ul className="mt-6 sm:mt-8 space-y-3">
            {items.map((n, i) => (
              <li
                key={n.id}
                className={`motion-reveal list-row-premium card-surface p-4 sm:p-5 transition-opacity duration-base ease-standard ${n.is_read ? "opacity-70" : "card-glow-blue"}`}
                style={{ animationDelay: `${Math.min(i, 7) * 50}ms` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
                          n.type === "risk_warning" || n.type === "discipline_warning"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                            : n.type === "achievement" || n.type === "level_up"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {TYPE_LABEL[n.type] ?? n.type}
                      </span>
                      <span>
                        {new Date(n.created_at).toLocaleString()}
                        {n.is_read ? "" : " · Unread"}
                      </span>
                    </p>
                    <h2 className="mt-1 font-semibold">{n.title}</h2>
                    {n.body ? (
                      <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                    ) : null}
                  </div>
                  {n.is_read ? null : <MarkNotificationReadForm notificationId={n.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
    </AppShell>
  );
}
