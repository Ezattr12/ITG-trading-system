# Phase 6 — Goals & Discipline

Status: implemented locally, tested. **Supabase project
ITG-trading-system now exists** (per the parent agent's brief)
but migrations have NOT been applied to it and its keys are NOT
in the app env yet — the pages are real and complete, but they
show honest empty states until migrations are applied and env
vars are set. No demo goals, no fake progress, no mock
notifications. Not deployed, not committed to GitHub (GitHub App
push still fails 403 — parent agent's blocker, unchanged).

## Correction to the brief
The Phase 6 brief listed `discipline_events` among the Phase 1
tables. It did not exist (migration 0006 created only `goals`,
`goal_progress` and `daily_activity`). Phase 6 therefore adds
migration `0012_discipline_events.sql` (new table,
`discipline_event_kind` enum, RLS owner-only select, no client
insert/update/delete — server-written, append-only like
`risk_events`). Total tables: 31.

## Spec covered
- §21 Goals: daily/weekly/monthly/yearly goals — create, pause,
  resume, complete, fail — with visual progress (e.g. 12/15 =
  80%). Progress is measured from real trades and activity where
  the goal type allows it (trades opened, trades journaled,
  study hours, backtesting sessions, trading sessions,
  disciplined trades, profit target). A goal that cannot be
  measured from stored data says so honestly ("No closed trades
  in this period yet.", "Set your risk rules first…",
  "This goal is tracked manually…") instead of inventing a
  number. Manual ("other") goals — and unmeasurable goals — use
  the progress the trader records, one row per goal per day.
- §22 Discipline: Day 1 reminder / Day 2 warning / Day 3+
  stronger reminder when a trader misses journaling, computed
  from the last journaled day (journaled today = 0 missed days).
  Copy is supportive and professional, never shaming or
  insulting. Reminders are logged to `discipline_events` only
  when the level escalates past the highest level already logged
  for the current missed run, so a repeated page visit cannot
  spam the log (unique key enforces this too); a fresh run after
  journaling again starts again at Day 1. The current reminder
  is shown on the dashboard.
- §23 Motivation: configurable, context-aware messages from the
  `motivation_messages` table (seed extended with `missed_day`,
  `goal_near`, `streak`, `discipline` contexts). Selection
  prefers the situation's context, falls back to "general",
  never repeats the last message when another is available, and
  rotates by day. The library never invents copy — it only
  selects from stored rows.
- §30 Notifications: in-app only, no email/SMS yet.
  Notification rows are created server-side when a discipline
  reminder escalates, a goal is reached, or a goal is completed.
  `/notifications` lists them newest first with an unread count
  and mark-read / mark-all-read actions; the header shows an
  unread badge (real count, never a fake one).

## Routes
| Route | Purpose |
|---|---|
| `/goals` | Goal creation, progress per goal, manual progress + status forms, recent discipline reminders, context motivation message |
| `/notifications` | In-app notification list, unread count, mark read |
| `/dashboard` (section added) | Current discipline reminder + motivation message, links to Goals / Notifications |

## Implementation
- `supabase/migrations/0012_discipline_events.sql`: new table + enum + RLS.
- `supabase/seed.sql`: 5 more motivation messages (new contexts).
- `apps/web/lib/discipline/`: `engine.ts` (pure: period windows,
  missed-day count, escalation, goal measurement, progress
  resolution), `motivation.ts` (pure selection + context),
  `validation.ts` (Zod schemas), `queries.ts` (RLS-enforced
  reads), `actions.ts` (create goal / record progress / status,
  mark notifications read, service-role `logDisciplineEvent` /
  `createNotification`, idempotent `ensureDisciplineReminderLogged`),
  `notifications.ts` (pure sort/count), `types.ts`.
- `apps/web/components/discipline/`: `goal-form.tsx`,
  `goal-progress-form.tsx`, `goal-status-form.tsx`,
  `mark-read-form.tsx`.
- `apps/web/components/app-header.tsx`: now async; adds Goals
  and Notifications links plus a real unread-count badge.
- `apps/web/app/dashboard/page.tsx`: discipline section; the
  "No goals yet" copy now links to `/goals` instead of saying
  goals arrive in a later phase.

## Known limits (to fix in later phases)
- Reminder logging happens on dashboard render (idempotent),
  because there is no daily cron yet — Phase 13 adds scheduled
  reminders. A trader who never visits the dashboard gets no
  logged reminder (the reminder itself is computed on render,
  so it is always shown when they do visit).
- The motivation selector is not told which message the trader
  saw last (no per-user "last shown" store yet), so the
  no-immediate-repeat rule only applies when a last id is
  supplied; day-based rotation still varies the message.
- No live Supabase project wired into the app yet (keys not in
  env, migrations not applied to the live project) — Phase 13
  applies migration 0012 with the rest.
- No XP/level scoring yet (Phase 7) — goal completion only logs
  a notification for now.

## Tests
Vitest, 47 new tests (179 total, was 132):
`apps/web/lib/discipline/engine.test.ts` (24: period windows,
Day 1/2/3 escalation, supportive copy, goal measurement per
type, progress resolution incl. 12/15 = 80%),
`motivation.test.ts` (12: context preference, fallback,
no-repeat, rotation), `validation.test.ts` (8),
`notifications.test.ts` (3: sort, unread count).

## Verification
- `npm test` — 179/179 pass
- `npm run typecheck` — pass (web + calc)
- `npm run lint` — pass
- `npm run build` (apps/web) — pass, 22 routes (was 20);
  `/goals` 118 kB, `/notifications` 116 kB first load

## Phase 7 needs next
- Gamification (spec §24–26): XP transactions and level scoring
  (Bronze/Silver/Gold/Platinum, multi-dimensional, configurable),
  achievements, streaks. Goal completion and discipline streaks
  from Phase 6 are the natural XP sources — wire them into
  `xp_transactions` instead of only logging a notification.
- The dashboard's level/XP section can then use real scoring
  instead of the Phase 4 placeholder text.
