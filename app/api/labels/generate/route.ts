import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const { labels, w_mm, h_mm } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ ok: false, error: "No labels provided" });
    }

    const mmToPt = (mm: number) => mm * 2.83465;

    const doc = new PDFDocument({
      size: [mmToPt(w_mm || 100), mmToPt(h_mm || 50)],
      margin: 5,
      autoFirstPage: false,
    });

    const buffers: Buffer[] = [];
    doc.on("data", buffers.push.bind(buffers));

    for (const label of labels) {
      const imeis: string[] = (label.imeis || [])
        .map((x: string) => x.replace(/\D/g, ""))
        .filter((x: string) => x.length === 15);

      for (const imei of imeis) {
        doc.addPage();

        const qr = await QRCode.toDataURL(imei);
        const base64 = qr.replace(/^data:image\/png;base64,/, "");
        const img = Buffer.from(base64, "base64");

        doc.image(img, 10, 10, {
          fit: [mmToPt(w_mm || 100) - 20, mmToPt(h_mm || 50) - 25],
          align: "center",
          valign: "center",
        });

        // ✅ SAFE FONT
        doc
          .font("Courier")
          .fontSize(10)
          .text(imei, 10, mmToPt(h_mm || 50) - 20, {
            width: mmToPt(w_mm || 100) - 20,
            align: "center",
          });
      }
    }

    doc.end();

    await new Promise((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(buffers);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="labels.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "PDF generation failed",
    });
  }
}