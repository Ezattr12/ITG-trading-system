"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/trades/calculations";
import { usePrefersReducedMotion } from "@/lib/motion/use-reduced-motion";

/**
 * Chart components (Phase 4). Client components wrapping Recharts
 * 2.15.4 — the chart library chosen in Plan v2 §1. Every chart on
 * the dashboard / analytics / progress pages is paired with a
 * plain data table in the server page, so the numbers are readable
 * without the chart.
 *
 * Colours follow the spec §35 palette: green = positive,
 * red = risk/loss, amber = warning, blue = information.
 *
 * Phase 15: axis ticks are compact on narrow screens (short
 * money labels, narrower Y axis, thinned X labels), chart
 * heights shrink on mobile, and tooltips use the token surface
 * colours. Charts stay decision tools, not decoration.
 *
 * Phase 17: every chart sits on a `.chart-panel` — an inset
 * surface inside its card — so the chart reads as a panel
 * set into the card, the layered depth the reference images
 * get from cards-within-cards.
 */

const GREEN = "#34d399";
const RED = "#f87171";
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";

function moneyTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const compact = (abs / 1000).toFixed(1).replace(/\.0$/, "");
    return `${value < 0 ? "-" : ""}${compact}k`;
  }
  return formatMoney(value);
}

const TICK = { fill: "#a8b3c5", fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: "#171b25",
  border: "1px solid #2b3242",
  borderRadius: "0.75rem",
  color: "#e8ecf3",
};

export function EquityChart({
  data,
}: {
  data: { date: string; equity: number; drawdown: number; trades: number }[];
}) {
  // Chart motion (Phase 16): the curve draws in over 600ms with
  // an ease-out curve — fast and professional, never decorative.
  // Data transitions animate the same way; with reduced motion
  // the chart renders its final state immediately.
  const reduced = usePrefersReducedMotion();
  return (
    <div className="chart-panel">
    <div className="h-56 w-full sm:h-64" role="img" aria-label={`Equity curve over ${data.length} closed trades`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a38" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Cumulative P&L"]}
            labelFormatter={(label) => `Closed ${label}`}
            contentStyle={TOOLTIP_STYLE}
          />
          <Area type="monotone" dataKey="equity" stroke={GREEN} fill={GREEN} fillOpacity={0.15} name="Cumulative P&L" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

export function DrawdownChart({ data }: { data: { date: string; drawdown: number }[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="chart-panel">
    <div className="h-44 w-full sm:h-48" role="img" aria-label="Drawdown over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a38" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Drawdown"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Area type="monotone" dataKey="drawdown" stroke={RED} fill={RED} fillOpacity={0.2} name="Drawdown" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

export function PeriodPnlChart({ data }: { data: { label: string; pnl: number }[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="chart-panel">
    <div className="h-56 w-full sm:h-64" role="img" aria-label="Profit and loss by period">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a38" />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "P&L"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="pnl" name="P&L" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out">
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.pnl >= 0 ? GREEN : RED} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

export function RDistributionChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="chart-panel">
    <div className="h-52 w-full sm:h-56" role="img" aria-label="Distribution of R multiples">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a38" />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={TICK} tickLine={false} allowDecimals={false} width={40} />
          <Tooltip
            formatter={(value) => [`${value} trades`, "Trades"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="count" name="Trades" fill={BLUE} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

export function XpHistoryChart({ data }: { data: { date: string; cumulativeXp: number }[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="chart-panel">
    <div className="h-52 w-full sm:h-56" role="img" aria-label="Cumulative XP over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a38" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} allowDecimals={false} width={50} />
          <Tooltip
            formatter={(value) => [`${value} XP`, "Total XP"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Line type="monotone" dataKey="cumulativeXp" stroke={AMBER} strokeWidth={2} dot={false} name="Total XP" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </LineChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}
