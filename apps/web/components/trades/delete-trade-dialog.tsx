"use client";

import {
  useActionState,
  useEffect,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteTradeAction, type TradeActionResult } from "@/lib/trades/actions";

/**
 * Delete Trade confirmation dialog (Ezat's Delete Trade
 * mandate). A trade is NEVER removed by a single tap: this
 * modal names the exact trade (pair, direction, opened date,
 * P&L), states the real consequence in plain words, and only
 * then offers the destructive button. The optional reason is
 * exactly that — optional; the select defaults to
 * "Not specified" and the core validates the value against
 * its enum.
 *
 * The form binds deleteTradeAction with the useActionState +
 * TradeActionResult pattern (as in edit-trade-form): errors
 * render inside the dialog with the form state preserved, and
 * success follows the action's redirectTo (the trades list,
 * which shows the "Trade removed successfully." notice).
 * Removal itself is the core's lifecycle transition — no row
 * is hard-deleted, and the copy below says so honestly.
 */
export function DeleteTradeDialog({
  tradeId,
  pair,
  direction,
  status,
  openedAtLabel,
  pnlLabel,
  onClose,
}: {
  tradeId: string;
  pair: string;
  direction: string;
  status: string;
  openedAtLabel: string;
  pnlLabel: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<TradeActionResult, FormData>(
    deleteTradeAction,
    { ok: false },
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  // Basic modal behaviour: focus the panel on open, close on
  // Escape, and return focus to whatever opened the dialog.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-trade-title"
        className="itg2-card-elevated w-full max-w-md p-5 outline-none sm:p-6"
        style={{
          borderColor: "rgba(255, 77, 114, 0.45)",
          boxShadow: "0 24px 60px rgba(2, 10, 30, 0.6), 0 0 32px rgba(255, 77, 114, 0.12)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{
              color: "#ffb3c2",
              border: "1px solid rgba(255, 77, 114, 0.45)",
              background: "rgba(120, 18, 40, 0.35)",
            }}
          >
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="delete-trade-title" className="itg2-section-title">
              Delete trade?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This trade will be removed from your active trading journal, dashboard and
              analytics. Its financial history and audit record will be preserved for data
              integrity.
            </p>
          </div>
        </div>

        <dl className="mt-4 text-sm">
          <div className="itg2-row">
            <dt className="text-muted-foreground">Pair</dt>
            <dd className="text-right font-medium">{pair}</dd>
          </div>
          <div className="itg2-row">
            <dt className="text-muted-foreground">Direction</dt>
            <dd className="text-right">
              <span
                className={`itg2-chip itg2-chip-dir capitalize ${
                  direction === "long" ? "itg2-chip-profit" : "itg2-chip-loss"
                }`}
              >
                {direction}
              </span>{" "}
              <span className="itg2-chip itg2-chip-muted capitalize">{status}</span>
            </dd>
          </div>
          <div className="itg2-row">
            <dt className="text-muted-foreground">Opened</dt>
            <dd className="tnum text-right font-medium">{openedAtLabel}</dd>
          </div>
          <div className="itg2-row">
            <dt className="text-muted-foreground">P&amp;L</dt>
            <dd className="tnum text-right font-medium">{pnlLabel}</dd>
          </div>
        </dl>

        <form action={formAction} className="mt-5 space-y-4">
          <input type="hidden" name="tradeId" value={tradeId} />
          {state.error && (
            <p
              role="alert"
              className="motion-fade-in rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              {state.error}
            </p>
          )}
          <div>
            <label htmlFor={`delete-reason-${tradeId}`} className="itg2-label">
              Reason (optional)
            </label>
            <select
              id={`delete-reason-${tradeId}`}
              name="reason"
              defaultValue=""
              className="itg2-select mt-1"
            >
              <option value="">Not specified</option>
              <option value="mistake">Mistake</option>
              <option value="duplicate">Duplicate</option>
              <option value="test">Test trade</option>
              <option value="incorrect_entry">Incorrect entry</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button" className="itg2-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="itg2-btn-danger" disabled={pending} aria-busy={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Removing…
                </>
              ) : (
                "Delete trade"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
