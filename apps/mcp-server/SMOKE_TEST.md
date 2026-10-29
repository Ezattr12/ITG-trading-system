# Live smoke test — ITG MCP server (Stage 3 POC)

Run 2026-10-29 against the **live** Supabase project
(`pwzvthvvxyfppenmessf`) with the compiled server
(`node dist/apps/mcp-server/src/index.js`) driven over stdio
by a scripted JSON-RPC driver. Verification accounts only.
No tokens or keys appear in this record — tokens were held
in 0600 files under `/tmp` and deleted after the run.

Identities:

- **Account A** — the Stage 2 verification account
  (`itg-verification-test-20261027@example.com`, user
  `c4838c9d-babd-4d8c-9008-e0b1991aaa00`), owner of the
  audit trade below. Access token obtained via the Supabase
  Auth password grant.
- **Account B** — a second throwaway account
  (`itg-mcp-isolation-test-20261029@example.com`, user
  `3c7ffce6-a4f6-4e29-b998-abc058cd06b6`) created via the
  Auth Admin API for the cross-tenant probe, and
  **deleted via the Admin API after the run** (DELETE →
  200; subsequent GET → 404; its profile row
  cascade-deleted).

Target trade (created in the Stage 2 audit through the real
UI): `a227846a-c32b-46f2-9722-c2857843d741` — XAUUSD long
4030 → 4042, TP 4050, SL 4022, size 0.10, strategy "BOS",
setup "London open breakout", psychology calm / confidence
4 / discipline good, 1 lesson, 2 screenshots.

## Scenario 1 — account A token (main)

```
>>> initialize
<<< initialize → protocolVersion=2025-03-26 server=itg-mcp-server@0.1.0 capabilities={"tools":{}}

>>> notifications/initialized
<<< (notification — no response)

>>> tools/list
<<< tools/list → [get_trade, analyze_trade]

>>> tools/call get_trade {"trade_id":"a227846a-c32b-46f2-9722-c2857843d741"}
<<< isError=false payload:
{
  "trade": {
    "id": "a227846a-c32b-46f2-9722-c2857843d741",
    "pair": "XAUUSD",
    "direction": "long",
    "entry_price": 4030,
    "exit_price": 4042,
    "tp": 4050,
    "sl": 4022,
    "position_size": 0.1,
    "leverage": 1,
    "fees": 0,
    "status": "closed",
    "opened_at": "2026-10-29T09:00:00+00:00",
    "closed_at": "2026-10-29T10:00:00+00:00",
    "strategy_id": "4e140f17-c229-4ef3-9f69-bde8a2c8810b",
    "setup_id": "876bbdb9-f43f-4362-9c8b-69817278be97",
    "market_condition": null,
    "trade_reason": null,
    "session": "london",
    "notes": "Audit test trade - followed the plan.",
    "notes_truncated": false,
    "metrics": {
      "pnl": 1.2,
      "roi_pct": 0.297767,
      "r_multiple": 1.5,
      "risk_reward": 2.5,
      "is_win": true,
      "duration_seconds": 3600
    }
  },
  "strategy_name": "BOS",
  "setup_name": "London open breakout",
  "psychology": { "confidence": 4, "emotion": "calm", "discipline": "good" },
  "lessons": [
    { "text": "Wait for confirmation before entering.", "truncated": false, "is_repeated_mistake": false }
  ],
  "lessons_total": 1,
  "screenshot_count": 2,
  "reversal": { "reversal_trade_id": null, "correcting_trade": null, "reversed_trade": null }
}

>>> tools/call analyze_trade {"trade_id":"a227846a-c32b-46f2-9722-c2857843d741"}
<<< isError=false payload (abridged — full payload verified live):
{
  "trade_id": "a227846a-c32b-46f2-9722-c2857843d741",
  "pair": "XAUUSD",
  "status": "closed",
  "metrics": {
    "stored":     { "pnl": 1.2, "roi_pct": 0.297767, "r_multiple": 1.5, "risk_reward": 2.5, "is_win": true, "duration_seconds": 3600 },
    "recomputed": { "pnl": 1.2, "roi_pct": 0.2977667493796526, "r_multiple": 1.5, "risk_reward": 2.5, "is_win": true, "duration_seconds": 3600 },
    "metrics_match": true,
    "mismatches": []
  },
  "plan_adherence": {
    "plan": { "id": "178f13c3-583a-4174-b0b1-1b66e4957cb4", "name": "Audit Trading Plan" },
    "rules_present": true,
    "stop_loss_present": true,
    "take_profit_present": true,
    "leverage": { "trade": 1, "rules_max": 20, "within_rules_limit": true },
    "position_risk": {
      "risk_amount": 0.8,
      "risk_pct_of_capital": null,
      "risk_pct_note": "not computable: the active plan provides no capital base",
      "plan_risk_per_trade_pct": 1,
      "rules_max_risk_per_trade_pct": 1
    }
  },
  "risk_context": { "close_date": "2026-10-29", "events": [], "count": 0, "note": null },
  "journal_completeness": {
    "present": { "strategy": true, "session": true, "emotion": true, "confidence": true, "discipline": true, "lesson": true, "notes": true, "screenshot": true },
    "missing": [],
    "complete": true
  },
  "findings": []
}

>>> tools/call get_trade {"trade_id":"123e4567-e89b-42d3-a456-426614174000"}   (random uuid)
<<< isError=true payload: { "error": { "code": "not_found", "message": "not_found: no such trade" } }

>>> tools/call get_trade {"trade_id":"a227846a-…","user_id":"7f48692e-…"}      (smuggled user_id)
<<< isError=true payload: { "error": { "code": "invalid_argument", "message": "invalid_argument: unknown argument: user_id" } }
```

