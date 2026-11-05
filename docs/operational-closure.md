# Post-Roadmap Operational Closure

**Date:** 2026-11-05. **Scope:** the six operational closure
priorities set by Ezat after Master Remaining Work v2
completed 28/28. No new features were built. Production
application code is unchanged by this closure pass; the one
production change made is an Auth configuration correction
(§5). Evidence is live: Management-API reads, deployment
file inspection, audit-log queries, GitHub Actions records,
and snapshot verification performed on the dates stated.

Production stands at deployment
`dpl_4qC55xqhULALDi79Ci1CyAes6Jtf` (Task 27), repository
HEAD `c4df024d` at the start of this pass.

---

## 1. Vercel Cron — registration & execution investigation

**Question:** is the declared daily 06:30 UTC cron for
`POST /api/intelligence/run` (Task 17) actually registered
with Vercel, and has any scheduled invocation ever run?

**Evidence gathered 2026-11-05:**

1. **The declaration ships in the production artifact.**
   `list_deployment_files` on `dpl_4qC55xqhULALDi79Ci1CyAes6Jtf`
   lists `vercel.json`; its fetched contents decode to
   `{"crons":[{"path":"/api/intelligence/run","schedule":"30 6 * * *"}],"regions":["hnd1"]}`.
   The schedule is declared exactly as designed.
2. **No scheduled execution has ever been recorded.** All
   10 `intelligence.background_run` audit rows in the
   database are paired manual-verification runs:
   2026-11-03 03:05 ×2, 03:16 ×2, 07:14 ×2;
   2026-11-04 07:22 ×2, 19:18 ×2 (UTC). None is at 06:30 UTC;
   none exists for 2026-11-05. The declared schedule would
   have fired at 06:30 UTC on Nov 3, Nov 4 (and Nov 5,
   pending at investigation time). If the cron were
   registered *and* authenticating, audit rows would exist
   for those firings. **They do not.**
3. **This deployment path provably ignores `vercel.json`.**
   The same file's `regions: ["hnd1"]` entry was ignored by
   the file-API deployment path during the PERF task —
   the function region only took effect when set at
   project level. A file whose `regions` key is not
   processed by this pipeline cannot be assumed to have
   its `crons` key processed either.
