# Task 17 — Background Intelligence Engine

**One input → many automatic outputs.** A trader's stored trades already
drive the coach insights, the discipline reminders and the notification
feed — but until this task, every one of those outputs was produced only
while the trader was looking at a page. This task builds the scheduled
pass that produces the same outputs with nobody watching, so the
intelligence is fresh before the trader arrives.

Status: **deployed and production-verified 2026-11-02 (§6, results
below the script).** The production runs exposed one counting defect
in the insights section — since fixed (gate + truthful counting,
§2a); the fix is built and gated locally, awaiting parent redeploy.
No new write paths were created — the pass re-uses the existing
writers throughout.

---

## 1. Audit — the trigger surface before this task

Verified in code on 2026-11-02:

| Output | Only writer | Producers / triggers before Task 17 |
| --- | --- | --- |
| `ai_insights` | `refreshCoachInsights` (`lib/coach/service.ts`) | (a) Manual refresh action (`lib/coach/actions.ts`); (b) `refreshCoachInsightsSafely` from `lib/trades/service.ts` after a closed trade is created / corrected / re-reviewed. The MCP `compute_coach_insights` tool is compute-only. Nothing refreshes a week whose evidence changed without a trade write in it, and nothing runs without a user request. |
| `discipline_events` (missed-journal escalation) | `logDisciplineEvent` via `ensureDisciplineReminderLogged` (`lib/discipline/service.ts`) | **Dashboard render only** (`app/dashboard/page.tsx`). A trader who never opens the dashboard never escalates. |
| `notifications` | `createNotification` (`lib/discipline/service.ts`) | Goal cores (goal reached/completed, achievement, level-up), trade save (achievement, level-up), `/levels` and `/achievements` renders (achievement, level-up), certificate issue, weekly-review save (`weekly_report`), discipline escalation (`journal_reminder` / `discipline_warning`). |
| Dead kinds | — | `risk_warning`, `monthly_report` and `system` were enum values with **no producers**. Risk events never notified. No monthly notice existed. |
| Scheduling | — | **None anywhere.** No cron config, no scheduler, no background route. `vercel.json` carried only the region pin. |

The notifications table already stored deep-link fields
(`related_entity_type` / `related_entity_id`) that no producer filled
for risk events and no UI used (see §5).

## 2. Design — the pass

New module: `apps/web/lib/intelligence/background.ts`.

- `runBackgroundPassForUser(client, userId, now)` → 
  `{ insightsRefreshed, riskNotifications, disciplineEvents, monthlyNotices }`
- `runBackgroundPassForAllUsers(client, now)` → aggregates over every
  `profiles` row; a failure for one user is counted (`errors`) and the
  run continues — one bad account never starves the rest.

The client is the service-role client, supplied explicitly (the core
convention: "cores receive their client explicitly"). Cross-user work
happens only here, server-side; every read and write is scoped to the
user being processed. The notification sections run **before** the
insights refresh, so a coach failure for a user cannot starve that
user's notifications — the refresh is retried on the next run.

### 2a. Insights freshness

**Staleness signal (from real columns):** the newest closed trade's
`updated_at` vs the newest stored insight's `created_at`.
`trades.updated_at` is maintained by trigger and is bumped on every
write path that changes coach evidence: trade create, correction
(a new trade + reversal), and in-place review saves. If the newest
evidence is newer than the latest snapshot, the week containing that
trade (`closed_at`, falling back to `opened_at`) is refreshed through
the existing `refreshCoachInsights` — which normalises to the week's
Monday and is itself idempotent (an unchanged snapshot stores nothing).
A user with **zero closed trades is a no-op**, even if stale insights
from since-reversed trades exist.

**Threshold gate (follow-up fix, 2026-11-02).** The refresh is not
attempted at all when the target week holds fewer than
`COACH_MIN_TRADES` closed trades. That constant (3, `lib/coach/
types.ts`) is the coach engine's own evidence minimum:
`generateCoachInsights` returns `insufficientData` with zero insights
below it, so `refreshCoachInsights` provably writes nothing for such
a week. The gate counts the same set the engine would see — closed
trades with `closed_at` inside the week's Monday–Sunday bounds (the
`getReportSummary` window used by `getCoachWeekData`). Without the
gate, a sub-threshold user with no stored insights (the staleness
comparison against a null `created_at` can never turn fresh) fired a
guaranteed-no-op refresh on every run, forever.

