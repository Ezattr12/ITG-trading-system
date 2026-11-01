# Redesign Page 7 — Profile (Master Remaining Work TASK 2, 2026-11-01)

Visual-only transformation of the web Profile page to the v2
system. No data, action, or calculation changes: the page reads
the same gamification bundle, the editor posts to the same
updateProfileAction with byte-identical field names/defaults,
and completion still comes solely from calcProfileCompletion
(@itg/calc via the web shim).

## What changed

- Hero → .itg2-hero (L3): avatar in a blue→cyan gradient ring
  with a blue→cyan camera badge (the violet badge is gone),
  verified state as a blue glass pill, otherwise the completion
  chip (percent + next step). Level ring rebuilt as .itg2-ring
  (conic blue→cyan) — LevelRing is shared, so the Dashboard
  hero ring upgraded identically. XP band: hero value +
  .itg2-progress + points-to-next.
- Key stats → six .itg2-kpi cards (total trades, win rate,
  profit factor, average R, best strategy, current streak) —
  same summarizeTrades values.
- Trading Identity → .itg2-card rows: Experience, Markets,
  Primary strategy, Preferred sessions, Backtested trades,
  Real trades (approx.), "Risk profile" (label only; value is
  the existing risk-plan content), Identity verification
  (admin-reviewed, kept distinct from the completeness badge).
  No "Trading Style" row — no such stored field exists
  (documented decision, same as the mobile Profile).
- Achievements → EARNED ONLY on this page (Task 2 spec);
  locked achievements live on /achievements and Levels. Count
  line + View all link kept.
- Edit profile → v2 form system: four groups as glass
  <details> cards with the same open defaults, .itg2-field /
  .itg2-input / .itg2-select throughout; all 8 completion
  fields plus the private financial fields and hidden
  experience inputs unchanged.
- Aside: Profile completion with a server-rendered SVG ring
  (blue→cyan gradient stroke, percent centered, same
  progressbar aria contract), the 8-item checklist and
  missing-field hints; Certificates card; "How your level
  works" card (violet glow removed).
- Parent QA fixes: the XP label no longer squeezes against the
  hero value (stacked beneath it); the streak KPI no longer
  truncates ("6 wins in a row" wraps fully).

## Gate

Vitest 803/803, Playwright 36/36, typecheck/lint/build clean,
security 391 files. Local visual QA as verification account A
(50% completion): chip shown, badge correctly absent, ring
aria 50, stats 8 / 88% / PF / 1.12 R, XP 390, zero overflow at
320/390/1280; dashboard regression-checked after the shared
ring change. Production smoke on deployment
dpl_D6Q3nSj4sE567dhn7fi1xHZ5jE6T (alias-verified): name, 50%
chip (React comment-node splitting in SSR HTML accounted
for), badge inactive, XP 390, win rate 88%, Risk profile row,
next-step hint all present; dashboard renders.
