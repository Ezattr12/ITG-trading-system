import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getReportSummary } from "@/lib/reports/queries";
import { buildReportPdf } from "@/lib/reports/pdf";
import type { ReportType } from "@/lib/reports/types";

/**
 * Report PDF download (Phase 8, spec §27).
 *
 * The PDF is generated on demand from the computed summary —
 * it is NOT stored in Supabase Storage in this phase (that is
 * the Phase 13 step). The query must name a valid report type
 * and a period (start/end, YYYY-MM-DD); anything else is a 400.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const validType = type === "daily" || type === "weekly" || type === "monthly";
  const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!validType || !validDate(start) || !validDate(end) || end < start) {
    return NextResponse.json(
      { error: "Choose a valid report type and period." },
      { status: 400 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not connected yet." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const summary = await getReportSummary(supabase, user.id, {
    type: type as ReportType,
    periodStart: start,
    periodEnd: end,
  });
  const traderName =
    user.profile?.full_name?.trim() || user.email || "ITG Trader";
  const pdf = await buildReportPdf(summary, traderName);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="itg-report-${type}-${start}-to-${end}.pdf"`,
      "Content-Length": String(pdf.length),
    },
  });
}
