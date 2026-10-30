import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getReportSummary } from "@/lib/reports/queries";
import { buildCatalogReportPdf, buildReportPdf } from "@/lib/reports/pdf";
import type { ReportType } from "@/lib/reports/types";
import {
  CATALOG_REPORT_KINDS,
  getCatalogReport,
  type CatalogReportKind,
} from "@/lib/reports/catalog";

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
  const traderName =
    user.profile?.full_name?.trim() || user.email || "ITG Trader";

  // Phase 24: an optional `report` parameter selects a catalog
  // report (Performance / Psychology / Risk / Strategy / Coach).
  // The catalog grains are weekly | monthly; the PDF renders
  // the same composed object as the Reports page and computes
  // nothing itself. Without `report`, the legacy summary PDF
  // below is produced exactly as before.
  const reportParam = url.searchParams.get("report");
  if (reportParam !== null) {
    const validKind = (CATALOG_REPORT_KINDS as string[]).includes(reportParam);
    const validGrain = type === "weekly" || type === "monthly";
    if (!validKind || !validGrain) {
      return NextResponse.json(
        { error: "Choose a valid catalog report and a weekly or monthly period." },
        { status: 400 },
      );
    }
    const kind = reportParam as CatalogReportKind;
    const report = await getCatalogReport(
      supabase,
      user.id,
      kind,
      type === "monthly" ? "month" : "week",
      start,
    );
    if (!report || report.periodStart !== start || report.periodEnd !== end) {
      return NextResponse.json(
        { error: "Choose a valid catalog report and a weekly or monthly period." },
        { status: 400 },
      );
    }
    const pdf = await buildCatalogReportPdf(report, traderName);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="itg-report-${kind}-${type}-${start}-to-${end}.pdf"`,
        "Content-Length": String(pdf.length),
      },
    });
  }

  const summary = await getReportSummary(supabase, user.id, {
    type: type as ReportType,
    periodStart: start,
    periodEnd: end,
  });
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