4. **The residual ambiguity, stated precisely.** The
   endpoint writes its audit row only on the authorised
   path; an unauthorised call returns a detail-free 401
   and leaves no row. Vercel's native cron authentication
   sends `Authorization: Bearer $CRON_SECRET` using the
   project's `CRON_SECRET` env var — a different name from
   the app's `INTELLIGENCE_CRON_SECRET`. So a registered
   cron calling without the app's secret would be
   invisible in the audit log. Runtime logs would settle
   it, but the Vercel connector's log tools require a team
   context this personal account does not have
   (`list_teams` returns zero teams; `get_runtime_logs`
   and `get_runtime_errors` both return "Team ID is
   required"), and no cron-listing operation exists in the
   connector's tool catalog.

**Classification:** *Not registered (presumptive, on the
deploy-path precedent in point 3), with a documented
residual possibility of registered-but-unauthenticated.
No scheduled execution has occurred under either
hypothesis.* Severity: **Low** — the pass is idempotent,
all of its effects also occur on ordinary page renders and
manual runs; nothing is lost, only automation is unproven.

**Exact user action that resolves it (≈2 minutes):**
Vercel dashboard → project **itg-traderos** → Settings →
**Cron Jobs**. Then, by what it shows:

- **No cron listed (expected):** registration never
  happened. The durable fix is git-connected deployment:
  Vercel → itg-traderos → Settings → Git → connect
  `Ezattr12/ITG-trading-system`. From then on, pushes to
  `main` deploy through Vercel's pipeline, which processes
  `vercel.json` crons. Until then, an agent-side scheduled
  trigger (Muse's own scheduler calling the endpoint
  daily at 06:30 UTC with the existing secret) is ready to
  enable on Ezat's word — it is a real scheduled execution
  from Muse's infrastructure, and will be labelled as
  exactly that, never as Vercel Cron.
- **Cron listed and enabled:** then it is firing and being
  rejected on the secret-name mismatch. Fix on my side:
  the endpoint additionally accepts Vercel's `CRON_SECRET`
  convention, plus the env var set on the project — a
  small gated change I will ship on Ezat's confirmation of
  what the dashboard shows.

## 2. Supabase PITR — activation procedure

**Current state, re-verified 2026-11-05 via the
Management API** (`GET /v1/projects/{ref}/database/backups`):
`pitr_enabled: false`, `walg_enabled: true`, restorable
backups listed: 0 (scheduled physical backups are
plan/dashboard-side). The WAL prerequisites are in place;
only the paid add-on is missing.

**Exact activation (Ezat, dashboard, ≈2 minutes):**

1. Supabase dashboard → project **ITG-trading-system**.
2. **Database → Backups → Point in Time Recovery**.
3. Choose the recovery retention period and enable the
   add-on; confirm the billing prompt. Pricing per
   Supabase's own documentation (checked 2026-11-05):
   **7 days ≈ $100/month, 14 days ≈ $200/month,
   28 days ≈ $400/month**, billed hourly in arrears,
   per project. PITR requires a paid plan; if the
   dashboard shows a compute prerequisite at enablement,
   it will name it there. WAL archiving starts at
   enablement — recovery to before that moment is not
   possible.
4. Tell me it's on; I will re-read the same API endpoint
   and record `pitr_enabled: true` as the verification.

**Effect:** RPO drops from ~24 h (daily backups +
snapshots) to minutes; RTO from 1–3 h to ~30–60 min
(restore runbook: `docs/runbooks/restore.md`). PITR
covers the database only — Storage objects remain
covered by the snapshot safety net (§4). **No purchase
was made in this pass; enablement is Ezat's billing
decision.**

## 3. Android M2 — latest APK + device acceptance

**Fresh APK built from current production HEAD** (the
Task 12 build predates Tasks 13–28, including the mobile
side of the 10-band ladder):

- GitHub Actions run **41970884469**, workflow
  `mobile-apk.yml`, head commit **c4df024d** — completed
  **success** (all 11 steps; the Gradle step ran long on
  the runner, ~25 minutes, and finished cleanly).
- Artifact `itg-traderos-android-test-apk` downloaded and
  hash-verified locally:
  `itg-traderos-test.apk`, **100,477,624 bytes**,
  **SHA-256 `cdaa4f8892d0e8a952d341676daf97207b7696592a5a32e3e23133f4fda753b8`**.
- The embedded bundle references the production Supabase
  project (`pwzvthvvxyfppenmessf`) and only public values;
  the APK is signed with the CI template keystore —
  **sideload testing only**, not a store build.
- This build **supersedes** run 41522183387
  (commit 25eab1d8) as the M2 test target. The file is
  held at `~/workspace/itg-apk/itg-traderos-test.apk`
  and in the run's GitHub artifact (id 13390452687).
- **No device verification is claimed.** Nothing about
  M2's status changes until Ezat runs the checklist
  below on his phone and reports.

**Physical-device acceptance checklist (concise).** With
your own account, on the device:

1. Install the APK (allow install from this source if
   prompted); the app opens to sign-in without crashing.
2. Sign in; biometric gate (if enabled on the device)
   prompts and unlocks.
3. Dashboard loads your real figures (6 trades: 1 closed,
   5 reversed — nothing else may appear).
4. Log one small trade end-to-end (quick entry); it
   appears in the journal with computed P&L — then void
   it from the trade screen if it was only a test.
5. Open one existing trade → Edit: change a journal field
   only, save; then open the advanced review and save it
   back unchanged.
6. Coach: ask one question; a deterministic answer
   returns with FACTS / INFERENCES / RECOMMENDATIONS.
7. Levels screen shows the 10-band ladder with
   Psychological Discipline at 63.6.
8. Profile: completion shows 100% and the ITG Verified
   badge IS shown beside the name. (Corrected 2026-11-05:
   an earlier draft of this checklist said 63% / no badge,
   based on a stale Oct 30 record; the live row is 8/8
   fields complete since 2026-11-01.)
9. Kill and relaunch the app: session persists; no
   re-login loop.
10. Airplane mode: the app degrades honestly (no fake
    data, no crash).

Report pass/fail per item (any failure: note the step and
what the screen showed). M2 closes on this report — not
before.

## 4. Backups — integrity verification + off-machine procedure

**Integrity, verified 2026-11-05** on the latest snapshot
`~/workspace/itg-backups/2026-11-04-2341` (taken at Task 28
close-out):

- All **34 table exports parse** as valid JSON;
  **797 rows** total; manifest present
  (`created_at`, per-table counts, storage inventory,
  auth inventory of ids/emails only).
- **Exact-count reconciliation** against the live
  database for the financial core: trades **16 = 16**,
  xp_transactions **30 = 30**, audit_logs **560 = 560**.
  Approximate counts for all 34 tables show no drift
  beyond estimation noise.
- **17 storage objects** included; snapshot size 9.8 MB.
- Restore procedure: `docs/runbooks/restore.md`
  (Path A platform backups/PITR, Path B snapshot restore,
  FK-ordered). A Path-B drill still needs a spare
  Supabase project (Ezat's call, register R-12 family).

**Off-machine procedure (documented; destination is
Ezat's choice — nothing was uploaded anywhere):**

Snapshots contain the full database export — treat every
copy as sensitive. Recommended cadence: copy each new
snapshot off this machine (snapshots are taken monthly
and before every production migration). Steps for the
destination Ezat picks:

1. Create a checksum: `sha256sum` over a tar of the
   snapshot directory; keep the checksum with the copy.
2. Encrypt before transfer if the destination is not
   itself encrypted storage (e.g. `age`/`gpg` with a
   passphrase Ezat controls — the passphrase never goes
   in chat or in the repo).
3. Transfer to ONE destination of Ezat's choice:
   personal cloud drive, local machine/NAS, or an
   encrypted external drive.
4. Verify the checksum after transfer; keep the two most
   recent snapshots; delete older copies deliberately.
5. Never commit snapshots to git (`.gitignore`d by
   location — they live outside the repo) and never send
   them through chat/email unencrypted.

When Ezat names the destination, I will perform the
first copy + checksum verification and record it here.

## 5. Auth dashboard + monitoring checklist

**Auth configuration — read live 2026-11-05 via the
Management API (`GET /config/auth`), with one defect
found and fixed in this pass:**

| Setting | Before | Now | Note |
| --- | --- | --- | --- |
| `site_url` | `http://localhost:3000` | **`https://itg-traderos.vercel.app`** | **Defect fixed.** Email links (reset/confirmation) are built on this URL; production users would have received localhost links. |
| `uri_allow_list` | *(empty)* | production `/**` + `localhost:3000/**` + `localhost:3100/**` | Fixed together with site_url; dev flows preserved. |

Fix applied via `PATCH /config/auth` and verified in the
response payload. Remaining settings verified healthy:
email confirmations ON (`mailer_autoconfirm: false`),
refresh-token rotation ON, secure email change ON,
signups open (intended — public registration), only the
email provider enabled, auth rate limits present,
JWT expiry 3600 s (standard). **Policy options left as
Ezat's choices, unchanged:** password minimum length is
6 (Supabase default; the app enforces its own rules at
the form — raising the platform floor to 8+ is a
dashboard/API decision), CAPTCHA off, no MFA factor
enabled, built-in email sending is rate-limited to
2/hour by Supabase (a custom SMTP provider is the
standard remedy if reset/confirmation mail volume ever
matters).

**Monitoring — status per item:**

- **Error tracking (Sentry):** not connected; needs
  Ezat's account + DSN. Setup on approval: add the SDK,
  set `SENTRY_DSN` as a Vercel env var, redeploy, verify
  one captured test error.
- **Uptime monitoring:** not connected; needs Ezat's
  choice of service. Target: `https://itg-traderos.vercel.app/login`
  at 5-minute intervals with email alerts.
- **Vercel Analytics:** not enabled; enablement is a
  dashboard toggle plus a small instrumentation change —
  on Ezat's approval I will ship it through the normal
  gate.
- **Vercel runtime logs/errors:** inaccessible with the
  current connector grant (team-context requirement on a
  personal account — §1, point 4). The production smoke
  suite (9/9 ALL PASS at Task 28) is the standing health
  check in the meantime.

## 6. Residual register R-01–R-27 — maintained

Full register with classifications lives in
`docs/task-28-final-audit.md` §6; this is its maintained
status after the closure pass. C-1 (smoke-script
assertion) is **closed** (fixed, auth smoke re-run
ALL PASS at Task 28).

| ID | Item | Status after closure | Priority | Owner | User approval needed |
| --- | --- | --- | --- | --- | --- |
| R-01 | Supabase PITR off | Open — procedure prepared (§2), state re-verified 2026-11-05 | Medium | Ezat (billing) | **Yes — purchase** |
| R-02 | LLM API key (coach narration) | Open — seam ready | Medium | Ezat (secret) | **Yes — provide key** |
| R-03 | M2 device re-test | Open — fresh APK prepared (§3) | Medium | Ezat (device) | No — report only |
| R-04 | Plan limits as hard limits? | Open — design stands (advice-only) | Low | Ezat (product) | **Yes — decision** |
| R-05 | A's 60 XP backfill | Open — evidence re-confirmed (9 sessions, 5 awards) | Low | Ezat (decision) | **Yes — decision** |
| R-06 | Test account A fate | Open | Low | Ezat (decision) | **Yes — decision** |
| R-07 | Coach language scope EN vs EN/PS/FA | Open — coach verified English-only | Low | Ezat (product) | **Yes — decision** |
| R-08 | Offline support build | Open — absence re-verified | Low | Ezat (product) | **Yes — decision** |
| R-09 | F4 achievement criteria | Open — engine evaluates seed exactly | Low | Ezat (product) | **Yes — decision** |
| R-10 | Nonce CSP | Accepted by design — drafted, unscheduled | Low | Muse (when scheduled) | No |
| R-11 | Monitoring sign-ups | Open — exact steps documented (§5) | Medium | Ezat (accounts) | **Yes — sign-ups** |
| R-12 | Auth checklist / off-machine snapshots | **Partially closed** — Auth defect fixed (§5); snapshot procedure documented (§4); destination + spare-project drill remain | Medium | Ezat (choices) | **Yes — destination choice** |
| R-13 | Cron registration | **Investigated** (§1) — presumptively unregistered; dashboard check is the proof | Low | Ezat (2-min check) | No — information |
| R-14 | Backtest results recording | Open — product decision | Low | Ezat (product) | **Yes — decision** |
| R-15 | Twelve Data display upgrade | Open — optional; keyless panel live | Low | Ezat (key + plan) | **Yes — purchase/key** |
| R-16 | Coach taxonomy additions | Open — 17-intent set stands | Low | Ezat (product) | **Yes — decision** |
| R-17 | Mobile discipline/goal-edit endpoints | Open — documented gaps | Low | Ezat (product) | **Yes — decision** |
| R-18 | In-memory rate limiter | Accepted by design — shared-store swap drafted | Low | Muse (when warranted) | No |
| R-19 | Aux-read PostgREST ~1k ceiling | Accepted — flagged for a future pagination pass | Low | Muse (future pass) | No |
| R-20 | Reporting honesty items (4) | Accepted — documented in Task 6 record | Low | Muse (future reporting pass) | No |
| R-21 | No /verify index page | By design (anti-enumeration) | — | — | No |
| R-22 | Weekly-review text not consumed by intelligence | By design (honesty) | — | — | No |
| R-23 | Market panel scope (no indices; FX = daily reference) | By design, labelled on the surface | — | — | No |
| R-24 | Assessment windows measure stored assessments only | By design | — | — | No |
| R-25 | Dependency majors pending (Next 16/zod 4/TW 4) | Accepted — separate future work; CI audit runs per push | Low | Muse (future) | No |
| R-26 | MCP dist/ trips security:check | Standing procedure, followed | — | Muse | No |
| R-27 | Coach production-URL interactive QA | **Still owed** — environment-bound; deterministic production coach smoke passes 12/12 | Low | Muse (environment) | No |

## 7. Unresolved blockers (complete list)

Everything left open needs exactly one of: Ezat's
dashboard check (R-13), a billing authorization (R-01,
optionally R-15), a secret (R-02), a physical-device
report (R-03), an account sign-up (R-11), a destination
choice (R-12), or a product decision (R-04–R-09, R-14,
R-16, R-17). No item is blocked on engineering.
