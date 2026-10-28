"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Calculator,
  Coins,
  Crosshair,
  Layers,
  LogOut,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TradeActionResult } from "@/lib/trades/actions";
import type { TradeRow } from "@/lib/trades/types";

/**
 * Quick Trade Entry (Phase 3, spec §9, §16; Phase 15 redesign;
 * Phase 19 premium glass redesign).
 *
 * The quick path stays minimal so a trade records in 30–60
 * seconds on one hand: Pair, Long/Short, Entry, Exit, TP, SL,
 * Position size, Strategy. P&L, ROI, R multiple, risk/reward,
 * win/loss and duration are calculated server-side and are not
 * fields here — the trader never enters them.
 *
 * Leverage, fees and open/close times still exist (Phase 3
 * behaviour is preserved), but they live behind an optional
 * disclosure so they do not crowd the quick path. Opened
 * defaults to now, so the form still submits without opening it.
 *
 * Reused for corrections: pass `initial` (the trade being
 * corrected) and the correction action; saving a correction
 * creates a reversing trade, it never overwrites the original.
 * Corrections keep the original strategy — the strategy select
 * is only rendered when `strategies` is passed (Add trade page).
 *
 * Phase 19 presentation (docs/phase-19.md): the form is an
 * `.itg-trade-form` mirror-glass panel; every field is
 * icon-led (the icon tile sits in the label row, per the
 * reference image); Long/Short is a segmented control
 * instead of a <select> — the value is still submitted as
 * the `direction` field via a hidden input, so the save
 * logic, validation and routing are untouched. Direction
 * semantics follow Ezat's written brief: Long is green/cyan,
 * Short is red/pink, TP green, SL red. Save Trade uses the
 * gradient `.itg-save-trade` button (ActionForm
 * `submitClassName`), with the same pending/disabled
 * behaviour as the default button.
 */

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One icon-led field: icon tile + label row, input below. */
function Field({
  icon,
  label,
  htmlFor,
  children,
  tone,
}: {
  icon: ReactNode;
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  tone?: "tp" | "sl";
}) {
  return (
    <div className={`trade-field${tone ? ` ${tone}` : ""}`}>
      <div className="mb-2 flex items-center gap-3">
        <span className="trade-field-icon" aria-hidden="true">
          {icon}
        </span>
        <Label htmlFor={htmlFor}>{label}</Label>
      </div>
      {children}
    </div>
  );
}

export function QuickTradeForm({
  action,
  submitLabel,
  tradeId,
  initial,
  strategies,
}: {
  action: (prev: TradeActionResult, formData: FormData) => Promise<TradeActionResult>;
  submitLabel: string;
  tradeId?: string;
  initial?: TradeRow | null;
  strategies?: { id: string; name: string }[];
}) {
  const nowLocal = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowValue = `${nowLocal.getFullYear()}-${pad(nowLocal.getMonth() + 1)}-${pad(nowLocal.getDate())}T${pad(nowLocal.getHours())}:${pad(nowLocal.getMinutes())}`;
  const [direction, setDirection] = useState<"long" | "short">(initial?.direction ?? "long");

  return (
    <ActionForm action={action} submitLabel={submitLabel} submitClassName="itg-save-trade">
      {tradeId && <input type="hidden" name="tradeId" value={tradeId} />}
      <div className="grid gap-6 sm:grid-cols-2">
        <Field icon={<Coins className="h-4 w-4" />} label="Asset / pair" htmlFor="pair">
          <Input
            id="pair"
            name="pair"
            required
            placeholder="EUR/USD"
            defaultValue={initial?.pair ?? ""}
            className="uppercase"
            autoComplete="off"
          />
        </Field>
        <div className="trade-field">
          <div className="mb-2 flex items-center gap-3">
            <span className="trade-field-icon" aria-hidden="true">
              <ArrowLeftRight className="h-4 w-4" />
            </span>
            <span id="direction-label" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Long / Short
            </span>
          </div>
          <input type="hidden" name="direction" value={direction} />
          <div className="trade-direction" role="group" aria-labelledby="direction-label">
            <button
              type="button"
              aria-pressed={direction === "long"}
              onClick={() => setDirection("long")}
              className={`trade-direction-button${direction === "long" ? " active long" : ""}`}
            >
              Long
            </button>
            <button
              type="button"
              aria-pressed={direction === "short"}
              onClick={() => setDirection("short")}
              className={`trade-direction-button${direction === "short" ? " active short" : ""}`}
            >
              Short
            </button>
          </div>
        </div>
        <Field icon={<Crosshair className="h-4 w-4" />} label="Entry price" htmlFor="entryPrice">
          <Input id="entryPrice" name="entryPrice" type="number" step="any" min="0" required placeholder="1.1000" defaultValue={initial?.entry_price ?? ""} inputMode="decimal" />
        </Field>
        <Field icon={<LogOut className="h-4 w-4" />} label={<>Exit price <span className="font-normal text-muted-foreground">(leave blank if still open)</span></>} htmlFor="exitPrice">
          <Input id="exitPrice" name="exitPrice" type="number" step="any" min="0" placeholder="1.1200" defaultValue={initial?.exit_price ?? ""} inputMode="decimal" />
        </Field>
        <Field icon={<TrendingUp className="h-4 w-4" />} label={<>Take profit <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="tp" tone="tp">
          <Input id="tp" name="tp" type="number" step="any" min="0" placeholder="1.1300" defaultValue={initial?.tp ?? ""} inputMode="decimal" />
        </Field>
        <Field icon={<ShieldAlert className="h-4 w-4" />} label={<>Stop loss <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="sl" tone="sl">
          <Input id="sl" name="sl" type="number" step="any" min="0" placeholder="1.0900" defaultValue={initial?.sl ?? ""} inputMode="decimal" />
        </Field>
        <Field icon={<Calculator className="h-4 w-4" />} label="Position size" htmlFor="positionSize">
          <Input id="positionSize" name="positionSize" type="number" step="any" min="0" required placeholder="10000" defaultValue={initial?.position_size ?? ""} inputMode="decimal" />
        </Field>
        {strategies !== undefined ? (
          <Field icon={<Layers className="h-4 w-4" />} label={<>Strategy <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="strategyId">
            <select id="strategyId" name="strategyId" defaultValue={initial?.strategy_id ?? ""} className="input-select">
              <option value="">No strategy</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <details className="card-surface-inset p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          More details (optional)
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="leverage">Leverage</Label>
            <Input id="leverage" name="leverage" type="number" step="any" min="1" max="500" defaultValue={initial?.leverage ?? 1} inputMode="decimal" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fees">Fees <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="fees" name="fees" type="number" step="any" min="0" placeholder="0" defaultValue={initial?.fees ?? ""} inputMode="decimal" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="openedAt">Opened</Label>
            <Input id="openedAt" name="openedAt" type="datetime-local" required defaultValue={initial ? toLocalInput(initial.opened_at) : nowValue} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="closedAt">Closed <span className="font-normal text-muted-foreground">(required when an exit price is given)</span></Label>
            <Input id="closedAt" name="closedAt" type="datetime-local" defaultValue={initial ? toLocalInput(initial.closed_at) : ""} />
          </div>
        </div>
      </details>
      <p className="text-sm text-muted-foreground">
        P&amp;L, ROI, R multiple, risk/reward, win/loss and duration are calculated automatically — you never enter
        them. Strategy, psychology, lesson and screenshots are optional and can be added later from the trade page.
      </p>
    </ActionForm>
  );
}
