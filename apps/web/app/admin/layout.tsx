import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/app-header";
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
      <>
        <AppHeader email={user.email} />
        <main className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="text-2xl font-bold">Admin area</h1>
          <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {gate.reason}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            If you should be an administrator, ask an existing ITG admin to change your role.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm underline">
            Back to dashboard
          </Link>
        </main>
      </>
    );
  }
  return (
    <>
      <nav className="border-b bg-muted/40" aria-label="Admin">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
