import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
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

async function qrPngBuffer(text: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 6,
  });

  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const w_mm = Number(url.searchParams.get("w_mm") || "100");
    const h_mm = Number(url.searchParams.get("h_mm") || "50");

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);
    const M = mmToPt(3);

    const supabase = sb();

    // 🔥 ON LIT LES IMEIS DEPUIS ITEMS (pas movements)
    const { data: items, error } = await supabase
      .from("items")
      .select("imei, box_id")
      .eq("status", "IN");

    if (error) throw error;

    if (!items || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No IN items found" },
        { status: 404 }
      );
    }

    // Grouper par box
    const byBox: Record<string, string[]> = {};

    for (const item of items as any[]) {
      const box_id = String(item.box_id);
      if (!box_id) continue;

      if (!byBox[box_id]) byBox[box_id] = [];
      byBox[box_id].push(String(item.imei));
    }

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [PAGE_W, PAGE_H],
      margin: 0,
    });

    const chunks: Uint8Array[] = [];
    doc.on("data", (c) => chunks.push(c));

    const boxIds = Object.keys(byBox);

    for (const box_id of boxIds) {
      const imeis = byBox[box_id];

      const qrContent = imeis.join("\n");
      const qrBuf = await qrPngBuffer(qrContent);

      doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      const qrSize = Math.min(contentW, contentH * 0.65);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = M;

      doc.image(qrBuf, qrX, qrY, {
        width: qrSize,
        height: qrSize,
      });

      let y = qrY + qrSize + mmToPt(2);

      doc
        .font("Courier")
        .fontSize(9)
        .text(`BOX ID: ${box_id}`, M, y, {
          width: contentW,
          align: "center",
        });

      y += mmToPt(4);

      doc
        .font("Courier")
        .fontSize(8)
        .text(`QTY IMEI: ${imeis.length}`, M, y, {
          width: contentW,
          align: "center",
        });
    }

    doc.end();

    await new Promise<void>((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=ZD220_labels.pdf`,
      },
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Generation failed" },
      { status: 500 }
    );
  }
}