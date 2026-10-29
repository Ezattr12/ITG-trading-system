# Stage 2 — Complete production audit, 2026-10-29

Full end-to-end audit of https://itg-traderos.vercel.app with
the verification test account, exercising the real flows
(creating real data through the real UI on that throwaway
account). Cross-checked against the live database wherever a
UI signal was ambiguous. **Zero page errors and zero
"Application error" screens in any flow.**

## Passed (16 of 17 checklist items)

1. Sign in → dashboard.
2. Add Trade quick path — XAUUSD long 4030→4042, TP/SL,
   strategy BOS; redirect to `/trades/<id>?saved=1`, "Trade
   saved" banner; dashboard Recent Trades + P&L **1.20**
   (= (4042−4030) × 0.10 — the centralized calc is right).
3. Invalid trade (illegal pair characters) → graceful inline
   validation, no crash, nothing created.
4. Trade detail + advanced review — strategy/session
   (London)/emotion (Calm)/confidence (4)/discipline/setup/
   lesson/notes all saved and persisted after reload.
5. Trade screenshots — 1.5 MB **and** 3 MB uploads stored,
   linked and rendered via signed URLs (the Stage 1 body-
   limit fix covers this flow too). DB rows verified.
6. Detail-page controls: "Delete screenshot" and "Save
   correction (creates a reversal)" — no delete-trade
   control; corrections use the reversal pattern.
7. Goals — create (journaling), invalid empty title →
   "Give the goal a title.", manual goal + recorded progress
   4/10 shown as 40%.
8. Risk rules (all 5 values persisted) + trading plan
   (persisted).
9. Weekly review → "Weekly review saved. You earned 30 XP."
   — Levels total moved exactly 0 → 30.
10a. Coach refresh — honest deterministic state: "Not enough
    trades yet to analyse this week — the coach needs at
    least 3 closed trades…" (page states plainly that no
    external AI service is connected).
11. Reports daily/weekly/monthly render; daily + monthly
    PDFs return 200 application/pdf with %PDF magic.
12. Certificates — honest per-criterion eligibility; no
    certificate issuable, none issued.
13. Notifications render (1 unread).
14. Route sweep — /calendar /progress /achievements /levels
    /psychology /profile /analytics all 200; /onboarding
    redirects a completed user to /dashboard.
15. Admin gate — trader role sees "You are not authorised to
    view the admin area", no admin data exposed.
16. Profile edit — country change saved and persisted.
17. Sign out → /dashboard redirects to /login?next=…

Also verified working as designed: the auth rate limiter —
after ~15 audit sign-ins, login showed "Too many login
attempts. Try again in 32 seconds." and recovered after the
window.

## The one genuine bug — backtesting XP (FIXED)

**Symptom:** logging backtesting sessions on /coach recorded
`daily_activity` correctly but never awarded the +15 XP per
session (spec §24), and on a first-ever submission the form
falsely replied "N backtesting session(s) already logged for
\<date\> — no new XP."

**Evidence:** fresh date 2026-10-27 (never logged) → submit
1 session → reply "1 backtesting session already logged for
2026-10-27 — no new XP.", while the DB shows that very
submission created the daily_activity row. Live DB after
three dates of logging (1 + 1 + 2 sessions): **zero**
`xp_transactions` rows with reason `backtest_session`, while
weekly_review (+30), trade_journal (+10) and achievement XP
all landed normally.

**Root cause:** `logBacktestingSessionAction` called
`awardXp` with `sourceRefId: "backtest:<date>:<n>"` — a
non-UUID string — but `xp_transactions.source_ref_id` is a
Postgres **uuid** column (migration 0008). The idempotency
select and the insert both failed; `awardXp` swallows the
error and returns false, so the action concluded the
sessions were already awarded. Every other caller passes a
real UUID (trade/review/goal/achievement id) and works.

**Fix:** new pure helper `deterministicUuid(key)` in
`lib/gamification/xp.ts` (MD5 digest shaped into the RFC
4122 layout, version/variant bits set) maps the per-session
key into a stable valid UUID; the coach action now passes
`deterministicUuid(\`backtest:${activityDate}:${i}\`)`.
Idempotency semantics unchanged: same date+index → same
UUID → never double-awards; raising a day's total awards
only the new sessions. Tests: unit tests for validity,
stability and distinctness, plus a source-scan regression
guard that the raw template string never returns.

**Backfill note:** because the idempotency keys are stable,
any previously-logged-but-unawarded sessions award correctly
the next time the trader re-saves that date's total — no
data migration needed and no double-award risk.

## Observation (not a bug — criteria design)

The achievements "100% Weekly Journal" (+30) and "Monthly
Consistency" (+50) unlocked on the test account with a
single fully-journaled trade: both criteria are journal-
*percentage* rules (`weekly_journal_pct`/`monthly_journal_pct`
= 100 with a ≥1 closed-trade guard), and 1/1 journaled is
arithmetically 100%. The engine computes exactly what the
seeded criteria say. If the intent is sustained volume,
the criteria need a minimum trade count — a product-rule
change, recorded here for Ezat rather than silently altered
during a bug-fix stage.
