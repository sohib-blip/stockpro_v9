import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserFromBearer, takeOverAppSession } from "@/lib/auth";

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

  let takenOver = false;
  try {
    takenOver = await takeOverAppSession(
      session.user.id,
      session.sessionId,
      parsed.data.event_id
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to take over the application session" },
      { status: 500 }
    );
  }

  if (!takenOver) {
    return NextResponse.json(
      { ok: false, error: "Session takeover request is invalid or expired" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
