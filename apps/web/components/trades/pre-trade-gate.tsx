"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, OctagonX, ShieldCheck } from "lucide-react";
import {
  evaluatePreTradeGateAction,
  type GateActionResult,
} from "@/lib/gate/actions";
import type { GateLevel } from "@/lib/gate/types";
import { PLAN_TERM_LABELS } from "@/lib/plan/types";

/**
 * Pre-trade gate check (Task 20). Rendered inside the Add
 * Trade form (opt-in, via QuickTradeForm's `gateCheck`
 * prop) — NOT on corrections, which re-journal by reversal
 * and are not new trades.
 *
 * The button reads the enclosing form's current values and
 * asks the server to judge the candidate BEFORE save. It
 * never submits the form and never saves anything: checking
 * twice, or checking and walking away, has no side effects
 * (the gate action is read-only). Colours follow the v2
 * system: green = ready, amber = caution, red = rule
 * violation. Violet is never used here — violet is the AI
 * Coach identity only.
 */

const LEVEL_META: Record<
  GateLevel,
  { label: string; banner: string; icon: typeof CheckCircle2 }
> = {
  ready: {
    label: "READY",
    banner: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle2,
  },
  caution: {
    label: "CAUTION",
    banner: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    icon: AlertTriangle,
  },
  rule_violation: {
    label: "RULE VIOLATION",
    banner: "border-red-500/40 bg-red-500/10 text-red-200",
    icon: OctagonX,
  },
};

const RISK_RULE_LABELS: Record<string, string> = {
  leverage_limit: "Leverage",
  daily_loss_limit: "Daily loss (today)",
  daily_trade_limit: "Trades per day (today)",
  risk_per_trade: "Risk per trade",
  consecutive_losses: "Consecutive losses",
  positive_streak: "Discipline streak",
};

export function PreTradeGateCheck() {
  const [result, setResult] = useState<GateActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onCheck(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest("form");
    if (!form) return;
    const formData = new FormData(form);
    startTransition(async () => {
      setResult(await evaluatePreTradeGateAction(formData));
    });
  }

  return (
    <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Pre-trade risk gate">
      <p className="itg2-eyebrow">Before you save</p>
      <h2 className="itg2-section-title mt-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        Pre-trade risk gate
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Judge this trade against your trading plan and your risk rules before saving. Checking never
        saves anything — and a CAUTION never blocks a save. Only a RULE VIOLATION means the save
        itself would be refused by your risk rules.
      </p>
      <button
        type="button"
        className="itg2-btn-ghost mt-4"
        onClick={onCheck}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking…
          </>
        ) : (
          "Check pre-trade gate"
        )}
      </button>

      {result && !result.ok && (
        <p role="alert" className="motion-fade-in mt-4 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {result.error}
        </p>
      )}

      {result && result.ok && (() => {
        const gate = result.gate;
        const meta = LEVEL_META[gate.level];
        const Icon = meta.icon;
        const notEvaluable = gate.planVerdicts.filter((v) => v.status === "not_evaluable");
        const riskRows = gate.riskChecks.filter(
          (c) => c.severity !== "positive" || c.breached,
        );
        return (
          <div className="mt-4 space-y-4">
            <p role="status" className={`motion-fade-in flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${meta.banner}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>{meta.label}</strong> — {gate.summary}
              </span>
            </p>

            <div>
              <h3 className="text-sm font-semibold text-[var(--itg-text-primary)]">Trading plan</h3>
              {!gate.hasPlan ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No active trading plan — set one on the Plan page to check trades against it.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {gate.planVerdicts.map((v) => (
                    <li key={v.term} className="flex items-start gap-2 text-sm">
                      <span
                        className={
                          v.status === "breached"
                            ? "font-semibold text-amber-200"
                            : v.status === "adhered"
                              ? "font-semibold text-emerald-200"
                              : "font-semibold text-muted-foreground"
                        }
                      >
                        {PLAN_TERM_LABELS[v.term]}:
                      </span>
                      <span className="text-muted-foreground">{v.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[var(--itg-text-primary)]">Risk rules (today)</h3>
              {!gate.hasRules ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No active risk rules — set them on the Risk page. Risk rules are the only limits
                  that can refuse a save.
                </p>
              ) : riskRows.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No risk rules are configured — nothing to check against.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {riskRows.map((c) => (
                    <li key={c.rule} className="flex items-start gap-2 text-sm">
                      <span
                        className={
                          c.severity === "critical" && c.breached
                            ? "font-semibold text-red-200"
                            : c.severity === "warning" && c.breached
                              ? "font-semibold text-amber-200"
                              : c.severity === "positive"
                                ? "font-semibold text-emerald-200"
                                : "font-semibold text-emerald-200"
                        }
                      >
                        {RISK_RULE_LABELS[c.rule] ?? c.rule}:
                      </span>
                      <span className="text-muted-foreground">{c.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {notEvaluable.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Could not be checked:{" "}
                {notEvaluable.map((v) => `${PLAN_TERM_LABELS[v.term]} — ${v.reason}`).join("; ")}.
                An unchecked term is not a pass. Quick entry records no session or setup, so those
                terms can only be judged once a review records them.
              </p>
            )}

            {gate.level === "rule_violation" && (
              <p className="text-sm text-muted-foreground">
                Fix the breached rule — lower the leverage, or wait out today&apos;s loss limit — or
                change the limit on the Risk page. Saving now would be refused with the same message.
              </p>
            )}
            {gate.level === "caution" && (
              <p className="text-sm text-muted-foreground">
                You can still save this trade: the journal records what happened, and any plan breach
                will be recorded against your plan after you save.
              </p>
            )}
          </div>
        );
      })()}
    </section>
  );
}