Notes: P&L **1.20** matches the Stage 2 audit's dashboard
figure exactly. `metrics_match: true` — the stored
`roi_pct` 0.297767 is the recomputation 0.2977667493…
rounded to the `numeric(19,6)` storage precision. The
journal completeness reflects the trade's full review from
the Stage 2 audit. `findings` is empty because no rule
fired on this trade (SL/TP present, leverage within limits,
RR 2.5, R 1.5, discipline good, journal complete) — the
engine invents nothing.

## Scenario 2 — no token

```
>>> tools/call get_trade {"trade_id":"a227846a-c32b-46f2-9722-c2857843d741"}
<<< isError=true payload: { "error": { "code": "unauthenticated", "message": "unauthenticated: missing or invalid access token" } }
```

## Scenario 3 — cross-tenant (account B token, account A's trade)

```
>>> tools/call get_trade    {"trade_id":"a227846a-c32b-46f2-9722-c2857843d741"}
<<< isError=true payload: { "error": { "code": "not_found", "message": "not_found: no such trade" } }

>>> tools/call analyze_trade {"trade_id":"a227846a-c32b-46f2-9722-c2857843d741"}
<<< isError=true payload: { "error": { "code": "not_found", "message": "not_found: no such trade" } }
```

Byte-identical to the nonexistent-trade response in
Scenario 1 — no existence oracle (design §2.7), enforced by
RLS plus the explicit `user_id` filter.

## Audit evidence (live `audit_logs`, `action like 'mcp.%'`)

Exactly one row per `tools/call` — 7 rows for 7 calls:

| action | actor | outcome |
|---|---|---|
| mcp.get_trade | account A | ok |
| mcp.analyze_trade | account A | ok |
| mcp.get_trade | account A | not_found |
| mcp.get_trade | account A | invalid_argument |
| mcp.get_trade | *(null)* | unauthenticated |
| mcp.get_trade | account B | not_found |
| mcp.analyze_trade | account B | not_found |

Each row carries `details = { tool, outcome, duration_ms,
correlation_id, arguments: { trade_id } }` — ids only, no
free text, no token material.

**One wrinkle, recorded honestly:** account B's first two
calls initially produced no audit rows. Cause: an
Admin-API-created user has no `profiles` row until it
passes through the app's own signup flow, and
`audit_logs.user_id` / `actor_id` are foreign keys to
`profiles(id)` — the insert was rejected and swallowed, as
designed (audit must never break a call; same semantics as
the web app's `writeAuditLog`). After inserting the minimal
profile row a real signup would create, the repeat calls
landed their audit rows (the two account-B rows above).
Real trader identities always have a profile row, so this
only affects artificial identities that never entered the
app — but the POC record states it rather than hiding it.
