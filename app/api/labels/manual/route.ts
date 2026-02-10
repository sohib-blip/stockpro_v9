import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Force Node runtime (pdf-lib + qrcode OK)
export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function canonicalize(input: string) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function cleanImeiLines(imeis: string[]) {
  const cleaned = imeis
    .map((x) => String(x ?? "").replace(/\D/g, ""))
    .filter((x) => x.length === 15);

  // dedup
  return Array.from(new Set(cleaned));
}

async function makeOneLabelPdf(opts: {
  device: string;
  box_no: string;
  imeis: string[];
}) {
  const { device, box_no, imeis } = opts;

  // QR = IMEI only, 1 per line
  const qrData = imeis.join("\n");

  // QR as PNG data URL
  const qrDataUrl = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });

  const pdf = await PDFDocument.create();

  /**
   * Label format (ZD220-ish):
   * On part sur ~ 60mm x 40mm (en points PDF)
   * 1 inch = 72pt
   * 60mm = 170.08pt
   * 40mm = 113.39pt
   */
  const mmToPt = (mm: number) => (mm * 72) / 25.4;
  const pageW = mmToPt(60);
  const pageH = mmToPt(40);

  const page = pdf.addPage([pageW, pageH]);

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Embed QR PNG
  const pngBytes = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const qrImg = await pdf.embedPng(pngBytes);

  // Layout
  const padding = mmToPt(3);
  const qrSize = mmToPt(26); // ~26mm
  const qrX = padding;
  const qrY = pageH - padding - qrSize;

  page.drawImage(qrImg, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });

  // Text block (right side)
  const textX = qrX + qrSize + mmToPt(3);
  let y = pageH - padding - mmToPt(3);

  // Device
  page.drawText(String(device), {
    x: textX,
    y: y - mmToPt(6),
    size: 12,
    font,
  });

  // Box
  page.drawText(`Box: ${String(box_no)}`, {
    x: textX,
    y: y - mmToPt(13),
    size: 10,
    font,
  });

  // Qty
  page.drawText(`${imeis.length} IMEI`, {
    x: textX,
    y: y - mmToPt(20),
    size: 10,
    font,
  });

  const pdfBytes = await pdf.save(); // Uint8Array
  return pdfBytes;
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Missing service role key" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);

    const device = String(body?.device ?? "").trim();
    const box_no = String(body?.box_no ?? "").trim();
    const mode = String(body?.mode ?? "print").trim(); // "print" | "import" | "both"
    const imeis = Array.isArray(body?.imeis) ? body.imeis : [];

    if (!device || !box_no || !Array.isArray(imeis)) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload (device, box_no, imeis[] required)" },
        { status: 400 }
      );
    }

    // ✅ check device exists in DB (you wanted block)
    const deviceCanon = canonicalize(device);
    const { data: devRow, error: devErr } = await admin
      .from("devices")
      .select("canonical_name, device, active")
      .eq("canonical_name", deviceCanon)
      .maybeSingle();

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    if (!devRow || devRow.active === false) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Device not found (or inactive). Add/activate it in Admin > Devices, then retry.",
          unknown_device: device,
          expected_canonical: deviceCanon,
        },
        { status: 400 }
      );
    }

    const deviceDisplay = String(devRow.device || devRow.canonical_name);

    const cleanImeis = cleanImeiLines(imeis);
    if (cleanImeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid IMEI (need 15 digits). One per line." },
        { status: 400 }
      );
    }

    // optional DB import
    let box_id: string | null = null;

    if (mode === "import" || mode === "both") {
      // insert box
      const insBox = await admin
        .from("boxes")
        .insert({
          device: deviceDisplay,
          box_no,
          master_box_no: box_no,
          location: "00",
          status: "IN_STOCK",
        } as any)
        .select("box_id")
        .maybeSingle();

      // if duplicate etc, try fetch existing
      if (insBox.error) {
        const msg = String(insBox.error.message || "").toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          const existing = await admin
            .from("boxes")
            .select("box_id")
            .eq("device", deviceDisplay)
            .eq("master_box_no", box_no)
            .maybeSingle();
          box_id = existing.data?.box_id ? String(existing.data.box_id) : null;
        } else {
          return NextResponse.json(
            { ok: false, error: `Box insert failed: ${insBox.error.message}` },
            { status: 400 }
          );
        }
      } else {
        box_id = insBox.data?.box_id ? String(insBox.data.box_id) : null;
      }

      if (box_id) {
        // insert imeis
        const itemsRows = cleanImeis.map((imei) => ({
          box_id,
          imei,
          status: "IN_STOCK",
        }));

        const insItems = await admin.from("items").insert(itemsRows as any);
        if (insItems.error) {
          // don't hard-fail printing, but tell the user
          return NextResponse.json(
            { ok: false, error: `Items insert failed: ${insItems.error.message}` },
            { status: 400 }
          );
        }
      }
    }

    // Always generate PDF (print or both)
    const pdfBytes = await makeOneLabelPdf({
      device: deviceDisplay,
      box_no,
      imeis: cleanImeis,
    });

    // ✅ Return PDF binary (download in browser)
    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="label-${deviceDisplay}-${box_no}.pdf"`,
        "Cache-Control": "no-store",
        "X-Box-Id": box_id || "",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}