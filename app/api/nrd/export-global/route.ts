import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_GLOBAL_EXPORTERS = [
  "martine.gevaert@radius.com",
  "emily.vancauwenberge@radius.com",
];

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

function safeSheetName(name: string) {
  return name
    .split("@")[0]
    .replace(/[\[\]\*\/\\\?\:]/g, "_")
    .slice(0, 31);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const userEmail = url.searchParams.get("user_email");
    const periodMonth = url.searchParams.get("period_month");

    if (!userEmail) {
      return NextResponse.json(
        { ok: false, error: "Missing user_email" },
        { status: 400 }
      );
    }

    if (!ALLOWED_GLOBAL_EXPORTERS.includes(userEmail.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: "Not allowed to export global NRD." },
        { status: 403 }
      );
    }

    const range = getMonthRange(periodMonth);

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .not("ended_at", "is", null)
      .gte("started_at", range.start)
      .lt("started_at", range.end)
      .order("user_email", { ascending: true })
      .order("started_at", { ascending: true });

    if (error) throw error;

    const rows = data || [];

    const wb = XLSX.utils.book_new();

    const totalMinutes = rows.reduce(
      (sum: number, row: any) => sum + Number(row.duration_minutes || 0),
      0
    );

    const globalSummary = [
      { Metric: "Month", Value: range.period_month },
      { Metric: "Exported by", Value: userEmail },
      { Metric: "Total users", Value: new Set(rows.map((r: any) => r.user_email)).size },
      { Metric: "Total tasks", Value: rows.length },
      { Metric: "Total minutes", Value: totalMinutes },
      { Metric: "Total time", Value: formatDuration(totalMinutes) },
    ];

    const wsGlobal = XLSX.utils.json_to_sheet(globalSummary);
    wsGlobal["!cols"] = [{ wch: 24 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsGlobal, "Summary Global");

    const userMap: Record<string, any[]> = {};

    for (const row of rows) {
      const email = row.user_email || "unknown";
      if (!userMap[email]) userMap[email] = [];
      userMap[email].push(row);
    }

    const summaryByUser = Object.entries(userMap)
      .map(([email, userRows]) => {
        const minutes = userRows.reduce(
          (sum: number, row: any) => sum + Number(row.duration_minutes || 0),
          0
        );

        return {
          User: email,
          "Total tasks": userRows.length,
          "Total minutes": minutes,
          "Total time": formatDuration(minutes),
        };
      })
      .sort((a, b) => b["Total minutes"] - a["Total minutes"]);

    const wsByUser = XLSX.utils.json_to_sheet(summaryByUser);
    wsByUser["!cols"] = [
      { wch: 35 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsByUser, "Summary By User");

    const allLogs = rows.map((row: any) => ({
      User: row.user_email || "",
      Date: formatDate(row.started_at),
      "Start Time": formatTime(row.started_at),
      "End Time": row.ended_at ? formatTime(row.ended_at) : "",
      "Task/s": row.task || "",
      "Time Taken": formatDuration(Number(row.duration_minutes || 0)),
      "Time Taken in Minutes": Number(row.duration_minutes || 0),
    }));

    const wsAllLogs = XLSX.utils.json_to_sheet(allLogs);
    wsAllLogs["!cols"] = [
      { wch: 35 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 35 },
      { wch: 16 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(wb, wsAllLogs, "All Logs");

    for (const [email, userRows] of Object.entries(userMap)) {
      const sheetRows = userRows.map((row: any) => ({
        Date: formatDate(row.started_at),
        "Start Time": formatTime(row.started_at),
        "End Time": row.ended_at ? formatTime(row.ended_at) : "",
        "Task/s": row.task || "",
        "Time Taken": formatDuration(Number(row.duration_minutes || 0)),
        "Time Taken in Minutes": Number(row.duration_minutes || 0),
      }));

      const ws = XLSX.utils.json_to_sheet(sheetRows);
      ws["!cols"] = [
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 35 },
        { wch: 16 },
        { wch: 22 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(email));
    }

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=NRD_GLOBAL_${range.period_month}.xlsx`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Global NRD export failed" },
      { status: 500 }
    );
  }
}