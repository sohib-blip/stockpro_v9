import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAnon } from "@/lib/auth";
import {
  connectionMetadata,
  recordConnectionEvent,
} from "@/lib/security/connection-events";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(4096),
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeFailureReason(error: { code?: string; status?: number }) {
  if (error.status === 429 || error.code?.includes("rate_limit")) {
    return "rate_limited";
  }
  if (error.code === "email_not_confirmed") return "email_not_confirmed";
  return "invalid_credentials";
}

export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
      { ok: false, error: "Please enter a valid email and password" },
      400
    );
  }

  const email = parsed.data.email.toLowerCase();
  const metadata = connectionMetadata(req);
  const supabase = supabaseAnon();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (error || !data.session || !data.user) {
    const reason = safeFailureReason(error || {});
    await recordConnectionEvent({
      ...metadata,
      user_id: null,
      email,
      successful: false,
      failure_reason: reason,
    });

    return noStoreJson(
      {
        ok: false,
        error:
          reason === "rate_limited"
            ? "Too many login attempts. Please try again later."
            : "Incorrect email or password",
      },
      reason === "rate_limited" ? 429 : 401
    );
  }

  const eventId = await recordConnectionEvent({
    ...metadata,
    user_id: data.user.id,
    email: data.user.email || email,
    successful: true,
  });

  return noStoreJson({
    ok: true,
    event_id: eventId,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}