**Truthful counting (follow-up fix, 2026-11-02).** `insightsRefreshed`
no longer counts invocations. It is true only when the user's newest
stored insight `created_at` **after** the call is newer than it was
**before** it — i.e. a new snapshot actually exists. A refresh that
stored nothing (the week's snapshot was already stored, so every
insight was a duplicate) reports false, so the run summary and the
`intelligence.background_run` audit row never overstate the pass's
output.

### 2b. Risk notifications (wires the dead `risk_warning` kind)

For each of the user's `risk_events` (oldest first, cap 500 per pass),
create one `risk_warning` notification via `createNotification` **iff**
no notification already exists for `(user, type = risk_warning,
related_entity_type = 'risk_event', related_entity_id = <event id>)`.
The dedupe is structural — it reads the same fields it writes.

- `related_entity_type = 'risk_event'`, `related_entity_id = <event uuid>`
- Title from the event's stored severity: `critical` → "Critical risk
  event", `warning` → "Risk warning", `positive` → "Positive risk streak"
- Body is the event's **own stored message** — the risk engine's words
  with its real figures, never re-worded or re-computed here.

### 2c. Discipline escalation (off-render)

The escalation logic was trapped inside `ensureDisciplineReminderLogged`,
which built its own cookie-session read client — correct on the
dashboard, unusable with no session. It is extracted, not forked:

- `ensureDisciplineReminderLoggedCore(supabase, userId, lastJournalDate, today)`
  in `lib/discipline/service.ts` holds the one implementation and takes
  the read client explicitly. The writes are unchanged
  (`logDisciplineEvent` / `createNotification` use their own service-role
  client, as always). The return gains a `logged: boolean` flag.
- `ensureDisciplineReminderLogged` is now a thin wrapper that keeps the
  render behaviour identical (level-0 short-circuit, configured check,
  session client) and delegates. The dashboard is untouched.

The pass feeds the core the same inputs the render computes
(`getLastJournalDate(client, userId)`, today in UTC). At most one
escalation step is logged per pass; the escalation check never logs the
same level twice for one missed run (backed by the table's unique key
on `(user_id, event_date, kind, level)`).

### 2d. Monthly report notice (wires the dead `monthly_report` kind)

On the first pass in a new calendar month (UTC), a user with ≥ 1 closed
trade in the completed previous month gets one `monthly_report`
notification:

