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
      return NextResponse.json(
        { ok: false, error: "batch_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // ✅ IMPORTANT: on prend l’IMEI depuis movements.imei (plus de join items)
    const { data: movs, error: movErr } = await supabase
      .from("movements")
      .select(
        `
        box_id,
        imei,
        boxes ( box_code, floor, bins ( name ) )
      `
      )
      .eq("batch_id", batch_id)
      .eq("type", "IN");

    if (movErr) throw movErr;

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No data" }, { status: 404 });
    }

    const grouped: Record<
      string,
      { device: string; box: string; imeis: string[] }
    > = {};

    for (const m of movs as any[]) {
      const boxId = String(m.box_id ?? "");
      if (!boxId) continue;

      if (!grouped[boxId]) {
        grouped[boxId] = {
          device: m.boxes?.bins?.name || "UNKNOWN",
          box: m.boxes?.box_code || "",
          imeis: [],
        };
      }

      const im = String(m.imei ?? "").replace(/\D/g, "");
      if (im.length === 15) grouped[boxId].imeis.push(im);
    }

    // si jamais tout est vide côté imei (ex: mouvements anciens sans colonne imei)
    const totalImeis = Object.values(grouped).reduce((a, g) => a + g.imeis.length, 0);
    if (totalImeis === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No IMEIs found in movements.imei for this batch. (Old data?)",
        },
        { status: 404 }
      );
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const PAGE_W = mmToPt(105);
    const PAGE_H = mmToPt(155);

    for (const key of Object.keys(grouped)) {
      const data = grouped[key];
      const imeis = data.imeis;

      if (imeis.length === 0) continue;

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