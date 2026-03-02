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

    if (!batch_id) {
      return NextResponse.json(
        { ok: false, error: "batch_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    const { data: movs } = await supabase
      .from("movements")
      .select("item_id, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (!movs || movs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No movements found" },
        { status: 404 }
      );
    }

    const itemIds = movs.map((m: any) => m.item_id);
    const boxIds = movs.map((m: any) => m.box_id);

    const { data: items } = await supabase
      .from("items")
      .select("item_id, imei, device_id")
      .in("item_id", itemIds);

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id")
      .in("id", boxIds);

    const boxMap: Record<string, any> = {};
    for (const b of boxes || []) {
      boxMap[String((b as any).id)] = b;
    }

    const binIds = boxes?.map((b: any) => b.bin_id) || [];

    const { data: bins } = await supabase
      .from("bins")
      .select("id, name")
      .in("id", binIds);

    const binMap: Record<string, string> = {};
    for (const b of bins || []) {
      binMap[String((b as any).id)] = String((b as any).name);
    }

    const grouped: Record<
      string,
      { device: string; box: string; imeis: string[] }
    > = {};

    for (const m of movs as any[]) {
      const it = items?.find((i: any) => i.item_id === m.item_id);
      const bx = boxMap[String(m.box_id)];

      if (!it || !bx) continue;

      if (!grouped[m.box_id]) {
        grouped[m.box_id] = {
          device: binMap[String(bx.bin_id)] || "UNKNOWN",
          box: bx.box_code || "",
          imeis: [],
        };
      }

      grouped[m.box_id].imeis.push(it.imei);
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = mmToPt(105);
    const PAGE_H = mmToPt(155);

    for (const boxId of Object.keys(grouped)) {
      const data = grouped[boxId];
      const imeis = data.imeis;

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      const qrContent = imeis.join("\n");
      const qrBytes = await qrBuffer(qrContent);
      const qrImage = await pdfDoc.embedPng(qrBytes);

      const qrSize = PAGE_W * 0.65;

      // QR centré
      page.drawImage(qrImage, {
        x: (PAGE_W - qrSize) / 2,
        y: PAGE_H - qrSize - 40,
        width: qrSize,
        height: qrSize,
      });

      // Texte centré
      const centerText = (text: string, y: number, size: number) => {
        const textWidth = font.widthOfTextAtSize(text, size);
        const x = (PAGE_W - textWidth) / 2;
        page.drawText(text, { x, y, size, font });
      };

      let yStart = PAGE_H - qrSize - 70;

      centerText(data.device, yStart, 18);
      yStart -= 25;

      centerText(`BOX ID: ${data.box}`, yStart, 14);
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