{\rtf1\ansi\ansicpg1252\cocoartf2867
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import \{ NextResponse \} from "next/server";\
import \{ getPermissions, requireUserFromBearer, supabaseService \} from "@/lib/auth";\
import \{ z \} from "zod";\
\
const CreateSchema = z.object(\{\
  device: z.string().min(1),\
  min_stock: z.number().int().min(0).optional(),\
\});\
\
const PatchSchema = z.object(\{\
  device: z.string().min(1),\
  min_stock: z.number().int().min(0),\
\});\
\
const DeleteSchema = z.object(\{\
  device: z.string().min(1),\
\});\
\
export async function GET(req: Request) \{\
  const auth = await requireUserFromBearer(req);\
  if (!auth.ok) return NextResponse.json(\{ ok: false, error: auth.error \}, \{ status: 401 \});\
\
  const perms = await getPermissions(auth.user.id);\
  if (!perms.can_admin) return NextResponse.json(\{ ok: false, error: "Forbidden" \}, \{ status: 403 \});\
\
  const sb = supabaseService();\
  const \{ data, error \} = await sb\
    .from("device_thresholds")\
    .select("device,min_stock")\
    .order("device", \{ ascending: true \});\
\
  if (error) return NextResponse.json(\{ ok: false, error: error.message \}, \{ status: 500 \});\
  return NextResponse.json(\{ ok: true, devices: data || [] \});\
\}\
\
export async function POST(req: Request) \{\
  const auth = await requireUserFromBearer(req);\
  if (!auth.ok) return NextResponse.json(\{ ok: false, error: auth.error \}, \{ status: 401 \});\
\
  const perms = await getPermissions(auth.user.id);\
  if (!perms.can_admin) return NextResponse.json(\{ ok: false, error: "Forbidden" \}, \{ status: 403 \});\
\
  const body = await req.json().catch(() => null);\
  const parsed = CreateSchema.safeParse(body);\
  if (!parsed.success) return NextResponse.json(\{ ok: false, error: "Invalid payload" \}, \{ status: 400 \});\
\
  const device = parsed.data.device.trim();\
  const min_stock = Math.max(0, Number(parsed.data.min_stock ?? 0));\
\
  const sb = supabaseService();\
  const \{ error \} = await sb\
    .from("device_thresholds")\
    .upsert(\{ device, min_stock \}, \{ onConflict: "device" \});\
\
  if (error) return NextResponse.json(\{ ok: false, error: error.message \}, \{ status: 500 \});\
  return NextResponse.json(\{ ok: true \});\
\}\
\
export async function PATCH(req: Request) \{\
  const auth = await requireUserFromBearer(req);\
  if (!auth.ok) return NextResponse.json(\{ ok: false, error: auth.error \}, \{ status: 401 \});\
\
  const perms = await getPermissions(auth.user.id);\
  if (!perms.can_admin) return NextResponse.json(\{ ok: false, error: "Forbidden" \}, \{ status: 403 \});\
\
  const body = await req.json().catch(() => null);\
  const parsed = PatchSchema.safeParse(body);\
  if (!parsed.success) return NextResponse.json(\{ ok: false, error: "Invalid payload" \}, \{ status: 400 \});\
\
  const sb = supabaseService();\
  const \{ error \} = await sb\
    .from("device_thresholds")\
    .update(\{ min_stock: parsed.data.min_stock \})\
    .eq("device", parsed.data.device.trim());\
\
  if (error) return NextResponse.json(\{ ok: false, error: error.message \}, \{ status: 500 \});\
  return NextResponse.json(\{ ok: true \});\
\}\
\
export async function DELETE(req: Request) \{\
  const auth = await requireUserFromBearer(req);\
  if (!auth.ok) return NextResponse.json(\{ ok: false, error: auth.error \}, \{ status: 401 \});\
\
  const perms = await getPermissions(auth.user.id);\
  if (!perms.can_admin) return NextResponse.json(\{ ok: false, error: "Forbidden" \}, \{ status: 403 \});\
\
  const body = await req.json().catch(() => null);\
  const parsed = DeleteSchema.safeParse(body);\
  if (!parsed.success) return NextResponse.json(\{ ok: false, error: "Invalid payload" \}, \{ status: 400 \});\
\
  const sb = supabaseService();\
  const \{ error \} = await sb\
    .from("device_thresholds")\
    .delete()\
    .eq("device", parsed.data.device.trim());\
\
  if (error) return NextResponse.json(\{ ok: false, error: error.message \}, \{ status: 500 \});\
  return NextResponse.json(\{ ok: true \});\
\}}