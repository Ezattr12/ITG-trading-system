"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Calculator,
  CheckCircle2,
  Coins,
  Crosshair,
  Layers,
  Loader2,
  LogOut,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { editTradeAction, type TradeActionResult } from "@/lib/trades/actions";
import { computeTradeMetrics, formatMoney } from "@/lib/trades/calculations";
import type { QuickTradeInput } from "@/lib/trades/validation";
import {
  DISCIPLINE_LABELS,
  EMOTION_LABELS,
  MARKET_CONDITION_LABELS,
  SESSION_LABELS,
  TRADE_REASON_LABELS,
} from "@/lib/trades/validation";
import type { StrategyRow, TradeDetail } from "@/lib/trades/types";

/**
 * Edit Trade form (Ezat's Edit Trade mandate) — ONE full-form
 * save carrying both established field sets under their
 * established names: the quick-entry fields (parsed by the
 * action's parseQuickForm) and the advanced-review fields
 * (read with the review action's keys). The server core
 * (editTradeCore) diffs the submission against the stored
 * trade: financial changes correct by reversal, journal-only
 * changes save in place, no change writes nothing.
 *
 * Derived values (P&L, ROI, R, risk/reward) are NEVER inputs
 * here — they are recalculated server-side. They appear only
 * in the confirmation panel, computed with the same
 * computeTradeMetrics the server uses.
 *
 * Confirmation (mandate §9/§10): when any financial field
 * changed, the first submit is intercepted and a summary
 * panel shows every changed financial field as old → new
 * plus the P&L / R / ROI / risk-reward before → after. Only
 * "Confirm changes" lets the submit through; "Cancel"
 * returns to the form with every value intact (the inputs
 * are never unmounted). Journal-only saves submit directly.
 */

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: ReactNode }) {
  return (
    <div>
      <p className="itg2-eyebrow">{eyebrow}</p>
      <h2 className="itg2-section-title mt-1">{title}</h2>
    </div>
  );
}

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
    <div className={`itg2-field${tone ? ` ${tone}` : ""}`}>
      <div className="mb-2 flex items-center gap-3">
        <span
          className={`itg2-field-icon${tone ? ` itg2-field-icon-${tone}` : ""}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <Label htmlFor={htmlFor} className="itg2-label">
          {label}
        </Label>
      </div>
      {children}
    </div>
  );
}

function Options({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      <option value="">— Not provided —</option>
      {Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

/* ---- submit-time value reading: mirrors the action's parsing ---- */

function toNumberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toIso(v: FormDataEntryValue | null): string | null {
  const s = toText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

interface ConfirmRow {
  label: string;
  from: string;
  to: string;
}

interface ConfirmSummary {
  rows: ConfirmRow[];
  metrics: { label: string; from: string; to: string }[];
}

const dash = (v: number | string | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);
const fmtR = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}R`);
const fmtRoi = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}%`);
const fmtRr = (v: number | null): string => (v === null ? "—" : `1 : ${v.toFixed(2)}`);
const fmtTime = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleString();

export function EditTradeForm({
  detail,
  strategies,
}: {
  detail: TradeDetail;
  strategies: StrategyRow[];
}) {
  const { trade, psychology } = detail;
  const router = useRouter();
  const action = editTradeAction as (
    prev: TradeActionResult,
    formData: FormData,
  ) => Promise<TradeActionResult>;
  const [state, formAction, pending] = useActionState<TradeActionResult, FormData>(
    action,
    { ok: false },
  );
  const [direction, setDirection] = useState<"long" | "short">(trade.direction);
  const [confirm, setConfirm] = useState<ConfirmSummary | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  useEffect(() => {
    if (confirm) confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [confirm]);

  /**
   * Diff the about-to-be-submitted values against the stored
   * trade (same comparisons the core makes) and, when a
   * financial field changed, build the before/after summary.
   * Returns null when nothing financial changed.
   */
  function buildConfirm(formData: FormData): ConfirmSummary | null {
    const pairRaw = toText(formData.get("pair")) ?? "";
    const pair = pairRaw.toUpperCase().replace(/\s+/g, "");
    const entryPrice = toNumberOrNull(formData.get("entryPrice"));
    const exitPrice = toNumberOrNull(formData.get("exitPrice"));
    const tp = toNumberOrNull(formData.get("tp"));
    const sl = toNumberOrNull(formData.get("sl"));
    const positionSize = toNumberOrNull(formData.get("positionSize"));
    const leverage = toNumberOrNull(formData.get("leverage")) ?? 1;
    const fees = toNumberOrNull(formData.get("fees"));
    const openedAt = toIso(formData.get("openedAt"));
    const closedAt = toIso(formData.get("closedAt"));

    const rows: ConfirmRow[] = [];
    const numRow = (
      label: string,
      from: number | null,
      to: number | null,
    ) => {
      if (from !== to) rows.push({ label, from: dash(from), to: dash(to) });
    };
    if (pair !== trade.pair) rows.push({ label: "Pair", from: trade.pair, to: pair });
    if (direction !== trade.direction) {
      rows.push({ label: "Direction", from: trade.direction, to: direction });
    }
    numRow("Entry price", trade.entry_price, entryPrice);
    numRow("Exit price", trade.exit_price, exitPrice);
    numRow("Take profit", trade.tp, tp);
    numRow("Stop loss", trade.sl, sl);
    numRow("Position size", trade.position_size, positionSize);
    numRow("Leverage", trade.leverage, leverage);
    if ((fees ?? 0) !== (trade.fees ?? 0)) {
      rows.push({ label: "Fees", from: dash(trade.fees), to: dash(fees ?? 0) });
    }
    const instantRow = (label: string, from: string | null, to: string | null) => {
      const changed =
        from === null || to === null
          ? from !== to
          : Date.parse(from) !== Date.parse(to);
      if (changed) rows.push({ label, from: fmtTime(from), to: fmtTime(to) });
    };
    instantRow("Opened", trade.opened_at, openedAt);
    instantRow("Closed", trade.closed_at, closedAt);

    if (rows.length === 0) return null;
    // The values cannot price the trade — let the server's
    // validation answer instead of previewing nonsense.
    if (entryPrice === null || positionSize === null || openedAt === null) return null;

    const next: QuickTradeInput = {
      pair,
      direction,
      entryPrice,
      exitPrice,
      tp,
      sl,
      positionSize,
      strategyId: null,
      leverage,
      fees,
      openedAt,
      closedAt,
    };
    const newMetrics = computeTradeMetrics(next);
    return {
      rows,
      metrics: [
        { label: "P&L", from: formatMoney(trade.pnl), to: formatMoney(newMetrics.pnl) },
        { label: "R multiple", from: fmtR(trade.r_multiple), to: fmtR(newMetrics.rMultiple) },
        { label: "ROI", from: fmtRoi(trade.roi_pct), to: fmtRoi(newMetrics.roiPct) },
        { label: "Risk / reward", from: fmtRr(trade.risk_reward), to: fmtRr(newMetrics.riskReward) },
      ],
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return; // The confirmed submit goes through.
    }
    const summary = buildConfirm(new FormData(event.currentTarget));
    if (summary) {
      event.preventDefault();
      setConfirm(summary);
    }
  }

  function confirmSave() {
    confirmedRef.current = true;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      encType="multipart/form-data"
      className="space-y-4"
    >
      {state.error && (
        <p role="alert" className="motion-fade-in flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="motion-fade-in flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 className="motion-scale-in mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </p>
      )}
      <input type="hidden" name="tradeId" value={trade.id} />

      <section className="itg2-card-elevated p-5 sm:p-6" aria-label="Market and prices">
        <PanelHeader eyebrow="Execution" title="Market & prices" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field icon={<Coins className="h-4 w-4" />} label="Asset / pair" htmlFor="pair">
            <Input id="pair" name="pair" required defaultValue={trade.pair} className="itg2-input uppercase" autoComplete="off" />
          </Field>
          <div className="itg2-field">
            <div className="mb-2 flex items-center gap-3">
              <span className="itg2-field-icon" aria-hidden="true">
                <ArrowLeftRight className="h-4 w-4" />
              </span>
              <span id="edit-direction-label" className="itg2-label">
                Long / Short
              </span>
            </div>
            <input type="hidden" name="direction" value={direction} />
            <div className="itg2-segmented" role="group" aria-labelledby="edit-direction-label">
              <button
                type="button"
                aria-pressed={direction === "long"}
                onClick={() => setDirection("long")}
                className={`itg2-segment${direction === "long" ? " itg2-segment-long" : ""}`}
              >
                Long
              </button>
              <button
                type="button"
                aria-pressed={direction === "short"}
                onClick={() => setDirection("short")}
                className={`itg2-segment${direction === "short" ? " itg2-segment-short" : ""}`}
              >
                Short
              </button>
            </div>
          </div>
          <Field icon={<Crosshair className="h-4 w-4" />} label="Entry price" htmlFor="entryPrice">
            <Input id="entryPrice" name="entryPrice" type="number" step="any" min="0" required defaultValue={trade.entry_price} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<LogOut className="h-4 w-4" />} label={<>Exit price <span className="font-normal text-muted-foreground">(leave blank if still open)</span></>} htmlFor="exitPrice">
            <Input id="exitPrice" name="exitPrice" type="number" step="any" min="0" defaultValue={trade.exit_price ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
        </div>
      </section>

      <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Targets, size and timing">
        <PanelHeader eyebrow="Risk" title="Targets, size & timing" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field icon={<TrendingUp className="h-4 w-4" />} label={<>Take profit <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="tp" tone="tp">
            <Input id="tp" name="tp" type="number" step="any" min="0" defaultValue={trade.tp ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<ShieldAlert className="h-4 w-4" />} label={<>Stop loss <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="sl" tone="sl">
            <Input id="sl" name="sl" type="number" step="any" min="0" defaultValue={trade.sl ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<Calculator className="h-4 w-4" />} label="Position size" htmlFor="positionSize">
            <Input id="positionSize" name="positionSize" type="number" step="any" min="0" required defaultValue={trade.position_size} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<Layers className="h-4 w-4" />} label="Leverage" htmlFor="leverage">
            <Input id="leverage" name="leverage" type="number" step="any" min="1" max="500" defaultValue={trade.leverage} inputMode="decimal" className="itg2-input" />
          </Field>
          <div className="itg2-field space-y-2">
            <Label htmlFor="fees" className="itg2-label">Fees <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="fees" name="fees" type="number" step="any" min="0" defaultValue={trade.fees ?? ""} inputMode="decimal" className="itg2-input" />
          </div>
          <div className="itg2-field space-y-2">
            <Label htmlFor="openedAt" className="itg2-label">Opened</Label>
            <Input id="openedAt" name="openedAt" type="datetime-local" required defaultValue={toLocalInput(trade.opened_at)} className="itg2-input" />
          </div>
          <div className="itg2-field space-y-2">
            <Label htmlFor="closedAt" className="itg2-label">Closed <span className="font-normal text-muted-foreground">(required when an exit price is given)</span></Label>
            <Input id="closedAt" name="closedAt" type="datetime-local" defaultValue={toLocalInput(trade.closed_at)} className="itg2-input" />
          </div>
        </div>
      </section>

      <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Journal and review">
        <PanelHeader eyebrow="Review" title="Journal & review" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="itg2-field space-y-2">
            <Label className="itg2-label" htmlFor="strategyId">Strategy</Label>
            <select id="strategyId" name="strategyId" defaultValue={trade.strategy_id ?? ""} className="itg2-select">
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
            <select id="marketCondition" name="marketCondition" defaultValue={trade.market_condition ?? ""} className="itg2-select">
              <Options labels={MARKET_CONDITION_LABELS} />
            </select>
          </div>
          <div className="itg2-field space-y-2">
            <Label className="itg2-label" htmlFor="tradeReason">Trade reason</Label>
            <select id="tradeReason" name="tradeReason" defaultValue={trade.trade_reason ?? ""} className="itg2-select">
              <Options labels={TRADE_REASON_LABELS} />
            </select>
          </div>
          <div className="itg2-field space-y-2">
            <Label className="itg2-label" htmlFor="session">Session</Label>
            <select id="session" name="session" defaultValue={trade.session ?? ""} className="itg2-select">
              <Options labels={SESSION_LABELS} />
            </select>
          </div>
          <div className="itg2-field space-y-2">
            <Label className="itg2-label" htmlFor="confidence">Confidence (1–5)</Label>
            <select id="confidence" name="confidence" defaultValue={psychology?.confidence ?? ""} className="itg2-select">
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
            <select id="emotion" name="emotion" defaultValue={psychology?.emotion ?? ""} className="itg2-select">
              <Options labels={EMOTION_LABELS} />
            </select>
          </div>
          <div className="itg2-field space-y-2">
            <Label className="itg2-label" htmlFor="discipline">Discipline</Label>
            <select id="discipline" name="discipline" defaultValue={psychology?.discipline ?? ""} className="itg2-select">
              <Options labels={DISCIPLINE_LABELS} />
            </select>
          </div>
          <div className="itg2-inset space-y-4 p-4 sm:col-span-2">
            <div className="itg2-field space-y-2">
              <Label className="itg2-label" htmlFor="lesson">What did I learn?</Label>
              <textarea
                id="lesson"
                name="lesson"
                placeholder="One lesson from this trade — it becomes part of your learning library."
                defaultValue={detail.lessons[detail.lessons.length - 1]?.text ?? ""}
                className="itg2-textarea"
              />
            </div>
            <div className="itg2-field space-y-2">
              <Label className="itg2-label" htmlFor="notes">Notes</Label>
              <textarea id="notes" name="notes" placeholder="Anything else about this trade." defaultValue={trade.notes ?? ""} className="itg2-textarea" />
            </div>
          </div>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        P&amp;L, ROI, R multiple, risk/reward, win/loss and duration are calculated automatically — you never
        enter them. Financial changes correct this trade by reversal: a corrected trade is created and this one
        is marked reversed, so the audit trail stays intact. Journal changes save in place.
      </p>

      {confirm ? (
        <div ref={confirmRef} className="itg2-card-elevated motion-fade-in p-5 sm:p-6" role="group" aria-label="Confirm financial changes">
          <PanelHeader eyebrow="Confirm changes" title="Review the financial changes" />
          <p className="mt-2 text-sm text-muted-foreground">
            This change will recalculate the trade&apos;s P&amp;L, R-multiple and related analytics. Saving
            creates a corrected trade and marks this one as reversed — the original stays in the audit trail.
          </p>
          <dl className="mt-4 text-sm">
            {confirm.rows.map((row) => (
              <div key={row.label} className="itg2-row">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tnum text-right font-medium">
                  {row.from} <span aria-hidden="true">→</span> {row.to}
                </dd>
              </div>
            ))}
          </dl>
          <dl className="mt-4 border-t border-white/10 pt-4 text-sm">
            {confirm.metrics.map((row) => (
              <div key={row.label} className="itg2-row">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tnum text-right font-medium">
                  {row.from} <span aria-hidden="true">→</span> {row.to}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="itg2-btn-ghost" onClick={() => setConfirm(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="itg2-btn-primary itg2-btn-save" onClick={confirmSave} disabled={pending} aria-busy={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Please wait…
                </>
              ) : (
                "Confirm changes"
              )}
            </button>
          </div>
        </div>
      ) : (
        <button type="submit" className="itg2-btn-primary itg2-btn-save" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Please wait…
            </>
          ) : (
            "Save changes"
          )}
        </button>
      )}
    </form>
  );
}
