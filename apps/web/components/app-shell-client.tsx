"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Award,
  BadgeCheck,
  BarChart3,
  Bell,
  Brain,
  CalendarCheck,
  CalendarDays,
  ChevronsLeft,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { AmbientBackground } from "@/components/ambient-background";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * App shell client (Phase 15).
 *
 * Desktop: collapsible left sidebar + slim top header + content.
 * Mobile: compact top header, bottom tab bar for the five most
 * used sections, and a slide-over drawer for the full navigation.
 * The old header squeezed all eighteen sections into one
 * horizontal row, which overflowed on phones and created the
 * empty space on the right of the live site.
 *
 * Navigation order is the spec order, everywhere it appears:
 * Dashboard, Trades, Analytics, Risk, Trading Plan, Psychology,
 * Calendar, Progress, Goals, Levels, Achievements, Certificates,
 * Reports, Weekly Review, AI Coach, Notifications, Profile, Admin.
 *
 * Depth (Phase 18 Aurora): the shell root is transparent over
 * one fixed `.app-ambient` layer (deep purple / violet /
 * magenta wisp / aurora blue orbs), the sidebar / header are
 * Standard glass and the drawer / bottom dock are Elevated
 * glass, the ITG tile and the centre Add action are violet ->
 * indigo gradients, active nav items get a violet indicator
 * bar and light-violet text (the small-text-readable violet,
 * not the darker --primary), and the bottom bar floats as a
 * rounded glass dock inset from the screen edges. The dock
 * is translucent dark glass with blur, a subtle white border,
 * a deep shadow and a violet active glow — it floats above
 * the app, it is not a flat footer. No behaviour changed. */

