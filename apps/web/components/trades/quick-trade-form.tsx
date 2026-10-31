"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Calculator,
  ChevronDown,
  Coins,
  Crosshair,
  ImagePlus,
  Layers,
  LogOut,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  X,
} from "lucide-react";
import { ActionForm } from "@/components/auth/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadScreenshotAction, type TradeActionResult } from "@/lib/trades/actions";
import type { TradeRow } from "@/lib/trades/types";
import {
  submitTradeWithScreenshot,
  validateScreenshotFile,
} from "./attach-screenshot";

/**
 * Quick Trade Entry (Phase 3, spec §9, §16; Phase 15 redesign;
 * Phase 19 premium glass redesign; Master Web UI Redesign
 * Page 2 — v2 glass terminal).
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
 * Page 2 presentation: the fields are grouped into `.itg2`
 * glass panels (L2 execution panel, L1 risk / context panels)
 * with icon-led fields (`.itg2-field-icon` tile in the label
 * row); Long/Short is the `.itg2-segmented` control — the
 * value is still submitted as the `direction` field via a
 * hidden input, so the save logic, validation and routing are
 * untouched. Direction semantics follow Ezat's written brief:
 * Long is green/cyan, Short is red/pink, TP green, SL red.
 * Save Trade uses `.itg2-btn-primary .itg2-btn-save`
 * (ActionForm `submitClassName`), with the same
 * pending/disabled behaviour as the default button. Every
 * control is an `.itg2-input` / `.itg2-select` (48px minimum,
 * blue focus glow) and every target is at least 44px.
 *
 * Screenshot attach-at-create (Page 2; mobile already had
 * it): only when `attachScreenshot` is passed (the Add trade
 * page). The picked image is previewed / replaceable /
 * removable before saving; on save it is uploaded through
 * the existing screenshot action AFTER the trade is created
 * (see ./attach-screenshot) — the create payload is
 * unchanged, and an upload failure never blocks the trade:
 * the trader lands on the trade page with a `?shot=failed`
 * notice. With no screenshot picked the submit is identical
 * to before.
 */

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

/** Panel header: blue eyebrow over the section title. */
function PanelHeader({ eyebrow, title }: { eyebrow: string; title: ReactNode }) {
  return (
    <div>
      <p className="itg2-eyebrow">{eyebrow}</p>
      <h2 className="itg2-section-title mt-1">{title}</h2>
    </div>
  );
}

