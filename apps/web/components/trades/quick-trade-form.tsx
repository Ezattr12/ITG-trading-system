"use client";

import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TradeActionResult } from "@/lib/trades/actions";
import type { TradeRow } from "@/lib/trades/types";

/**
 * Quick Trade Entry (Phase 3, spec §9, §16).
 *
 * Minimal fields only, big touch targets (min 44px), so a trade
 * can be saved in 30–60 seconds on mobile. P&L, ROI, R multiple,
 * risk/reward, win/loss and duration are calculated server-side
 * and are not fields here — the trader never enters them.
 *
 * Reused for corrections: pass `initial` (the trade being
 * corrected) and the correction action; saving a correction
 * creates a reversing trade, it never overwrites the original.
 */

const inputClass = "min-h-[44px]";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QuickTradeForm({
  action,
  submitLabel,
  tradeId,
  initial,
}: {
  action: (prev: TradeActionResult, formData: FormData) => Promise<TradeActionResult>;
  submitLabel: string;
  tradeId?: string;
  initial?: TradeRow | null;
}) {
  const nowLocal = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowValue = `${nowLocal.getFullYear()}-${pad(nowLocal.getMonth() + 1)}-${pad(nowLocal.getDate())}T${pad(nowLocal.getHours())}:${pad(nowLocal.getMinutes())}`;

  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {tradeId && <input type="hidden" name="tradeId" value={tradeId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pair">Asset / pair</Label>
          <Input
            id="pair"
            name="pair"
            required
            placeholder="EUR/USD"
            defaultValue={initial?.pair ?? ""}
            className={`${inputClass} uppercase`}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="direction">Long / Short</Label>
          <select id="direction" name="direction" defaultValue={initial?.direction ?? "long"} className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${inputClass}`}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="entryPrice">Entry price</Label>
          <Input id="entryPrice" name="entryPrice" type="number" step="any" min="0" required placeholder="1.1000" defaultValue={initial?.entry_price ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="exitPrice">Exit price <span className="font-normal text-muted-foreground">(leave blank if still open)</span></Label>
          <Input id="exitPrice" name="exitPrice" type="number" step="any" min="0" placeholder="1.1200" defaultValue={initial?.exit_price ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tp">Take profit <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="tp" name="tp" type="number" step="any" min="0" placeholder="1.1300" defaultValue={initial?.tp ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sl">Stop loss <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="sl" name="sl" type="number" step="any" min="0" placeholder="1.0900" defaultValue={initial?.sl ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="positionSize">Position size</Label>
          <Input id="positionSize" name="positionSize" type="number" step="any" min="0" required placeholder="10000" defaultValue={initial?.position_size ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="leverage">Leverage</Label>
          <Input id="leverage" name="leverage" type="number" step="any" min="1" max="500" defaultValue={initial?.leverage ?? 1} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fees">Fees <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="fees" name="fees" type="number" step="any" min="0" placeholder="0" defaultValue={initial?.fees ?? ""} className={inputClass} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="openedAt">Opened</Label>
          <Input id="openedAt" name="openedAt" type="datetime-local" required defaultValue={initial ? toLocalInput(initial.opened_at) : nowValue} className={inputClass} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="closedAt">Closed <span className="font-normal text-muted-foreground">(required when an exit price is given)</span></Label>
          <Input id="closedAt" name="closedAt" type="datetime-local" defaultValue={initial ? toLocalInput(initial.closed_at) : ""} className={inputClass} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        P&amp;L, ROI, R multiple, risk/reward, win/loss and duration are calculated automatically — you never enter
        them. Strategy, psychology, lesson and screenshots are optional and can be added later from the trade page.
      </p>
    </ActionForm>
  );
}
