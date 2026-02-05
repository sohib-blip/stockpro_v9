import { NextResponse } from "next/server";
import { z } from "zod";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";

const CreateSchema = z.object({
  device: z.string().min(1),
  min_stock: z.number().int().min(0).optional(),
});

const PatchSchema = z.object({
  device: z.string().min(1),
  min_stock: z.number().int().min(0),
});

const DeleteSchema = z.object({
  device: z.string().min(1),
});

export async function GET(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const sb = supabaseService();
  const { data, error } = await sb
    .from("device_thresholds")
    .select("device,min_stock")
    .order("device", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, devices: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const device = parsed.data.device.trim();
  const min_stock = Math.max(0, Number(parsed.data.min_stock ?? 0));

  const sb = supabaseService();
  const { error } = await sb.from("device_thresholds").upsert({ device, min_stock }, { onConflict: "device" });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const sb = supabaseService();
  const { error } = await sb
    .from("device_thresholds")
    .update({ min_stock: parsed.data.min_stock })
    .eq("device", parsed.data.device.trim());

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  const sb = supabaseService();
  const { error } = await sb.from("device_thresholds").delete().eq("device", parsed.data.device.trim());

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}