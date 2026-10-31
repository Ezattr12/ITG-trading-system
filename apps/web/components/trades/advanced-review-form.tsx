"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAdvancedReviewAction, type TradeActionResult } from "@/lib/trades/actions";
import {
  DISCIPLINE_LABELS,
  EMOTION_LABELS,
  MARKET_CONDITION_LABELS,
  SESSION_LABELS,
  TRADE_REASON_LABELS,
} from "@/lib/trades/validation";
import type { StrategyRow, TradeDetail } from "@/lib/trades/types";

/**
 * Advanced Review (Phase 3, spec §11–16).
 * Everything optional, never forced: a trade saved with Quick
 * Entry alone is complete, and this review can be added any
 * time later. Strategy options come from the Phase 1 system
 * strategies; a typed setup name creates the trader's own
 * setup row. Honest options (FOMO, Revenge) exist for honest
 * journaling — they are never encouraged.
 *
 * Master Web UI Redesign Page 4 — PRESENTATION ONLY: labels,
 * selects, inputs and textareas moved onto the Page 2 v2
 * form system (.itg2-label / .itg2-select / .itg2-input /
 * .itg2-textarea), the lesson/notes well became .itg2-inset,
 * and the submit uses .itg2-btn-primary via ActionForm's
 * submitClassName. The field set is exactly as before —
 * every name, defaultValue (strategy and setup round-trip
 * from the trade, per the full-form save rule), option and
 * the action are untouched. Used only by the trade detail
 * page.
 */

const selectClass = "itg2-select";
const textareaClass =
  "itg2-textarea";

function Options({ labels, includeBlank = true }: { labels: Record<string, string>; includeBlank?: boolean }) {
  return (
    <>
      {includeBlank && <option value="">— Not provided —</option>}
      {Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

export function AdvancedReviewForm({
  detail,
  strategies,
}: {
  detail: TradeDetail;
  strategies: StrategyRow[];
}) {
  const { trade, psychology, lessons } = detail;
  const action = saveAdvancedReviewAction as (
    prev: TradeActionResult,
    formData: FormData,
  ) => Promise<TradeActionResult>;
  return (
    <ActionForm action={action} submitLabel="Save review" submitClassName="itg2-btn-primary itg2-btn-save">
      <input type="hidden" name="tradeId" value={trade.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="strategyId">Strategy</Label>
          <select id="strategyId" name="strategyId" defaultValue={trade.strategy_id ?? ""} className={selectClass}>
            <option value="">— Not provided —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="setupName">Setup</Label>
          <Input id="setupName" name="setupName" placeholder="e.g. London open" defaultValue={detail.setupName ?? ""} className="itg2-input" />
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="marketCondition">Market condition</Label>
          <select id="marketCondition" name="marketCondition" defaultValue={trade.market_condition ?? ""} className={selectClass}>
            <Options labels={MARKET_CONDITION_LABELS} />
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="tradeReason">Trade reason</Label>
          <select id="tradeReason" name="tradeReason" defaultValue={trade.trade_reason ?? ""} className={selectClass}>
            <Options labels={TRADE_REASON_LABELS} />
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="session">Session</Label>
          <select id="session" name="session" defaultValue={trade.session ?? ""} className={selectClass}>
            <Options labels={SESSION_LABELS} />
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="confidence">Confidence (1–5)</Label>
          <select id="confidence" name="confidence" defaultValue={psychology?.confidence ?? ""} className={selectClass}>
            <option value="">— Not provided —</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="emotion">Emotion</Label>
          <select id="emotion" name="emotion" defaultValue={psychology?.emotion ?? ""} className={selectClass}>
            <Options labels={EMOTION_LABELS} />
          </select>
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="discipline">Discipline</Label>
          <select id="discipline" name="discipline" defaultValue={psychology?.discipline ?? ""} className={selectClass}>
            <Options labels={DISCIPLINE_LABELS} />
          </select>
        </div>
      {/* Lesson and notes sit in an inset panel — the reflective
          part of the review, set into the form rather than
          floating on it. */}
      <div className="itg2-inset space-y-4 p-4 sm:col-span-2">
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="lesson">What did I learn?</Label>
          <textarea
            id="lesson"
            name="lesson"
            placeholder="One lesson from this trade — it becomes part of your learning library."
            defaultValue={lessons[lessons.length - 1]?.text ?? ""}
            className={textareaClass}
          />
        </div>
        <div className="itg2-field space-y-2">
          <Label className="itg2-label" htmlFor="notes">Notes</Label>
          <textarea id="notes" name="notes" placeholder="Anything else about this trade." defaultValue={trade.notes ?? ""} className={textareaClass} />
        </div>
      </div>
      </div>
    </ActionForm>
  );
}
