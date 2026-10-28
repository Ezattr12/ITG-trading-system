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

/**
 * Chart components (Phase 4). Client components wrapping Recharts
 * 2.15.4 — the chart library chosen in Plan v2 §1. Every chart on
 * the dashboard / analytics / progress pages is paired with a
 * plain data table in the server page, so the numbers are readable
 * without the chart.
 *
 * Colours follow the spec §35 palette: green = positive,
 * red = risk/loss, amber = warning, blue = information.
 */

const GREEN = "#34d399";
const RED = "#f87171";
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";

function moneyTick(value: number): string {
  return formatMoney(value);
}

export function EquityChart({
  data,
}: {
  data: { date: string; equity: number; drawdown: number; trades: number }[];
}) {
  return (
    <div className="h-64 w-full" role="img" aria-label={`Equity curve over ${data.length} closed trades`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} tickFormatter={moneyTick} width={70} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Cumulative P&L"]}
            labelFormatter={(label) => `Closed ${label}`}
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          />
          <Area type="monotone" dataKey="equity" stroke={GREEN} fill={GREEN} fillOpacity={0.15} name="Cumulative P&L" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ data }: { data: { date: string; drawdown: number }[] }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Drawdown over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} tickFormatter={moneyTick} width={70} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "Drawdown"]}
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          />
          <Area type="monotone" dataKey="drawdown" stroke={RED} fill={RED} fillOpacity={0.2} name="Drawdown" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PeriodPnlChart({ data }: { data: { label: string; pnl: number }[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Profit and loss by period">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} tickFormatter={moneyTick} width={70} />
          <Tooltip
            formatter={(value) => [formatMoney(Number(value)), "P&L"]}
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          />
          <Bar dataKey="pnl" name="P&L">
            {data.map((entry) => (
              <Cell key={entry.label} fill={entry.pnl >= 0 ? GREEN : RED} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RDistributionChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Distribution of R multiples">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} allowDecimals={false} width={40} />
          <Tooltip
            formatter={(value) => [`${value} trades`, "Trades"]}
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          />
          <Bar dataKey="count" name="Trades" fill={BLUE} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function XpHistoryChart({ data }: { data: { date: string; cumulativeXp: number }[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Cumulative XP over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} allowDecimals={false} width={50} />
          <Tooltip
            formatter={(value) => [`${value} XP`, "Total XP"]}
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          />
          <Line type="monotone" dataKey="cumulativeXp" stroke={AMBER} strokeWidth={2} dot={false} name="Total XP" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
