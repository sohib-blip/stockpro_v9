import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUserEmail } from "@/lib/api-identity";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

function getMonthRange(periodMonth?: string | null) {
  const now = new Date();

  const month =
    periodMonth && /^\d{4}-\d{2}$/.test(periodMonth)
      ? periodMonth
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [year, monthNumber] = month.split("-").map(Number);

  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  return {
    period_month: month,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fr-BE", {
    timeZone: "Europe/Brussels",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("fr-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const userEmail = resolveApiUserEmail(
      req,
      url.searchParams.get("user_email")
    );
    const periodMonth = url.searchParams.get("period_month");

    const range = getMonthRange(periodMonth);

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .not("ended_at", "is", null)
      .gte("started_at", range.start)
      .lt("started_at", range.end)
      .order("started_at", { ascending: true });

    if (error) throw error;

    const rows = data || [];

    const exportRows = rows.map((row: any) => ({
      Date: formatDate(row.started_at),
      "Start Time": formatTime(row.started_at),
      "End Time": row.ended_at ? formatTime(row.ended_at) : "",
      "Task/s": row.task || "",
      "Time Taken": formatDuration(Number(row.duration_minutes || 0)),
      "Time Taken in Minutes": Number(row.duration_minutes || 0),
    }));

    const totalMinutes = rows.reduce(
      (sum: number, row: any) => sum + Number(row.duration_minutes || 0),
      0
    );

    const summaryRows = [
      {
        Metric: "User",
        Value: userEmail,
      },
      {
        Metric: "Month",
        Value: range.period_month,
      },
      {
        Metric: "Total tasks",
        Value: rows.length,
      },
      {
        Metric: "Total minutes",
        Value: totalMinutes,
      },
      {
        Metric: "Total time",
        Value: formatDuration(totalMinutes),
      },
    ];

    const taskTotals: Record<string, number> = {};

    for (const row of rows) {
      const task = row.task || "Unknown";
      taskTotals[task] =
        (taskTotals[task] || 0) + Number(row.duration_minutes || 0);
    }

    const taskSummaryRows = Object.entries(taskTotals)
      .map(([task, minutes]) => ({
        Task: task,
        Minutes: minutes,
        Time: formatDuration(minutes),
      }))
      .sort((a, b) => b.Minutes - a.Minutes);

    const wb = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    const taskSheet = XLSX.utils.json_to_sheet(taskSummaryRows);
    XLSX.utils.book_append_sheet(wb, taskSheet, "Task Summary");

    const logSheet = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, logSheet, "NRD Logs");

    summarySheet["!cols"] = [{ wch: 24 }, { wch: 35 }];
    taskSheet["!cols"] = [{ wch: 35 }, { wch: 14 }, { wch: 14 }];
    logSheet["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 35 },
      { wch: 16 },
      { wch: 22 },
    ];

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    const safeUser = userEmail.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=NRD_${safeUser}_${range.period_month}.xlsx`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "NRD export failed" },
      { status: 500 }
    );
  }
}
