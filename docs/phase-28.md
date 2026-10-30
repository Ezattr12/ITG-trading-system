# Phase 28 — Backup & Disaster Recovery

**Date:** 2026-10-30. **Scope:** backup posture verification,
recovery architecture, a working logical-snapshot safety net, and
the restore runbook. No code changes; nothing about the running
system was modified. One enablement decision (PITR) belongs to
Ezat and is set out in §3.

## 1. Current backup posture — verified live, 2026-10-30

Read directly from the Supabase Management API
(`GET /v1/projects/pwzvthvvxyfppenmessf/database/backups`):

- Project `ITG-trading-system`: `ACTIVE_HEALTHY`, region
  ap-northeast-1, Postgres 17.
- `walg_enabled: true` — WAL archiving infrastructure is on.
- **`pitr_enabled: false`** — point-in-time recovery is NOT
  enabled.
- The physical-backup view lists no restorable backups from this
  endpoint. Scheduled daily backups depend on the project's plan
  tier and are managed entirely in the Supabase dashboard.

**Translation:** today, if the database were corrupted or the
project lost, recovery would rely on (a) whatever scheduled
backups the current plan retains (dashboard-visible only), and
(b) the logical snapshot built in this phase. There is no
minute-level restore point. For a journal whose entire value is
the trader's history, that gap is the phase's one real finding.

## 2. Recovery objectives (proposed, for Ezat to ratify)

- **Without PITR:** RPO ≈ up to 24 h (daily backup cadence) plus
  snapshot age; RTO ≈ 1–3 h (new project + migrations + data
  load + redeploy, per the runbook).
- **With PITR enabled:** RPO ≈ minutes (continuous WAL); RTO
  ≈ 30–60 min (managed restore + repoint + redeploy).
- The logical snapshot narrows the no-PITR case only if it is
  fresh — hence the cadence rule in the runbook (monthly, and
  before every production migration).

## 3. THE DECISION — enable PITR (Ezat, dashboard + billing)

PITR on Supabase is a paid add-on enabled per project; it cannot
be enabled via the Management API by this agent, and it may
change billing. Steps for Ezat, ~2 minutes:

1. Supabase dashboard → **ITG-trading-system** → Database →
   Backups → **Point in Time Recovery**.
2. Enable PITR (choose the retention window offered; 7 days is
   the sensible default for this app).
3. Confirm the add-on charge.

Until then, the honest status is: **backups exist only at plan
cadence + the local logical snapshot; PITR is off** — the same
flag raised at Phase 14 and carried in every phase report since.
Alternatives if the add-on is declined: raise snapshot frequency
(the script is one command) and accept the 24 h RPO knowingly.

## 4. What was built — logical snapshot safety net

- Script: `~/workspace/itg-backups/snapshot.py` (deliberately
  OUTSIDE the repo — snapshots contain user data and are never
  committed). It exports all 32 public tables to JSON, downloads
  every Storage object (avatars + trade-screenshots), inventories
  auth users (id/email only — never hashes), and writes a
  manifest with per-table row counts.
- First snapshot executed 2026-10-30:
  `~/workspace/itg-backups/2026-10-30-1801/` (8.9 MB) — **counts
  verified against live SQL**: trades 10 = 10, xp_transactions
  23 = 23, audit_logs 374 = 374; storage 6 avatars + 2
  screenshots.
- Two engineering notes from building it: the sandbox proxy
  truncates large urllib reads, so object downloads and list
  calls run through curl with retries; and the data leg takes
  ~60 s end-to-end at current scale.

## 5. Configuration & secrets inventory (names only)

A rebuild needs these re-entered (values live in the providers'
own vaults, never in this repo):

- Vercel env: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
  optional `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` +
  `COACH_LLM_MODEL` (coach narration; absent = deterministic
  mode by design); `ITG_API_BASE_URL` (MCP server only).
- Supabase: project ref `pwzvthvvxyfppenmessf`; Auth redirect
  allowlist must include the production domain + `/auth/callback`.
- GitHub: repo `Ezattr12/ITG-trading-system` is the code source
  of truth; the deploy pipeline is file-upload based (see
  `~/workspace/.itg-deploy-staging/`).
- Credentials for all of the above are held by Ezat / the Muse
  Secure Vault connections — none are stored in the codebase
  (security:check enforces this in CI).

## 6. Disaster scenarios — coverage map

| Scenario | Covered by | Residual risk |
| --- | --- | --- |
| Bad migration / data corruption | PITR (if enabled) or snapshot + migrations | Without PITR: up to snapshot age of data |
| Accidental row deletion | Snapshot (row-level JSON) + audit_logs trail | Manual re-insert; acceptable at current scale |
| Project loss (provider) | Snapshot + migrations + storage files + runbook Path B | Auth passwords not portable (users reset) |
| Vercel loss / bad deploy | Git HEAD + redeploy (previous deployments remain listed) | Minutes |
| Secret compromise | Rotation in provider dashboards; no secrets in git (CI gitleaks) | Sessions: Supabase Auth token revocation is dashboard-side |
| Ezat's old paused project (`hxvmubazimnbtzpmntqj`) auto-freeze ~2026-11-03 | Unrelated to this system (flagged 2026-10-29) | None for ITG TraderOS |

## 7. Outstanding (all Ezat-side, none blocking Phase 29)

1. **PITR enablement** (§3) — the phase's decision.
2. Supabase dashboard Auth settings checklist from Phase 27
   (token expiry, refresh rotation, redirect allowlist review).
3. Quarterly Path-B restore drill needs a spare project
   (paid-tier decision).
4. Off-machine copy of the logical snapshots: they currently
   live on this VM's workspace only. Copying
   `~/workspace/itg-backups/` to Ezat-controlled storage (Drive,
   etc.) is recommended — uploading user data to a third party
   needs Ezat's explicit choice of destination.
