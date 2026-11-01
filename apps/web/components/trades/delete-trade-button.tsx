"use client";

import { useState } from "react";
import { DeleteTradeDialog } from "./delete-trade-dialog";

/**
 * Delete Trade trigger + dialog for one trade (Delete Trade
 * mandate). The trades list is a server component, so this
 * small client component owns the dialog's open state. Two
 * trigger treatments: `link` for the list rows/cards (a quiet
 * danger-toned link beside View/Edit — Delete is never the
 * primary action anywhere) and `button` for the trade detail
 * danger zone (a prominent .itg2-btn-danger, still secondary
 * to the hero's primary Edit Trade button).
 *
 * Parents render this only for open/closed trades — a removed
 * trade offers no delete control at all.
 */
export function DeleteTradeButton({
  tradeId,
  pair,
  direction,
  status,
  openedAtLabel,
  pnlLabel,
  variant = "link",
  label = "Delete",
}: {
  tradeId: string;
  pair: string;
  direction: string;
  status: string;
  openedAtLabel: string;
  pnlLabel: string;
  variant?: "link" | "button";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "button" ? (
        <button type="button" className="itg2-btn-danger" onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <button
          type="button"
          className="itg2-link itg2-link-danger min-h-11"
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      )}
      {open && (
        <DeleteTradeDialog
          tradeId={tradeId}
          pair={pair}
          direction={direction}
          status={status}
          openedAtLabel={openedAtLabel}
          pnlLabel={pnlLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
