"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
 * red = risk/loss, amber = warning, blue = information,
 * violet = XP / AI.
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
 *
 * Phase 18 Aurora: premium chart treatment, CSS/SVG only. Area
 * charts fill with an SVG linearGradient that fades from
 * the line colour to transparent (emerald for equity, red
 * for drawdown, violet for XP); line weight is 2.5; the grid
 * is a faint violet-tinted dashed line; tooltips are dark
 * purple glass (translucent, blurred, white 0.18 border) so
 * they read as frosted glass floating over the chart, with a
 * soft shadow; bars have rounded tops and a hover cursor
 * wash; hover dots appear on area/line charts. The 600ms
 * draw-in and the reduced-motion behaviour (final state
 * immediately) are unchanged, and positive/negative states
 * stay semantic (green up, red down). Series colours
 * (green / red / blue / violet) are unchanged.
 */

const GREEN = "#34d399";
const RED = "#f87171";
const BLUE = "#60a5fa";
const BLUE_DEEP = "#3b82f6";
const VIOLET = "#a78bfa";

function moneyTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const compact = (abs / 1000).toFixed(1).replace(/\.0$/, "");
    return `${value < 0 ? "-" : ""}${compact}k`;
  }
  return formatMoney(value);
}

const TICK = { fill: "#a9adc9", fontSize: 11 };
const GRID_PROPS = { strokeDasharray: "3 3", stroke: "#2b2640", strokeOpacity: 0.5 };
const TOOLTIP_STYLE = {
  backgroundColor: "rgba(26, 12, 40, 0.92)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: "0.75rem",
  color: "#e8ecf3",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
  backdropFilter: "blur(12px)",
  fontSize: 13,
  padding: "10px 12px",
};
const TOOLTIP_LABEL_STYLE = { color: "#e8ecf3", fontWeight: 600 };
const AREA_CURSOR = { stroke: "#3a3252", strokeWidth: 1 };
const BAR_CURSOR = { fill: "rgba(255, 255, 255, 0.04)" };
const ACTIVE_DOT = { r: 4, strokeWidth: 0 };

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
          <defs>
            <linearGradient id="itg-equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GREEN} stopOpacity={0.32} />
              <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Cumulative P&L"]}
            labelFormatter={(label) => `Closed ${label}`}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={AREA_CURSOR}
          />
          <Area type="monotone" dataKey="equity" stroke={GREEN} strokeWidth={2.5} fill="url(#itg-equity-fill)" dot={false} activeDot={ACTIVE_DOT} name="Cumulative P&L" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
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
          <defs>
            <linearGradient id="itg-drawdown-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RED} stopOpacity={0.35} />
              <stop offset="100%" stopColor={RED} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Drawdown"]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={AREA_CURSOR}
          />
          <Area type="monotone" dataKey="drawdown" stroke={RED} strokeWidth={2.5} fill="url(#itg-drawdown-fill)" dot={false} activeDot={ACTIVE_DOT} name="Drawdown" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
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
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={TICK} tickLine={false} tickFormatter={moneyTick} width={56} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "P&L"]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={BAR_CURSOR}
          />
          <Bar dataKey="pnl" name="P&L" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out">
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
          <defs>
            <linearGradient id="itg-r-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BLUE} stopOpacity={1} />
              <stop offset="100%" stopColor={BLUE_DEEP} stopOpacity={0.75} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={TICK} tickLine={false} allowDecimals={false} width={40} />
          <Tooltip
            formatter={(value) => [`${value} trades`, "Trades"]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={BAR_CURSOR}
          />
          <Bar dataKey="count" name="Trades" fill="url(#itg-r-fill)" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
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
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <defs>
            <linearGradient id="itg-xp-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIOLET} stopOpacity={0.32} />
              <stop offset="100%" stopColor={VIOLET} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} allowDecimals={false} width={50} />
          <Tooltip
            formatter={(value) => [`${value} XP`, "Total XP"]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            cursor={AREA_CURSOR}
          />
          <Area type="monotone" dataKey="cumulativeXp" stroke={VIOLET} strokeWidth={2.5} fill="url(#itg-xp-fill)" dot={false} activeDot={ACTIVE_DOT} name="Total XP" isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

/**
 * Subtle equity sparkline for the dashboard P&L hero (Phase 18).
 * No axes, grid or tooltip — the hero number and the full equity
 * chart beside it already carry the values; this is the shape
 * of the curve at a glance, like the balance sparkline in the
 * reference fintech screens. The line colour follows the real
 * final equity: green when positive, red when negative, blue
 * at break-even. Same 600ms draw-in and reduced-motion rule
 * as the full charts.
 */
export function EquitySparkline({
  data,
}: {
  data: { date: string; equity: number }[];
}) {
  const reduced = usePrefersReducedMotion();
  const finalEquity = data.length > 0 ? data[data.length - 1].equity : 0;
  const color = finalEquity < 0 ? RED : finalEquity > 0 ? GREEN : BLUE;
  return (
    <div className="h-16 w-full sm:h-20" role="img" aria-label={`Equity sparkline, ending at ${formatMoney(finalEquity)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="itg-spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="equity" stroke={color} strokeWidth={2.5} fill="url(#itg-spark-fill)" dot={false} isAnimationActive={!reduced} animationDuration={600} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
