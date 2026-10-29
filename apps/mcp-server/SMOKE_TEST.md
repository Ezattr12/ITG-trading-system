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


---

## Stage 4 smoke test (2026-10-29)

Same compiled server, same stdio driver pattern as the
Stage 3 run above, against the production Supabase project.
The test account's known state going in (verified by SQL
before the run): 1 closed XAUUSD trade (+1.20, R 1.5,
strategy "BOS", session london, closed 2026-10-29), 4 goals
(one manual progress 4/10, two journal_completion, one with
no progress), risk rules (1% / 200 / 5 / 3 / lev 20) and the
"Audit Trading Plan" active, a stored weekly review for the
week of 2026-10-26, XP total 200, a stored Platinum level
(score 84.5), 0 discipline events, 6 unread notifications,
0 risk events.

Every returned aggregate was cross-checked against SQL
ground truth after the run. **All matched exactly:**

| Call | Result vs SQL ground truth |
|---|---|
| `tools/list` | exactly the 12 tools (2 Stage 3 + 10 Stage 4) |
| `get_recent_trades {}` | 1 trade, XAUUSD +1.2, R 1.5, strategy "BOS", pagination {returned 1, limit 10, truncated false} |
| `get_recent_trades {limit 5, pair "xau"}` | same trade (case-insensitive pair filter) |
| `get_performance_summary {2026-10-01 → 2026-10-31}` | count 1, wins 1, net 1.2, win rate 100, avg win 1.2, avg loss null, profit factor null (no losses), expectancy 1.2, avg R 1.5, max drawdown 0, streak 1, best = worst = the trade |
| `get_performance_summary {2026-01-01 → 2026-01-31}` | empty range: count 0, net 0, all rates/averages null, best/worst null |
| `get_strategy_performance {Oct}` | 1 group "BOS", net 1.2 |
| `get_session_performance {Oct}` | 1 group "london", net 1.2 |
| `get_psychology_summary {Oct}` | closed 1, with records 1, without 0; calm {1, 1.2, 100%}; band 4-5 {1, 1.2, 100%}; discipline good {1, 1.2, 100%}; avg confidence 4 |
| `get_risk_status {}` | rules 1/200/5/3/20; plan "Audit Trading Plan" 1/200/5; today's events 0 (all severities 0); open events 0 |
| `get_goal_progress {}` | 4 goals: manual goal progress 4 (40%, source manual); both journal_completion goals measured 1 (20%); the plain "other" goal progress null + "Measured in the app" |
| `get_discipline_status {}` | recent_events [], unread_notifications 6 |
| `get_level_status {}` | Platinum, score 84.5, full 8-dimension breakdown; XP total 200; by reason achievement 115 (4), backtest_session 45 (3), weekly_review 30 (1), trade_journal 10 (1); 9 recent events, newest first |
| `get_weekly_review {week_start 2026-10-29}` | normalized to week 2026-10-26 → 2026-11-01; stored review returned in full (173 chars, not truncated) with stored aggregates exactly as saved (trades_count 0, P&L null — the review predates the trade); live week_summary count 1, net 1.2, avg R 1.5 |
| `get_weekly_review {week_start 2026-10-19}` | `not_found` (no review that week) |
| `get_performance_summary {from > to}` | `invalid_argument` naming `from` |
| `get_recent_trades {limit 99}` | `invalid_argument` naming `limit` |
| `get_weekly_review {week_start "not-a-date"}` | `invalid_argument` naming `week_start` |
| `get_risk_status {user_id …}` | `invalid_argument: unknown argument: user_id` (rejected before any query) |

Audit: exactly one `audit_logs` row per call, actions
`mcp.<tool_name>`, entity types trades / risk_rules /
goals / discipline_events / user_levels / weekly_reviews,
outcomes ok / not_found / invalid_argument as appropriate.
Audit `details.arguments` carry only structured values
(limit, from, to, week_start) — the free-text `pair` filter
is deliberately not recorded. No tokens or secrets appear
in this record or in any tool result.