export function QuickTradeForm({
  action,
  submitLabel,
  tradeId,
  initial,
  strategies,
  attachScreenshot = false,
}: {
  action: (prev: TradeActionResult, formData: FormData) => Promise<TradeActionResult>;
  submitLabel: string;
  tradeId?: string;
  initial?: TradeRow | null;
  strategies?: { id: string; name: string }[];
  attachScreenshot?: boolean;
}) {
  const nowLocal = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowValue = `${nowLocal.getFullYear()}-${pad(nowLocal.getMonth() + 1)}-${pad(nowLocal.getDate())}T${pad(nowLocal.getHours())}:${pad(nowLocal.getMinutes())}`;
  const [direction, setDirection] = useState<"long" | "short">(initial?.direction ?? "long");

  /* Screenshot attach-at-create (Add trade page only). The
     File lives in state — the orchestration uploads the
     state copy, so a re-render after a validation error
     never loses the pick. */
  const [shotFile, setShotFile] = useState<File | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [shotPreview, setShotPreview] = useState<string | null>(null);
  const shotInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shotFile) {
      setShotPreview(null);
      return;
    }
    const url = URL.createObjectURL(shotFile);
    setShotPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shotFile]);

  function onShotChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const error = validateScreenshotFile(file);
    if (error) {
      setShotError(error);
      return;
    }
    setShotError(null);
    setShotFile(file);
  }

  function removeShot() {
    setShotFile(null);
    setShotError(null);
    if (shotInputRef.current) shotInputRef.current.value = "";
  }

  // With attachScreenshot, submissions run through the
  // create → upload orchestration; without it the action is
  // passed through untouched (byte-identical to before).
  const formAction = attachScreenshot
    ? (prev: TradeActionResult, formData: FormData) =>
        submitTradeWithScreenshot(action, uploadScreenshotAction, prev, formData, shotFile)
    : action;

  return (
    <ActionForm action={formAction} submitLabel={submitLabel} submitClassName="itg2-btn-primary itg2-btn-save">
      {tradeId && <input type="hidden" name="tradeId" value={tradeId} />}
      <section className="itg2-card-elevated p-5 sm:p-6" aria-label="Market and prices">
        <PanelHeader eyebrow="Execution" title="Market & prices" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field icon={<Coins className="h-4 w-4" />} label="Asset / pair" htmlFor="pair">
            <Input
              id="pair"
              name="pair"
              required
              placeholder="EUR/USD"
              defaultValue={initial?.pair ?? ""}
              className="itg2-input uppercase"
              autoComplete="off"
            />
          </Field>
          <div className="itg2-field">
            <div className="mb-2 flex items-center gap-3">
              <span className="itg2-field-icon" aria-hidden="true">
                <ArrowLeftRight className="h-4 w-4" />
              </span>
              <span id="direction-label" className="itg2-label">
                Long / Short
              </span>
            </div>
            <input type="hidden" name="direction" value={direction} />
            <div className="itg2-segmented" role="group" aria-labelledby="direction-label">
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
            <Input id="entryPrice" name="entryPrice" type="number" step="any" min="0" required placeholder="1.1000" defaultValue={initial?.entry_price ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<LogOut className="h-4 w-4" />} label={<>Exit price <span className="font-normal text-muted-foreground">(leave blank if still open)</span></>} htmlFor="exitPrice">
            <Input id="exitPrice" name="exitPrice" type="number" step="any" min="0" placeholder="1.1200" defaultValue={initial?.exit_price ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
        </div>
      </section>
      <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Targets and position size">
        <PanelHeader eyebrow="Risk" title="Targets & size" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field icon={<TrendingUp className="h-4 w-4" />} label={<>Take profit <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="tp" tone="tp">
            <Input id="tp" name="tp" type="number" step="any" min="0" placeholder="1.1300" defaultValue={initial?.tp ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<ShieldAlert className="h-4 w-4" />} label={<>Stop loss <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="sl" tone="sl">
            <Input id="sl" name="sl" type="number" step="any" min="0" placeholder="1.0900" defaultValue={initial?.sl ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
          <Field icon={<Calculator className="h-4 w-4" />} label="Position size" htmlFor="positionSize">
            <Input id="positionSize" name="positionSize" type="number" step="any" min="0" required placeholder="10000" defaultValue={initial?.position_size ?? ""} inputMode="decimal" className="itg2-input" />
          </Field>
        </div>
      </section>
      {strategies !== undefined ? (
        <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Strategy">
          <PanelHeader eyebrow="Context" title="Strategy" />
          <div className="mt-5">
            <Field icon={<Layers className="h-4 w-4" />} label={<>Strategy <span className="font-normal text-muted-foreground">(optional)</span></>} htmlFor="strategyId">
              <select id="strategyId" name="strategyId" defaultValue={initial?.strategy_id ?? ""} className="itg2-select">
                <option value="">No strategy</option>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>
      ) : null}
      {attachScreenshot ? (
        <section className="itg2-card itg2-card-flat p-5 sm:p-6" aria-label="Screenshot">
          <PanelHeader
            eyebrow="Evidence"
            title={
              <>
                Screenshot <span className="font-normal text-muted-foreground">(optional)</span>
              </>
            }
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Attach a chart screenshot now, or add one later from the trade page. Images only, max 5 MB,
            stored privately with this trade.
          </p>
          <input
            ref={shotInputRef}
            id="screenshot"
            name="screenshot"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onShotChange}
            aria-label="Choose a screenshot image"
          />
          {shotFile && shotPreview ? (
            <div className="mt-4">
              <div className="itg2-upload-preview">
                {/* Blob-URL preview of the trader's own pick — next/image cannot serve object URLs. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shotPreview} alt="Selected screenshot preview" className="max-h-64 w-full object-contain" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {shotFile.name} <span className="text-muted-foreground">· {formatFileSize(shotFile.size)}</span>
                </span>
                <button type="button" className="itg2-btn-ghost" onClick={() => shotInputRef.current?.click()}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Replace
                </button>
                <button type="button" className="itg2-btn-ghost itg2-text-loss" onClick={removeShot}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label htmlFor="screenshot" className="itg2-upload mt-4">
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
              <span className="text-sm font-semibold text-[var(--itg-text-primary)]">Attach a screenshot</span>
              <span className="text-xs text-muted-foreground">
                Image up to 5 MB — uploaded when you save the trade.
              </span>
            </label>
          )}
          {shotError && (
            <p role="alert" className="motion-fade-in mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {shotError}
            </p>
          )}
        </section>
      ) : null}
      <details className="itg2-card itg2-card-flat p-5 sm:p-6">
        <summary className="itg2-details-summary">
          More details (optional)
          <ChevronDown className="itg2-details-chevron h-4 w-4" aria-hidden="true" />
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="itg2-field space-y-2">
            <Label htmlFor="leverage" className="itg2-label">Leverage</Label>
            <Input id="leverage" name="leverage" type="number" step="any" min="1" max="500" defaultValue={initial?.leverage ?? 1} inputMode="decimal" className="itg2-input" />
          </div>
          <div className="itg2-field space-y-2">
            <Label htmlFor="fees" className="itg2-label">Fees <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="fees" name="fees" type="number" step="any" min="0" placeholder="0" defaultValue={initial?.fees ?? ""} inputMode="decimal" className="itg2-input" />
          </div>
          <div className="itg2-field space-y-2">
            <Label htmlFor="openedAt" className="itg2-label">Opened</Label>
            <Input id="openedAt" name="openedAt" type="datetime-local" required defaultValue={initial ? toLocalInput(initial.opened_at) : nowValue} className="itg2-input" />
          </div>
          <div className="itg2-field space-y-2">
            <Label htmlFor="closedAt" className="itg2-label">Closed <span className="font-normal text-muted-foreground">(required when an exit price is given)</span></Label>
            <Input id="closedAt" name="closedAt" type="datetime-local" defaultValue={initial ? toLocalInput(initial.closed_at) : ""} className="itg2-input" />
          </div>
        </div>
      </details>
      <p className="text-sm text-muted-foreground">
        P&amp;L, ROI, R multiple, risk/reward, win/loss and duration are calculated automatically — you never enter
        them.{" "}
        {attachScreenshot
          ? "Strategy, psychology and lesson are optional and can be added later from the trade page; a screenshot can be attached above or added later."
          : "Strategy, psychology, lesson and screenshots are optional and can be added later from the trade page."}
      </p>
    </ActionForm>
  );
}
