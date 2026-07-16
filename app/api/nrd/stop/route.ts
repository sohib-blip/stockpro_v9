import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUserEmail } from "@/lib/api-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: Request) {
  try {
    const supabase = sb();

    const body = await req.json();

    const { user_email: requestedEmail, ended_at } = body;
    const userEmail = resolveApiUserEmail(req, requestedEmail);

    /*
     * Recherche du NRD actuellement actif.
     */
    const { data: active, error: activeError } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeError) {
      console.error("NRD ACTIVE READ ERROR:", activeError);
      throw activeError;
    }

    if (!active) {
      return NextResponse.json(
        {
          ok: false,
          error: "No active NRD found",
        },
        {
          status: 404,
        }
      );
    }

    const startedAt = new Date(active.started_at);

    /*
     * Si le frontend envoie ended_at, on utilise l’heure corrigée.
     * Sinon, on utilise l’heure actuelle.
     */
    const selectedEndDate = ended_at
      ? new Date(ended_at)
      : new Date();

    if (Number.isNaN(selectedEndDate.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid end date",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * La fin ne peut pas être antérieure au début.
     */
    if (selectedEndDate.getTime() < startedAt.getTime()) {
      return NextResponse.json(
        {
          ok: false,
          error: "End time cannot be before start time",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * On n’autorise pas une heure de fin dans le futur.
     * Petite marge de 60 secondes pour éviter un souci de décalage.
     */
    if (selectedEndDate.getTime() > Date.now() + 60_000) {
      return NextResponse.json(
        {
          ok: false,
          error: "End time cannot be in the future",
        },
        {
          status: 400,
        }
      );
    }

    const durationMinutes = Math.max(
      1,
      Math.round(
        (selectedEndDate.getTime() - startedAt.getTime()) / 60_000
      )
    );

    const { data: updatedLog, error: updateError } = await supabase
      .from("nrd_time_logs")
      .update({
        ended_at: selectedEndDate.toISOString(),
        duration_minutes: durationMinutes,
      })
      .eq("id", active.id)
      .is("ended_at", null)
      .select("*")
      .single();

    if (updateError) {
      console.error("NRD STOP UPDATE ERROR:", updateError);
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
      row: updatedLog,
    });
  } catch (error: unknown) {
    console.error("NRD STOP FAILED:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Stop NRD failed";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
