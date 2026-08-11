import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  areLowStockEmailsEnabled,
  isCronRequestAuthorized,
} from "@/lib/cron/lowStockPolicy";
import { buildLowStockEmail } from "@/lib/cron/lowStockEmail";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!isCronRequestAuthorized(req.headers.get("authorization"), cronSecret)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error: maintenanceError } = await supabase.rpc(
    "run_workload_maintenance"
  );

  if (maintenanceError) {
    return NextResponse.json(
      { ok: false, error: "Security maintenance failed" },
      { status: 500 }
    );
  }

  const emailEnabled = areLowStockEmailsEnabled(
    process.env.ENABLE_LOW_STOCK_EMAILS,
    process.env.VERCEL_ENV
  );

  if (!emailEnabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "low-stock emails disabled for this environment",
    });
  }

  // emails
  const { data: subs } = await supabase
    .from("alert_subscribers")
    .select("email")
    .eq("is_enabled", true);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, reason: "no subscribers" });
  }

  // Use the exact same min-stock values and stock calculation as Dashboard.
  const { data: summary, error: summaryError } = await supabase
    .from("dashboard_bins_view")
    .select("device,imei_count,min_stock,stock_status")
    .eq("stock_status", "low");

  if (summaryError) {
    return NextResponse.json(
      { ok: false, error: summaryError.message },
      { status: 500 }
    );
  }

  const low = summary || [];

  if (low.length === 0) {
    return NextResponse.json({ ok: true, reason: "no low stock" });
  }

  const email = buildLowStockEmail(low);

  const resend = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StockPro <alerts@stockpro.app>",
      to: subs.map((s) => s.email),
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!resend.ok) {
    return NextResponse.json(
      { ok: false, error: "Unable to send low-stock alerts" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, low: low.length });
}