type NavItem = { href: string; label: string; icon: LucideIcon; admin?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/risk", label: "Risk", icon: ShieldAlert },
  { href: "/plan", label: "Trading Plan", icon: ClipboardList },
  { href: "/psychology", label: "Psychology", icon: Brain },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/levels", label: "Levels", icon: Award },
  { href: "/achievements", label: "Achievements", icon: Trophy },
  { href: "/certificates", label: "Certificates", icon: BadgeCheck },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/reviews/weekly", label: "Weekly Review", icon: CalendarCheck },
  { href: "/coach", label: "AI Coach", icon: Sparkles },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/admin", label: "Admin", icon: ShieldCheck, admin: true },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/goals", label: "Goals", icon: Target },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
  badge,
}: {
  item: NavItem;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  badge?: number;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-fast ease-standard",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-gradient-to-r from-primary/20 to-primary/5 text-violet ring-1 ring-inset ring-primary/20"
          : "text-muted-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {/* Active indicator (Phase 16): a small bar that grows in
          instead of a hard colour swap. Transform only, so the
          layout never shifts. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-violet to-indigo transition-all duration-base ease-standard",
          active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0",
        )}
      />
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      )}
      {!collapsed && badge !== undefined && badge > 0 ? (
        <span className="motion-scale-in inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      {/* Collapsed rail (Phase 17): the unread count stays
          visible as a small badge on the icon, like the
          collapsed reference sidebar — a real count only,
          never invented. Without it the badge would vanish
          the moment the rail collapses. */}
      {collapsed && badge !== undefined && badge > 0 ? (
        <span className="motion-scale-in absolute right-1.5 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-5 text-destructive-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppShellClient({
  email,
  unread,
  isAdmin,
  narrow,
  children,
}: {
  email: string | null;
  unread: number;
  isAdmin: boolean;
  narrow?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const items = NAV.filter((item) => !item.admin || isAdmin);

  // Drawer enter/exit (Phase 16): the drawer stays mounted for
  // 250ms after closing so the slide-out and overlay fade can
  // play, and it enters on the next frame so the slide-in can
  // play. Without this the drawer would just appear/disappear.
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerEntered, setDrawerEntered] = useState(false);
  useEffect(() => {
    if (drawerOpen) {
      setDrawerMounted(true);
      return;
    }
    if (!drawerMounted) return;
    const t = window.setTimeout(() => setDrawerMounted(false), 250);
    return () => window.clearTimeout(t);
  }, [drawerOpen, drawerMounted]);
  useEffect(() => {
    if (!drawerOpen) {
      setDrawerEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setDrawerEntered(true)),
    );
    return () => cancelAnimationFrame(raf);
  }, [drawerOpen]);

  // Sidebar collapse preference survives reloads (local only).
  useEffect(() => {
    try {
      if (window.localStorage.getItem("itg-sidebar-collapsed") === "1") setCollapsed(true);
    } catch {
      /* storage unavailable — keep the sidebar expanded */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("itg-sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* storage unavailable — preference is not saved */
    }
  }, [collapsed]);

  // Drawer: Escape closes, focus moves to the close button, and
  // the page behind does not scroll while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Ambient depth (Phase 18): one fixed layer of soft orbs
          and a faint grid under every signed-in page. The shell
          root is transparent so the ambient shows through; the
          body carries the layered base gradients. */}
      <AmbientBackground />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Desktop sidebar — collapsible, icons only when collapsed.
          The width animates over 250ms (Phase 16). */}
      <aside
        aria-label="Primary"
        className={cn(
          "glass-surface sticky top-0 hidden h-screen shrink-0 flex-col border-r shadow-elevation-1 transition-[width] duration-base ease-standard lg:flex",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className={cn("flex h-14 items-center gap-2 border-b px-3", collapsed && "justify-center px-0")}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-ai text-base font-bold text-white shadow-elevation-1 ring-1 ring-white/15" aria-hidden="true">
              ITG
            </span>
            {!collapsed && (
              <span className="truncate text-base font-bold leading-tight">
                ITG <span className="text-gradient-blue">TraderOS</span>
              </span>
            )}
          </Link>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Sections">
          {items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              badge={item.href === "/notifications" ? unread : undefined}
            />
          ))}
        </nav>
        <div className="border-t p-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronsLeft className={cn("h-5 w-5 transition-transform", collapsed && "rotate-180")} aria-hidden="true" />
            {!collapsed && <span>Collapse</span>}
          </button>
          {!collapsed && (
            <div className="mt-2 px-1">
              <p className="truncate text-xs text-muted-foreground" title={email ?? ""}>
                {email ?? ""}
              </p>
              <form action={signOutAction} className="mt-2">
                <Button type="submit" variant="outline" size="sm" className="w-full">
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
                </Button>
              </form>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile slide-over drawer — the full navigation. The
          overlay fades and the panel slides (Phase 16); the
          drawer unmounts 250ms after closing so the exit plays. */}
      {drawerMounted && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className={cn(
              "absolute inset-0 bg-black/60 transition-opacity duration-base ease-standard",
              drawerEntered ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            className={cn(
              "glass-surface-elevated absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col shadow-elevation-3 transition-transform duration-base ease-standard",
              drawerEntered ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="text-base font-bold">ITG <span className="text-gradient-blue">TraderOS</span></span>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Sections">
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={() => setDrawerOpen(false)}
                  badge={item.href === "/notifications" ? unread : undefined}
                />
              ))}
            </nav>
            <div className="border-t p-4">
              <p className="truncate text-sm text-muted-foreground" title={email ?? ""}>
                {email ?? ""}
              </p>
              <form action={signOutAction} className="mt-3">
                <Button type="submit" variant="outline" className="w-full">
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Content column: top header + main. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-surface sticky top-0 z-40 border-b">
          <div className="flex h-14 items-center gap-1 px-4 sm:gap-2 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <Link href="/dashboard" className="text-base font-bold lg:hidden">
              ITG <span className="text-gradient-blue">TraderOS</span>
            </Link>
            <div className="min-w-0 flex-1" />
            <Button asChild size="sm" className="shrink-0 shadow-elevation-1">
              <Link href="/trades/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Add trade</span>
                <span className="sm:hidden">Trade</span>
              </Link>
            </Button>
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-muted-foreground shadow-elevation-1 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-white/[0.12] hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread > 0 ? (
                <span className="motion-scale-in absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground xl:inline" title={email ?? ""}>
              {email ?? ""}
            </span>
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            "mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8",
            // Bottom padding clears the fixed mobile tab bar.
            "pb-24 lg:pb-8",
            narrow ? "max-w-3xl" : "max-w-6xl",
          )}
        >
          {/* Subtle page transition (Phase 16): each navigation
              fades the new page up 6px over 250ms. Transform and
              opacity only — no layout shift. */}
          <div key={pathname} className="motion-page">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar — Home, Trades, a raised Add
          Trade action, Analytics, Goals (Phase 17). Phase 18
          Aurora: the bar floats as a glass dock. Phase 19:
          the dock and centre action now use Ezat's supplied
          Aurora Glass values (.itg-bottom-nav /
          .itg-add-trade in globals.css) — 28px radius, 24px
          blur, 0.68 dark glass, deeper shadow + violet glow,
          68px centre action lifted -30px. z-index stays 40
          (not the supplied 50) so the open drawer (z-50)
          always covers the dock. "More" (the full navigation)
          stays one tap away in the top header menu, which
          already opens the drawer. The existing pb-24 content
          clearance still covers the floating bar (76px bar +
          14px offset < 96px). */}
      <nav
        aria-label="Primary"
        className="itg-bottom-nav z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5">
          {BOTTOM_NAV.slice(0, 2).map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-fast ease-standard",
                  active ? "text-violet" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-fast ease-standard",
                    active && "bg-primary/15 shadow-elevation-1 ring-1 ring-primary/25",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {/* Active indicator (Phase 16): a dot that scales
                    in under the icon. Transform only. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 w-1 rounded-full bg-gradient-to-r from-violet to-indigo transition-all duration-base ease-standard",
                    active ? "scale-100 opacity-100" : "scale-0 opacity-0",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
          <div className="flex flex-col items-center">
            <Link
              href="/trades/new"
              aria-label="Add trade"
              className="itg-add-trade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Plus className="h-6 w-6" aria-hidden="true" />
            </Link>
            <span className="-mt-3 pb-1.5 text-[11px] font-medium text-muted-foreground" aria-hidden="true">
              Add
            </span>
          </div>
          {BOTTOM_NAV.slice(2).map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-fast ease-standard",
                  active ? "text-violet" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-fast ease-standard",
                    active && "bg-primary/15 shadow-elevation-1 ring-1 ring-primary/25",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 w-1 rounded-full bg-gradient-to-r from-violet to-indigo transition-all duration-base ease-standard",
                    active ? "scale-100 opacity-100" : "scale-0 opacity-0",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
