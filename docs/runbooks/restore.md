# Restore runbook — ITG TraderOS

_Last verified: 2026-10-30 (Phase 28). Keep this file current; a
runbook that has never been read in an emergency is a liability._

## What can be lost, and what brings it back

| Layer | Source of truth | Restore path |
| --- | --- | --- |
| Database (data) | Supabase project `pwzvthvvxyfppenmessf` | Supabase backup / PITR (dashboard) — or the logical snapshot below |
| Database (schema) | `supabase/migrations/` in git | Re-apply migrations in order to a fresh project |
| Storage objects (avatars, trade screenshots) | Supabase Storage buckets | Logical snapshot (files) or Supabase backup |
| Auth users | Supabase Auth | Supabase backup (password hashes are never exported by us) |
| Code | GitHub `Ezattr12/ITG-trading-system` | Clone → deploy (Vercel) |
| Configuration / secrets | Vercel env vars + Supabase dashboard | Re-enter from the inventory in Phase 28 doc §5 (names only — values live in the providers' vaults) |

## Path A — Supabase backup / PITR restore (preferred when available)

1. Supabase dashboard → project **ITG-trading-system** → Database →
   Backups.
2. Choose the backup (scheduled) or the point in time (PITR, if
   enabled — see Phase 28 doc; as of 2026-10-30 PITR is **not**
   enabled).
3. Restore into a **new** project first when the situation allows
   it; verify (row counts per §Verify below + a login + the summary
   endpoint), then repoint the app's env vars
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) and redeploy.
4. In-place restore is the last resort: it discards everything
   after the restore point.

## Path B — logical snapshot restore (no Supabase backup available)

Snapshots live OUTSIDE git at `~/workspace/itg-backups/<stamp>/`
(script: `~/workspace/itg-backups/snapshot.py`; contains
`data/<table>.json` for all 32 public tables,
`storage/<bucket>/<path>` files, and `manifest.json` with row
counts).

1. Create a fresh Supabase project (same region, ap-northeast-1).
2. Apply `supabase/migrations/` in filename order (Management API
   SQL endpoint or the Supabase SQL editor), then the production
   config seed (strategies / levels / achievements / motivation —
   see the Phase 13 record in `MEMORY.md` / phase docs).
3. Recreate auth users (dashboard or Admin API) — **ids must match
   the snapshot's `manifest.json` auth_users**, because every table
   references them. Users set new passwords (or use magic links);
   hashes are not portable from a snapshot.
4. Load data with the service-role key, parents before children:
   profiles → strategies → setups → trades → (psychology_records,
   lessons, trade_screenshots rows) → everything else; config
   tables (levels, achievements, motivation, system_settings) come
   from the seed, so skip or upsert them. Verify counts against
   `manifest.json` per table.
5. Re-upload storage files to their buckets at identical paths.
6. Repoint env vars (Path A step 3) and redeploy from git HEAD.
7. Run the §Verify checklist.

## Verify (either path)

- Row counts per table == snapshot manifest (or backup metadata).
- Test-account aggregates: October 2026 = 8 closed trades /
  3,702.50 total P&L / XP total 390 (state as of 2026-10-30 —
  update this line whenever a new snapshot becomes the reference).
- `POST /api/mobile/session` for a known user → `created: false`.
- Coach chat answers the weekly question with matching figures.
- Spot-check one signed screenshot URL loads.

## Cadence

- Logical snapshot: before every production migration, and at
  least monthly. Run, verify counts, record the stamp in the
  phase doc / memory.
- Restore drill: walk Path B against a throwaway project once
  per quarter (needs a spare project — a paid-tier decision,
  see Phase 28).
