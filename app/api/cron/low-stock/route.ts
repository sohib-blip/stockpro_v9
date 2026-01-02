import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // emails
  const { data: subs } = await supabase
    .from("alert_subscribers")
    .select("email")
    .eq("is_enabled", true);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, reason: "no subscribers" });
  }

  // thresholds
  const { data: thresholds } = await supabase
    .from("device_thresholds")
    .select("device,min_stock");

  const minMap = new Map<string, number>();
  thresholds?.forEach((t) =>
    minMap.set(t.device, Number(t.min_stock || 0))
  );

  // stock summary (tu l’as déjà)
  const { data: summary } = await supabase.rpc(
    "dashboard_summary_per_device"
  );

  const low = (summary || []).filter((r: any) => {
    const min = minMap.get(r.device) ?? 0;
    return r.in_stock <= min;
  });

  if (low.length === 0) {
    return NextResponse.json({ ok: true, reason: "no low stock" });
  }

  const html = low
    .map(
      (d: any) =>
        `<li><b>${d.device}</b> — IN ${d.in_stock} ≤ MIN ${minMap.get(d.device)}</li>`
    )
    .join("");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StockPro <alerts@stockpro.app>",
      to: subs.map((s) => s.email),
      subject: `⚠️ LOW STOCK (${low.length})`,
      html: `<h2>Low stock alert</h2><ul>${html}</ul>`,
    }),
  });

  return NextResponse.json({ ok: true, low: low.length });
}
