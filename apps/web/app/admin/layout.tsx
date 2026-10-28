import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { adminGate } from "@/lib/admin/access";

/**
 * Admin area layout (Phase 10, spec §10).
 *
 * Access control: only users whose profile role is 'admin' get
 * in. A non-admin (or auditor) sees a clear "not authorised"
 * page — never a redirect loop, and never any admin data, because
 * the child pages are not rendered at all when the gate fails.
 * The gate reads the signed-in user's profile row; RLS
 * (`public.is_admin()`) enforces the same rule in the database.
 *
 * The admin section nav sits inside the app shell, above the
 * admin page content, so the sidebar and the admin nav never
 * fight for the same space.
 */

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/certificates", label: "Certificates" },
  { href: "/admin/achievements", label: "Achievements" },
  { href: "/admin/levels", label: "Levels" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const gate = adminGate(user.profile ?? null);
  if (!gate.allowed) {
    return (
      <AppShell email={user.email}>
        <h1 className="page-title">Admin area</h1>
        <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {gate.reason}
        </p>
        <p className="mt-4 text-base text-muted-foreground">
          If you should be an administrator, ask an existing ITG admin to change your role.
        </p>
        <Link href="/dashboard" className="action-link mt-4">
          Back to dashboard
        </Link>
      </AppShell>
    );
  }
  return (
    <AppShell email={user.email}>
      <nav className="-mx-4 -mt-6 mb-6 overflow-x-auto border-b bg-muted/40 sm:-mx-6" aria-label="Admin">
        <div className="flex min-h-11 items-center gap-1 px-4 text-sm sm:px-6">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </AppShell>
  );
}
