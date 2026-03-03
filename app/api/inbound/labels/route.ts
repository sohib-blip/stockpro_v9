import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

function mmToPt(mm: number) {
  return (mm / 25.4) * 72;
}

async function qrBuffer(text: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(text, { margin: 1, scale: 6 });
  const base64 = dataUrl.split(",")[1];
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id");

    const w_mm = Number(url.searchParams.get("w_mm") || "105");
    const h_mm = Number(url.searchParams.get("h_mm") || "155");

    if (!batch_id || batch_id === "null" || batch_id === "undefined") {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    const supabase = sb();

    // 1) movements (NO JOIN)
    const { data: movs, error: movErr } = await supabase
      .from("movements")
      .select("box_id, imei")
      .eq("batch_id", batch_id)
      .eq("type", "IN");

    if (movErr) throw movErr;

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No movements found" }, { status: 404 });
    }

    const boxIds = Array.from(new Set(movs.map((m: any) => String(m.box_id)).filter(Boolean)));

    // 2) boxes
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id")
      .in("id", boxIds);

    if (boxErr) throw boxErr;

    const boxMap: Record<string, any> = {};
    for (const b of boxes || []) boxMap[String((b as any).id)] = b;

    const binIds = Array.from(
      new Set((boxes || []).map((b: any) => String(b.bin_id)).filter(Boolean))
    );

    // 3) bins
    const { data: bins, error: binErr } = await supabase
      .from("bins")
      .select("id, name")
      .in("id", binIds);

    if (binErr) throw binErr;

    const binMap: Record<string, string> = {};
    for (const b of bins || []) binMap[String((b as any).id)] = String((b as any).name);

    // 4) group by box_id
    const grouped: Record<string, { device: string; box: string; imeis: string[] }> = {};

    for (const m of movs as any[]) {
      const boxId = String(m.box_id || "");
      if (!boxId) continue;

      const bx = boxMap[boxId];
      if (!bx) continue;

      if (!grouped[boxId]) {
        grouped[boxId] = {
          device: bx?.bin_id ? (binMap[String(bx.bin_id)] || "UNKNOWN") : "UNKNOWN",
          box: bx?.box_code || "",
          imeis: [],
        };
      }

      if (m.imei) grouped[boxId].imeis.push(String(m.imei));
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);

    for (const boxId of Object.keys(grouped)) {
      const data = grouped[boxId];
      const imeis = data.imeis.filter(Boolean);

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      const qrContent = imeis.join("\n");
      const qrBytes = await qrBuffer(qrContent);
      const qrImage = await pdfDoc.embedPng(qrBytes);

      const qrSize = PAGE_W * 0.65;

      page.drawImage(qrImage, {
        x: (PAGE_W - qrSize) / 2,
        y: PAGE_H - qrSize - 40,
        width: qrSize,
        height: qrSize,
      });

      const centerText = (text: string, y: number, size: number) => {
        const textWidth = font.widthOfTextAtSize(text, size);
        const x = (PAGE_W - textWidth) / 2;
        page.drawText(text, { x, y, size, font });
      };

      let yStart = PAGE_H - qrSize - 70;

      centerText(data.device || "UNKNOWN", yStart, 18);
      yStart -= 25;

      centerText(`BOX: ${data.box}`, yStart, 14);
      yStart -= 20;

      centerText(`QTY IMEI: ${imeis.length}`, yStart, 14);
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=labels_${batch_id}.pdf`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Label generation failed" },
      { status: 500 }
    );
  }
}