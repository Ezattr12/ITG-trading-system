import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { adminGate } from "@/lib/admin/access";

/**
 * Admin area layout (Phase 10, spec §10).
 *
 * Access control: only users whose profile role is 'admin' get
 * in. A non-admin (or auditor) gets the indistinguishable 404 —
 * the same response as a route that does not exist.
 *
 * Why notFound() and not a friendly gate screen: with a returned
 * gate screen the layout's render finishes normally, and the
 * App Router still streams the child page segment's rendered
 * output into the document payload — admin data (audit entries,
 * KPI counts) reached non-admin browsers in the page source even
 * though it was never displayed (found by production probing,
 * 2026-11-02). notFound() aborts the render, so the child page
 * never executes and nothing of it is streamed. The gate reads
 * the signed-in user's profile row; RLS (`public.is_admin()`)
 * enforces the same rule in the database, and every admin action
 * re-checks the role server-side.
 *
 * The admin section nav sits inside the app shell, above the
 * admin page content, so the sidebar and the admin nav never
 * fight for the same space.
 *
 * Master Web UI Redesign (Task 4 sweep): the nav strip's paint
 * moved to the v2 deep-navy glass; the nav items and all copy
 * are exactly as before. The gate's denial response changed
 * from a rendered screen to notFound() for the reason above —
 * a security fix, verified by production probing.
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
    notFound();
  }
  return (
    <AppShell email={user.email}>
      <nav className="-mx-4 -mt-6 mb-6 overflow-x-auto border-b border-[rgba(120,175,255,0.14)] bg-[rgba(6,21,47,0.45)] backdrop-blur-md sm:-mx-6" aria-label="Admin">
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
