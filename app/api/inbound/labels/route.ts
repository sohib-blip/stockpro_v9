import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function chunkArray<T>(arr: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
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
      return NextResponse.json(
        { ok: false, error: "batch_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // 1) Get ALL items for this import
    const allItems: any[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from("items")
        .select("box_id, imei")
        .eq("import_id", batch_id)
        .order("box_id", { ascending: true })
        .range(from, to);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allItems.push(...data);

      if (data.length < pageSize) break;
      page++;
    }

    if (allItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No items found for this import" },
        { status: 404 }
      );
    }

    // 2) Group by box_id
    const grouped: Record<
      string,
      {
        boxId: string;
        box: string;
        device: string;
        qty: number;
        imeis: string[];
      }
    > = {};

    for (const item of allItems) {
      const boxId = String(item.box_id || "");
      if (!boxId) continue;

      if (!grouped[boxId]) {
        grouped[boxId] = {
          boxId,
          box: `BOX ${boxId.slice(0, 8)}`,
          device: "UNKNOWN",
          qty: 0,
          imeis: [],
        };
      }

      if (item.imei) {
        grouped[boxId].qty += 1;
        grouped[boxId].imeis.push(String(item.imei));
      }
    }

    const boxIds = Object.keys(grouped);

    // 3) Fetch boxes
    const allBoxes: any[] = [];

    for (const chunk of chunkArray(boxIds, 500)) {
      const { data, error } = await supabase
        .from("boxes")
        .select("id, box_code, bin_id")
        .in("id", chunk);

      if (error) throw error;
      allBoxes.push(...(data || []));
    }

    const boxMap = new Map(allBoxes.map((b: any) => [String(b.id), b]));

    const binIds = Array.from(
      new Set(allBoxes.map((b: any) => String(b.bin_id)).filter(Boolean))
    );

    // 4) Fetch bins/devices
    const allBins: any[] = [];

    for (const chunk of chunkArray(binIds, 500)) {
      const { data, error } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", chunk);

      if (error) throw error;
      allBins.push(...(data || []));
    }

    const binMap = new Map(
      allBins.map((b: any) => [String(b.id), String(b.name)])
    );

    // 5) Complete label data
    for (const boxId of boxIds) {
      const box = boxMap.get(boxId);

      if (box) {
        grouped[boxId].box = box.box_code || `BOX ${boxId.slice(0, 8)}`;
        grouped[boxId].device = box.bin_id
          ? binMap.get(String(box.bin_id)) || "UNKNOWN"
          : "UNKNOWN";
      }
    }

    const labelRows = Object.values(grouped)
      .filter((row) => row.qty > 0)
      .sort((a, b) =>
        a.box.localeCompare(b.box, undefined, { numeric: true })
      );

    // 6) Create PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);

    for (const data of labelRows) {
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      // QR contains all IMEIs of this box, one IMEI per line
      const qrContent = data.imeis.join("\n");
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

      centerText(`QTY IMEI: ${data.qty}`, yStart, 14);
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=labels_${batch_id}.pdf`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Label generation failed" },
      { status: 500 }
    );
  }
}