import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserFromBearer, supabaseService } from "@/lib/auth";

const takeoverSchema = z.object({
  event_id: z.string().uuid(),
});

export async function PATCH(req: Request) {
  const session = await requireUserFromBearer(req);
  if (!session.ok) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const parsed = takeoverSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid connection event" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseService()
    .from("connection_events")
    .update({ takeover: true })
    .eq("id", parsed.data.event_id)
    .eq("user_id", session.user.id)
    .eq("successful", true)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Unable to update the connection event" },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Connection event not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
