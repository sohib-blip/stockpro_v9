import { NextResponse } from "next/server";
import {
  authorizeApiRequest,
  endAppSession,
  requireUserFromBearer,
} from "@/lib/auth";
import { PERMISSION_KEYS } from "@/lib/access-control";

async function requireActiveSession(req: Request) {
  return authorizeApiRequest(req, PERMISSION_KEYS);
}

export async function GET(req: Request) {
  const active = await requireActiveSession(req);
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.error },
      { status: active.status }
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(req: Request) {
  return GET(req);
}

export async function DELETE(req: Request) {
  const active = await requireActiveSession(req);
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.error },
      { status: active.status }
    );
  }

  const session = await requireUserFromBearer(req);
  if (!session.ok) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    await endAppSession(session.user.id, session.sessionId);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Unable to end application session" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