- Title: `Your October report is ready` (previous month's name)
- Body: `Your trading report for October 2026 is ready — open Reports to
  review the month.` — a period name and a direction, **no figures**.
- `related_entity_type = 'report'`, `related_entity_id = null` — monthly
  reports are computed views, not stored rows, so there is no row id to
  reference (the column is `uuid`; a period string cannot be stored in
  it, and inventing an id would be worse than null).

Dedupe is an existence check: any `monthly_report` notification for the
user with `created_at` in the current month means this month's notice
(which is always about the previous month) already went out.

### Idempotency — the core contract

A second run immediately after the first creates **zero new rows of any
kind**. Each section dedupes structurally (§2a–2d), never by timing or
by "recently ran" flags. This is unit-tested per section and for the
whole runner (§7), and is the centre of the production script (§6).

## 3. Endpoint contract — `/api/intelligence/run`

`apps/web/app/api/intelligence/run/route.ts` (thin adapter) →
`handleIntelligenceRun` in `lib/intelligence/background.ts`.
`runtime = "nodejs"`. Both `GET` (scheduler compatibility — Vercel Cron
issues GET) and `POST` (manual/ops invocation) are served.

- **Auth: shared secret only.** Header `Authorization: Bearer
  <INTELLIGENCE_CRON_SECRET>`, compared in constant time (both sides
  SHA-256 hashed first, then `timingSafeEqual`, so the comparison leaks
  neither content nor length). **No user session is consulted at all** —
  a normal trader session (cookie or token) can never trigger a
  cross-user run.
- Missing env var, missing header and wrong secret all return the same
  detail-free **401** `{ "error": "unauthorised" }`. No service-role
  client available → **503** `{ "error": "unavailable" }`.
- Success → **200** with aggregate counts only:
  `{ ok, usersProcessed, insightsRefreshed, riskNotifications,
     disciplineEvents, monthlyNotices, errors }`.
  No user ids, no figures, nothing about any individual trader.
- Exactly **one audit row** per authorised run:
  `action = 'intelligence.background_run'`, `entity_type =
  'intelligence'`, `details` = the same six counts. Unauthorised
  attempts write no audit row.

## 4. Schedule — declared, registration UNVERIFIED

`apps/web/vercel.json` now declares:

```json
{ "regions": ["hnd1"],
  "crons": [{ "path": "/api/intelligence/run", "schedule": "30 6 * * *" }] }
```

(daily 06:30 UTC). **Honest status: the schedule is declared, not
verified.** File-API deployments have ignored `vercel.json` before (the
`regions` key was ignored until the project-level setting was changed),
so cron registration cannot be claimed until a scheduled firing is
observed (an `intelligence.background_run` audit row that no manual
invocation explains). The verified deliverables of this task are the
endpoint, the secret auth, and the parent's production invocation (§6).

Alternatives, documented and **not** faked:

- **GitHub Actions `schedule:` workflow** calling the endpoint with the
  secret stored as a repo secret — the current GitHub PAT scope cannot
  set repo secrets, so this needs Ezat (or a broader token) and is not
  built.
- **Opportunistic triggers (unchanged):** page-visit refreshes remain
  exactly as they were — dashboard-render discipline escalation, the
  trade-close insight refresh, the manual coach refresh. The pass is
  additive; if the schedule never registers, the product behaves
  exactly as it did before Task 17, plus whatever manual/ops
  invocations of the endpoint occur.

## 5. Notifications page — risk deep link

The notifications page rendered every row generically. With real
`risk_warning` rows now produced and their related fields populated,
the row title for `type = risk_warning` now links to `/risk`
(`app/notifications/page.tsx`). This needed no new plumbing — the page
already receives the full notification row — and no other type's
rendering changed. (Per-event anchors on `/risk` remain future work
for Tasks 19/21; the link target is the risk surface itself.)

## 6. Production verification script (for the parent)

Prerequisites: deploy as usual; set `INTELLIGENCE_CRON_SECRET` in the
Vercel **production** environment (a fresh random value; keep it in
`~/workspace/.itg-helpers/` mode 0600, never printed, never in the
repo) and redeploy so the function picks it up.

```bash
# 1. Unauthorised: no header → 401; wrong secret → 401 (same body).
curl -s -o /dev/null -w "%{http_code}\n" \
  https://itg-traderos.vercel.app/api/intelligence/run
curl -s -X POST -H "Authorization: Bearer wrong" \
  https://itg-traderos.vercel.app/api/intelligence/run

# 2. Snapshot counts (before).
python3 ~/workspace/.itg-helpers/sbmgmt.py "select
  (select count(*) from notifications where type='risk_warning') as rw,
  (select count(*) from notifications where type='monthly_report') as mr,
  (select count(*) from discipline_events) as de,
  (select count(*) from ai_insights) as ai,
  (select count(*) from audit_logs where action='intelligence.background_run') as runs"

# 3. Authorised run → 200 with counts.
curl -s -X POST -H "Authorization: Bearer $INTELLIGENCE_CRON_SECRET" \
  https://itg-traderos.vercel.app/api/intelligence/run

# 4. Snapshot again. Expected on the FIRST run (2026-11, from live state
#    read 2026-11-02): risk_warning +3 for test account A (its 3 stored
#    risk events were never notified — this is the feature working, not
#    test pollution); +1 monthly_report for A (8 closed trades in
#    October 2026); A's ai_insights unchanged (latest insight
#    2026-10-31 18:56 UTC is newer than its newest closed trade
#    updated_at 2026-10-30 15:33 UTC → fresh, no refresh);
#    discipline_events +0..1 for A depending on its current escalation
#    level; runs = 1.
#    Every account is processed by the same rules; per-account effects
#    depend on each account's stored evidence. Trades and XP for every
#    account MUST be unchanged (A: 10 trades / 390 XP).

# 5. Idempotency: run again → 200 with riskNotifications 0,
#    monthlyNotices 0, disciplineEvents 0; the step-2 snapshot after
#    this run is IDENTICAL to the step-4 snapshot except runs = 2.
curl -s -X POST -H "Authorization: Bearer $INTELLIGENCE_CRON_SECRET" \
  https://itg-traderos.vercel.app/api/intelligence/run
```

### Production results (2026-11-02, parent-executed)

Two authorised runs were executed against production, exactly as
scripted above:

- **Run 1** created precisely the predicted outputs for test account
  A: **3 `risk_warning` notifications** (its 3 stored, never-notified
  risk events) and **1 `monthly_report`** (October). Trades and XP
  unchanged for every account.
- **Run 2** created **zero new notifications** — the idempotency
  contract held in production.
- **One defect found:** both runs reported `insightsRefreshed: 1`
  while writing **zero** `ai_insights` rows. The count was of a
  sub-threshold user (1 closed trade, 0 stored insights): the
  staleness signal fired, `refreshCoachInsights` was invoked, and it
  correctly no-oped below the coach evidence minimum — but the pass
  counted the invocation as a refresh, and would have gone on doing
  so on every run forever. **Fixed the same day** (§2a): the
  `COACH_MIN_TRADES` threshold gate means that user no longer
  triggers an invocation at all, and a refresh is only counted when
  a newer snapshot exists after the call. The fix is gated locally
  (§7) and awaits the parent's redeploy; after redeploy, both runs
  above would report `insightsRefreshed: 0`.

## 7. Tests and gate

- **Vitest 859/859** (845 baseline + 14 in
  `apps/web/lib/intelligence/background.test.ts`): zero-data no-op
  (twice), stale-insight refresh then fresh, fresh-insight skip,
  risk dedupe incl. another trader's event never notified, discipline
  escalation logged once and never repeated, monthly notice once +
  none without previous-month trades, whole-runner aggregation +
  idempotency, the constant-time auth helper, and the handler
  (401 equivalence; 200 + exactly one audit row; end-to-end through
  the default deps). The follow-up fix added 2 tests — a
  sub-threshold user never invokes the refresh (proven with an
  invocation-counting wrapper around the real
  `refreshCoachInsights`), and an invoked-but-storing-nothing
  refresh counts 0 on consecutive runs. No existing assertion was
  modified (the fix changed the code's counting semantics, not any
  previously asserted expectation); the discipline suite passes
  unchanged against the extracted core.
  (The fake Supabase has no DB defaults, so tests stamp `created_at`
  between runs to simulate `now()` where a dedupe reads it — noted in
  the test file.)
- Typecheck clean · Lint 0 errors (1 pre-existing `<img>` warning on
  the dashboard) · Production build clean (route present in build
  output) · `security:check` passed (408 files) · Playwright e2e
  **36/36** (`CI=true`, repo root) · test-results cleaned.
- Read-only SQL spot-check of A after all runs: **10 trades / 390 XP —
  unchanged.** (A: 3 risk events, 0 risk_warning notifications, 51
  ai_insights — the inputs behind the §6 expectations.)

## 8. Known limitations

- **Schedule registration unverified** (§4) — the headline caveat.
  Until a firing is observed, the engine runs when invoked, not on a
  proven clock.
- **Per-user failure granularity:** if one section of a user's pass
  throws, the runner counts one error for that user and moves on; the
  sections that already completed keep their effects, and the next run
  retries the rest (all sections are idempotent, so partial completion
  is safe). The notification sections run first precisely so a coach
  failure cannot starve them.
- **Staleness signal scope:** `trades.updated_at` covers every coach
  evidence change that flows through a trade write (the only such
  paths in the product). Risk
...[truncated 853 chars]
- **Duplicate-snapshot refreshes still invoke (counted 0):** for a
  week at/above `COACH_MIN_TRADES` whose snapshot is already stored
  but older than the newest trade evidence, the staleness signal
  fires and the refresh runs — storing nothing, because every
  insight is a duplicate. Post-fix this is reported truthfully
  (`insightsRefreshed` stays 0); the wasted invocation is one
  idempotent compute per such user per run, accepted rather than
  adding a second dedupe layer in the pass.
