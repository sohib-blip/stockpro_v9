import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts } from "pdf-lib";

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

async function qrPngBytes(text: string): Promise<Uint8Array> {
  // PNG buffer
  const buf = await QRCode.toBuffer(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 10, // un peu plus net sur ZD220
    type: "png",
  });
  return new Uint8Array(buf);
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

    const w_mm = Number(url.searchParams.get("w_mm") || "105");
    const h_mm = Number(url.searchParams.get("h_mm") || "155");

    if (!Number.isFinite(w_mm) || !Number.isFinite(h_mm) || w_mm <= 0 || h_mm <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid w_mm / h_mm" },
        { status: 400 }
      );
    }

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);
    const M = mmToPt(3);

    const supabase = sb();

    // 1) movements -> item_id + box_id
    const { data: movs, error: movErr } = await supabase
      .from("movements")
      .select("item_id, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (movErr) throw movErr;

    if (!movs || movs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No IN movements found for this batch" },
        { status: 404 }
      );
    }

    const itemIds = Array.from(
      new Set((movs as any[]).map((m) => String(m.item_id)).filter(Boolean))
    );
    const boxIds = Array.from(
      new Set((movs as any[]).map((m) => String(m.box_id)).filter(Boolean))
    );

    if (itemIds.length === 0 || boxIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Batch has no valid item_id/box_id" },
        { status: 404 }
      );
    }

    // 2) items -> imei + device_id
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("item_id, imei, device_id")
      .in("item_id", itemIds);

    if (itemsErr) throw itemsErr;

    const itemMap: Record<string, any> = {};
    for (const it of items || []) itemMap[String((it as any).item_id)] = it;

    // 3) boxes -> box_code + bin_id
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id")
      .in("id", boxIds);

    if (boxErr) throw boxErr;

    const boxMap: Record<string, any> = {};
    for (const b of boxes || []) boxMap[String((b as any).id)] = b;

    // 4) bins -> name (device)
    const binIds = Array.from(
      new Set((boxes || []).map((b: any) => String(b.bin_id)).filter(Boolean))
    );

    let binMap: Record<string, string> = {};
    if (binIds.length > 0) {
      const { data: bins, error: binsErr } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", binIds);

      if (binsErr) throw binsErr;

      for (const bn of bins || []) {
        binMap[String((bn as any).id)] = String((bn as any).name);
      }
    }

    // 5) group imeis by box_id
    const byBox: Record<
      string,
      { bin_id: string; box_code: string; imeis: string[] }
    > = {};

    for (const m of movs as any[]) {
      const box_id = String(m.box_id || "");
      const item_id = String(m.item_id || "");
      if (!box_id || !item_id) continue;

      const it = itemMap[item_id];
      const bx = boxMap[box_id];

      if (!it || !bx) continue;

      const imei = String(it.imei || "");
      if (!imei) continue;

      if (!byBox[box_id]) {
        byBox[box_id] = {
          bin_id: String(bx.bin_id || it.device_id || ""),
          box_code: String(bx.box_code || ""),
          imeis: [],
        };
      }
      byBox[box_id].imeis.push(imei);
    }

    const boxKeys = Object.keys(byBox);
    if (boxKeys.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No printable labels found (no IMEIs)" },
        { status: 404 }
      );
    }

    // ===== PDF (pdf-lib) =====
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const box_id of boxKeys) {
      const box = byBox[box_id];
      const imeis = Array.from(new Set(box.imeis)); // unique
      const qty = imeis.length;

      const deviceName = binMap[box.bin_id] || "UNKNOWN DEVICE";
      const boxCode = box.box_code || box_id;

      // QR content = imeis line by line
      const qrContent = imeis.join("\n");
      const qrBytes = await qrPngBytes(qrContent);
      const qrImg = await pdfDoc.embedPng(qrBytes);

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      // QR size + center
      const qrSize = Math.min(contentW * 0.9, contentH * 0.7);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = PAGE_H - M - qrSize;

      page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });

      // Text block (centered)
      const lineGap = 12;
      const textYStart = qrY - 18; // juste sous le QR

      const lines = [
        { text: deviceName, size: 12, bold: true },
        { text: `BOX: ${boxCode}`, size: 10, bold: false },
        { text: `QTY IMEI: ${qty}`, size: 10, bold: false },
      ];

      let y = textYStart;

      for (const ln of lines) {
        const f = ln.bold ? fontBold : font;
        const width = f.widthOfTextAtSize(ln.text, ln.size);
        const x = (PAGE_W - width) / 2;

        page.drawText(ln.text, {
          x,
          y,
          size: ln.size,
          font: f,
        });

        y -= lineGap;
      }
    }

    const pdfBytes = await pdfDoc.save();
const body = Buffer.from(pdfBytes);

return new NextResponse(body, {
  status: 200,
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="ZD220_labels_${batch_id}.pdf"`,
  },
});
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Labels generation failed" },
      { status: 500 }
    );
  }
}