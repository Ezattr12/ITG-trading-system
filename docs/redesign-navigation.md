# Global Navigation — v2 finalization (Master TASK 3, 2026-11-01)

Visual-only transformation of the app shell chrome
(components/app-shell-client.tsx) to the v2 system. Zero
behavior changes: NAV/BOTTOM_NAV arrays, order, isActive,
drawer mount/enter animation, collapse persistence, unread
badges, header actions and z-indexes are untouched.

## What changed

- Brand tile: violet `--gradient-ai` → `.itg2-brand-tile`
  (linear-gradient 135deg #1268D8 → #00CFFF, blue glow).
- Sidebar/drawer/header surfaces: v1 `.glass-surface*` →
  `.itg2-shell` / `.itg2-shell-elevated` (deep-blue tinted
  glass, same blur/radius/shadow structure).
- Nav active state: `.itg2-nav-active` — deep-blue glass,
  inset ring, #DCEBFF text, cyan icon, blue→cyan indicator
  bar. The AI Coach item alone uses `.itg2-nav-ai-active`
  (violet glass, #C4B5FD) — violet survives exactly where it
  means AI, per the v2 rule.
- Mobile dock: `.itg2-dock` (deep-blue elevated glass, blue
  glow) + `.itg2-dock-add` — 60px blue→cyan circle socketed
  into the dock edge with a 6px page-bg ring; its centre
  sits exactly 10px above the dock's top edge (integrated,
  matching the mobile app dock), "Add" label clears the
  circle at 320–430px. Dock active item: cyan text, blue
  glass pill, blue→cyan dot.
- Cascade fix found in parent QA: Tailwind preflight's
  unlayered `a { color: inherit }` defeated the layered
  active-state colours; the colour declarations are repeated
  in an unlayered block at the end of itg2.css (backgrounds,
  rings and shadows stay layered). Verified by computed-style
  probes: sidebar active rgb(220,235,255) + cyan icon,
  coach rgb(196,181,253), dock active rgb(0,207,255).

## Gate

Vitest 803/803, Playwright 36/36, typecheck/lint/build
clean, security 391 files. Local visual QA as account A:
tile gradient, active Dashboard, collapse to the 80px rail
and back, drawer with the full nav, dock geometry (centre
10px above the dock edge), zero overflow at 320/390/768/
1280. Deployed dpl_udobRAx6btefEpKFKKGV8Jtm1RoX
(alias-verified); production SSR smoke: all v2 nav classes
present, legacy dock classes gone, coach page carries the
AI variant, dashboard data intact.
