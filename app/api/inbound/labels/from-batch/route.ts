import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
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

    if (!batch_id || batch_id === "null" || batch_id === "undefined") {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    const supabase = sb();

    const { data: movs } = await supabase
      .from("movements")
      .select(`
        box_id,
        items ( imei ),
        boxes ( box_code, bins ( name ) )
      `)
      .eq("batch_id", batch_id)
      .eq("type", "IN");

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No data" }, { status: 404 });
    }

    const grouped: Record<string, any> = {};

    for (const m of movs as any[]) {
      const boxId = m.box_id;
      if (!grouped[boxId]) {
        grouped[boxId] = {
          device: m.boxes?.bins?.name || "",
          box: m.boxes?.box_code || "",
          imeis: [],
        };
      }
      grouped[boxId].imeis.push(m.items?.imei);
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const PAGE_W = mmToPt(105);
    const PAGE_H = mmToPt(155);

    for (const key of Object.keys(grouped)) {
      const data = grouped[key];
      const imeis = data.imeis.filter(Boolean);

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      const qrContent = imeis.join("\n");
      const qrBytes = await qrBuffer(qrContent);
      const qrImage = await pdfDoc.embedPng(qrBytes);

      const qrSize = PAGE_H * 0.6;
      page.drawImage(qrImage, {
        x: (PAGE_W - qrSize) / 2,
        y: PAGE_H - qrSize - 10,
        width: qrSize,
        height: qrSize,
      });

      let y = PAGE_H - qrSize - 25;

      page.drawText(data.device, {
        x: 20,
        y,
        size: 12,
        font,
      });

      y -= 14;

      page.drawText(`BOX: ${data.box}`, {
        x: 20,
        y,
        size: 10,
        font,
      });

      y -= 14;

      page.drawText(`QTY IMEI: ${imeis.length}`, {
        x: 20,
        y,
        size: 10,
        font,
      });
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