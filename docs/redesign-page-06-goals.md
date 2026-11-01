# Master Web UI Redesign — Page 6: Goals

Mandate order: … → Analytics → **Goals** → Profile → … Visual redesign only.

## What changed

- **Header band** (`.itg2-card-flat`): eyebrow "Goals", page title, lede verbatim, plus Active goals / Completed figures counted from the same resolved array the page already builds (rendered only when ≥1 goal exists).
- **Motivation quote** → `.itg2-notice` bar, text verbatim.
- **Closest-to-completion hero** → L3 `.itg2-hero` with rings: eyebrow verbatim, percent as `.itg2-hero-value`, meta/caption verbatim.
- **Progress bars:** the shared `ProgressBar` component is untouched (it also serves Progress/Levels); the goals page wraps it in a new scoped override (`.itg2-goalbar-scope` / `.itg2-goalbar-done` in the unlayered tail, the Page-1 level-scope doctrine) — fill becomes blue→cyan with the cyan glow; a completed goal's bar goes profit→cyan, consistent with its profit chip. The component's animation, aria contract and caption are unchanged.
- **Create panel** → flat glass panel, eyebrow "Create"; `GoalForm` onto the Page-2 form system (`.itg2-field/.itg2-label/.itg2-input/.itg2-select`), submit `.itg2-btn-primary .itg2-btn-save`. All names, ids, defaults (`weekly`/`max_trades` lineage preserved: period `monthly` default per component, goal-type default as before), option values/labels, placeholders and explainer copy verified unchanged.
- **Goal cards** → `.itg2-card .itg2-card-flat` (flat because they contain forms): per-type icon tile (lucide), title, period line — now including `· ends {end_date}` when the goal's own stored end date is set (on-record data surfacing, matching the reminders list's date convention); status chips with the legacy semantics mapped 1:1 (active blue / completed profit / failed loss / paused muted), labels verbatim.
- **Record progress / Update status** blocks: headings verbatim; both forms on the v2 system with full-width primary submits (their existing emphasis); hidden goalId inputs, field names, defaults and actions untouched; the measured-goal rule (no progress form for `source === "measured"`) unchanged.
- **Empty state** → glass panel with a Target icon tile, copy verbatim, no CTA invented.
- **Reminders panel** → glass with eyebrow "Discipline"; rows as `.itg2-row`; "View all notifications" as `.itg2-link` (same href).
- Audit-driven honesty notes: this page renders NO XP (the data model carries none — nothing invented); no progress-history list exists (only the latest manual progress is fetched — none invented); status changes are a select + one submit (no discrete buttons exist — none invented).

## Gate evidence

- Vitest 752/752 · Playwright e2e 36/36 · typecheck clean · lint 0 errors · production build OK (First Load JS unchanged at 103 kB; `.itg2-goalbar-*` present in the built CSS) · security check passed.
- Visual verification (local production build, test account A — 5 real goals: 4 active, 1 paused): header counts 4/0, hero "Audit manual progress goal R2 — 40%", blue→cyan bar fill confirmed by computed style, create form, all cards with chips and end dates, measured goals correctly showing no progress form, reminders. Zero page overflow at 320 / 390 / 768 / 1280.
- Production: deployment `dpl_qXBk4z8gYxa8HydN6Nf3H6Kf8KrC` READY, alias-verified. Production smoke (test account session, SSR HTML): HTTP 200 with the real goals rendered ("Audit manual progress goal", hero 40%, Active goals band, goal-bar scope markup); the served CSS chunk hash equals the locally verified build's chunk (`4eac78f8d47fa4d8.css`).
- Environment note: the gate was interrupted by a sandbox storage fault (2026-10-31 ~16:31–late evening) that truncated three config files; all three were restored byte-perfect and SHA-256-verified against this repository before the gate resumed (tsconfig.json 0036e021…, tailwind.config.ts bd19b36a…, next-env.d.ts 85ae5aee…). A stray duplicate deployment of the Page-5 file set (dpl_BwPead7GMWbE7wwJSyYS4R64xRYM) was created from stale args during the fault; it carried identical Page-5 content and is superseded by this deployment.

**Page 6 gate: PASSED. Next per Ezat's correction mandate: Profile Correction Pass (completion audit/fix → mobile Profile redesign → bottom-nav Add button fix) before Page 7 resumes.**
