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
 */

const selectClass =
  "input-select";
const textareaClass =
  "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <ActionForm action={action} submitLabel="Save review">
      <input type="hidden" name="tradeId" value={trade.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="strategyId">Strategy</Label>
          <select id="strategyId" name="strategyId" defaultValue={trade.strategy_id ?? ""} className={selectClass}>
            <option value="">— Not provided —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="setupName">Setup</Label>
          <Input id="setupName" name="setupName" placeholder="e.g. London open" defaultValue={detail.setupName ?? ""} className="min-h-[44px]" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="marketCondition">Market condition</Label>
          <select id="marketCondition" name="marketCondition" defaultValue={trade.market_condition ?? ""} className={selectClass}>
            <Options labels={MARKET_CONDITION_LABELS} />
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tradeReason">Trade reason</Label>
          <select id="tradeReason" name="tradeReason" defaultValue={trade.trade_reason ?? ""} className={selectClass}>
            <Options labels={TRADE_REASON_LABELS} />
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="session">Session</Label>
          <select id="session" name="session" defaultValue={trade.session ?? ""} className={selectClass}>
            <Options labels={SESSION_LABELS} />
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confidence">Confidence (1–5)</Label>
          <select id="confidence" name="confidence" defaultValue={psychology?.confidence ?? ""} className={selectClass}>
            <option value="">— Not provided —</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="emotion">Emotion</Label>
          <select id="emotion" name="emotion" defaultValue={psychology?.emotion ?? ""} className={selectClass}>
            <Options labels={EMOTION_LABELS} />
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="discipline">Discipline</Label>
          <select id="discipline" name="discipline" defaultValue={psychology?.discipline ?? ""} className={selectClass}>
            <Options labels={DISCIPLINE_LABELS} />
          </select>
        </div>
      {/* Lesson and notes sit in an inset panel — the reflective
          part of the review, set into the form rather than
          floating on it. */}
      <div className="card-surface-inset space-y-4 p-4 sm:col-span-2">
        <div className="space-y-2">
          <Label htmlFor="lesson">What did I learn?</Label>
          <textarea
            id="lesson"
            name="lesson"
            placeholder="One lesson from this trade — it becomes part of your learning library."
            defaultValue={lessons[lessons.length - 1]?.text ?? ""}
            className={textareaClass}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea id="notes" name="notes" placeholder="Anything else about this trade." defaultValue={trade.notes ?? ""} className={textareaClass} />
        </div>
      </div>
      </div>
    </ActionForm>
  );
}
