import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { isMissingDispatchCatalogTable } from "@/app/api/dispatch-planning/_server";
import {
  findDispatchCatalogConflict,
  isRequiredDispatchItem,
  parseDispatchCatalogItemInput,
  requiredItemChangeError,
  type DispatchCatalogRecord,
} from "@/lib/dispatch-catalog-input";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 16 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS =
  "id,name,aliases,length_cm,width_cm,height_cm,active,updated_at,updated_by_email";

type CatalogRow = {
  id: string;
  name: string;
  aliases: string[] | null;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  active: boolean;
  updated_at: string | null;
  updated_by_email: string | null;
};

function toItem(row: CatalogRow) {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases || [],
    lengthCm: Number(row.length_cm),
    widthCm: Number(row.width_cm),
    heightCm: Number(row.height_cm),
    active: row.active === true,
    required: isRequiredDispatchItem(row.name),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_email,
  };
}

function toRecord(row: CatalogRow): DispatchCatalogRecord {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases || [],
    active: row.active === true,
  };
}

function reply(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function failure(error: unknown) {
  if (isMissingDispatchCatalogTable(error)) {
    return reply(
      503,
      "The dispatch item list is not installed yet. Apply the latest database migration."
    );
  }
  if ((error as { code?: unknown } | null)?.code === "23505") {
    return reply(409, "An item with this name already exists");
  }
  console.error("DISPATCH CATALOG ERROR", error);
  return reply(500, "Dispatch items could not be saved");
}

async function loadRows() {
  const { data, error } = await supabaseService()
    .from("dispatch_catalog_items")
    .select(COLUMNS)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []) as CatalogRow[];
}

async function readBody(req: Request) {
  try {
    return { body: await readJsonBodyWithinLimit(req, MAX_BODY_BYTES) };
  } catch (error) {
    return {
      response:
        error instanceof PayloadTooLargeError
          ? reply(413, "Dispatch item request is too large")
          : reply(400, "Invalid dispatch item request"),
    };
  }
}

export async function GET() {
  try {
    const rows = await loadRows();
    return NextResponse.json(
      { ok: true, items: rows.map(toItem) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  const { body, response } = await readBody(req);
  if (response) return response;

  const input = parseDispatchCatalogItemInput(body);
  if (!input.ok) return reply(400, input.error);

  try {
    const rows = await loadRows();
    const conflict = findDispatchCatalogConflict(input.value, rows.map(toRecord));
    if (conflict) return reply(409, conflict);

    const { data, error } = await supabaseService()
      .from("dispatch_catalog_items")
      .insert({
        name: input.value.name,
        aliases: input.value.aliases,
        length_cm: input.value.lengthCm,
        width_cm: input.value.widthCm,
        height_cm: input.value.heightCm,
        active: true,
        updated_by_email: getApiIdentity(req).email,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, item: toItem(data as CatalogRow) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

// Updates an item, toggles it ({ id, active }) or links one more Kinesis label
// to it ({ id, add_alias }).
export async function PATCH(req: Request) {
  const { body, response } = await readBody(req);
  if (response) return response;

  const value = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  if (!UUID_PATTERN.test(id)) return reply(400, "A valid dispatch item is required");

  try {
    const rows = await loadRows();
    const current = rows.find((row) => row.id === id);
    if (!current) return reply(404, "This dispatch item no longer exists");

    const togglingOnly =
      typeof value.active === "boolean" &&
      value.name === undefined &&
      value.add_alias === undefined;

    if (togglingOnly) {
      const active = value.active as boolean;
      const requiredError = requiredItemChangeError(toRecord(current), { active });
      if (requiredError) return reply(409, requiredError);

      const { data, error } = await supabaseService()
        .from("dispatch_catalog_items")
        .update({
          active,
          updated_at: new Date().toISOString(),
          updated_by_email: getApiIdentity(req).email,
        })
        .eq("id", id)
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, item: toItem(data as CatalogRow) });
    }

    const candidate =
      typeof value.add_alias === "string"
        ? {
            name: current.name,
            aliases: [...(current.aliases || []), value.add_alias],
            lengthCm: current.length_cm,
            widthCm: current.width_cm,
            heightCm: current.height_cm,
          }
        : value;
    const input = parseDispatchCatalogItemInput(candidate);
    if (!input.ok) return reply(400, input.error);

    const requiredError = requiredItemChangeError(toRecord(current), {
      name: input.value.name,
    });
    if (requiredError) return reply(409, requiredError);

    const conflict = findDispatchCatalogConflict(
      { id, ...input.value },
      rows.map(toRecord)
    );
    if (conflict) return reply(409, conflict);

    const { data, error } = await supabaseService()
      .from("dispatch_catalog_items")
      .update({
        name: input.value.name,
        aliases: input.value.aliases,
        length_cm: input.value.lengthCm,
        width_cm: input.value.widthCm,
        height_cm: input.value.heightCm,
        updated_at: new Date().toISOString(),
        updated_by_email: getApiIdentity(req).email,
      })
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, item: toItem(data as CatalogRow) });
  } catch (error) {
    return failure(error);
  }
}
