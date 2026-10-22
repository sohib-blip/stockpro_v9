import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { isPackagingContainer } from "@/lib/packaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ruleSchema = z.object({
  trigger: z.object({
    kind: z.enum(["packaging", "device"]),
    id: z.string().uuid(),
  }),
  packaging_type_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(1000),
});

const deleteSchema = z.object({ id: z.string().uuid() });

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    const service = supabaseService();
    const [rules, packaging, devices] = await Promise.all([
      service
        .from("packaging_rules")
        .select("id,trigger_packaging_type_id,trigger_device_id,packaging_type_id,quantity"),
      service.from("packaging_types").select("id,name,category"),
      service.from("bins").select("id,name").order("name"),
    ]);
    const error = rules.error || packaging.error || devices.error;
    if (error) throw error;

    const packagingById = new Map((packaging.data || []).map((row) => [row.id, row]));
    const deviceById = new Map((devices.data || []).map((row) => [row.id, row]));
    const rows = (rules.data || [])
      .map((rule) => {
        const trigger = rule.trigger_packaging_type_id
          ? packagingById.get(rule.trigger_packaging_type_id)
          : deviceById.get(rule.trigger_device_id);
        return {
          id: rule.id,
          trigger_kind: rule.trigger_packaging_type_id ? "packaging" : "device",
          trigger_id: rule.trigger_packaging_type_id || rule.trigger_device_id,
          trigger_name: String(trigger?.name ?? "Unknown"),
          packaging_type_id: rule.packaging_type_id,
          packaging_name: String(packagingById.get(rule.packaging_type_id)?.name ?? "Unknown"),
          quantity: Number(rule.quantity),
        };
      })
      .sort(
        (left, right) =>
          left.trigger_kind.localeCompare(right.trigger_kind) ||
          left.trigger_name.localeCompare(right.trigger_name) ||
          left.packaging_name.localeCompare(right.packaging_name)
      );

    return NextResponse.json({ ok: true, rules: rows, devices: devices.data || [] });
  } catch (error) {
    console.error("PACKAGING RULES LIST ERROR", error);
    return failure("Packaging rules could not be loaded", 500);
  }
}

// Saves one rule; saving the same trigger and packaging again changes its quantity.
export async function POST(req: Request) {
  try {
    const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failure("Invalid packaging rule", 400);

    const { trigger, packaging_type_id: packagingTypeId, quantity } = parsed.data;
    const service = supabaseService();
    const ids = trigger.kind === "packaging" ? [packagingTypeId, trigger.id] : [packagingTypeId];
    const { data: formats, error: formatsError } = await service
      .from("packaging_types")
      .select("id,name,category")
      .in("id", ids);
    if (formatsError) throw formatsError;

    if (!formats?.some((row) => row.id === packagingTypeId)) {
      return failure("The packaging to remove does not exist", 404);
    }
    if (trigger.kind === "packaging") {
      const triggerFormat = formats.find((row) => row.id === trigger.id);
      if (!triggerFormat) return failure("The packaging format does not exist", 404);
      if (!isPackagingContainer(triggerFormat.category)) {
        return failure("Choose a box or an envelope: a sleeve is never used on its own", 400);
      }
      if (trigger.id === packagingTypeId) {
        return failure("A packaging format cannot add itself", 400);
      }
    } else {
      const { data: device, error: deviceError } = await service
        .from("bins")
        .select("id")
        .eq("id", trigger.id)
        .maybeSingle();
      if (deviceError) throw deviceError;
      if (!device) return failure("The device bin does not exist", 404);
    }

    const triggerColumn =
      trigger.kind === "packaging" ? "trigger_packaging_type_id" : "trigger_device_id";
    const { data: existing, error: existingError } = await service
      .from("packaging_rules")
      .select("id")
      .eq(triggerColumn, trigger.id)
      .eq("packaging_type_id", packagingTypeId)
      .maybeSingle();
    if (existingError) throw existingError;

    const updatedBy = getApiIdentity(req).email;
    const { error } = existing
      ? await service
          .from("packaging_rules")
          .update({ quantity, updated_at: new Date().toISOString(), updated_by_email: updatedBy })
          .eq("id", existing.id)
      : await service.from("packaging_rules").insert({
          [triggerColumn]: trigger.id,
          packaging_type_id: packagingTypeId,
          quantity,
          updated_by_email: updatedBy,
        });
    if (error) {
      if (error.code === "23505") return failure("This rule already exists", 409);
      throw error;
    }

    return NextResponse.json({ ok: true, updated: Boolean(existing) });
  } catch (error) {
    console.error("PACKAGING RULE SAVE ERROR", error);
    return failure("Packaging rule could not be saved", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failure("Invalid packaging rule", 400);

    const { error } = await supabaseService()
      .from("packaging_rules")
      .delete()
      .eq("id", parsed.data.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PACKAGING RULE DELETE ERROR", error);
    return failure("Packaging rule could not be deleted", 500);
  }
}
