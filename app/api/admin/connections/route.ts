import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest, supabaseService } from "@/lib/auth";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  days: z.coerce.number().int().refine((value) => [7, 30, 90].includes(value)).default(30),
  status: z.enum(["all", "successful", "failed", "takeover"]).default("all"),
  search: z.string().trim().max(120).default(""),
});

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const admin = await authorizeApiRequest(req, ["can_admin"]);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    page: url.searchParams.get("page") || undefined,
    days: url.searchParams.get("days") || undefined,
    status: url.searchParams.get("status") || undefined,
    search: url.searchParams.get("search") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid connection log filters" },
      { status: 400 }
    );
  }

  const { page, days, status, search } = parsed.data;
  const from = (page - 1) * PAGE_SIZE;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = supabaseService();

  let eventsQuery = supabase
    .from("connection_events")
    .select(
      "id,user_id,email,successful,failure_reason,takeover,ip_address,country_code,region,city,device,browser,operating_system,created_at",
      { count: "exact" }
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (status === "successful") eventsQuery = eventsQuery.eq("successful", true);
  if (status === "failed") eventsQuery = eventsQuery.eq("successful", false);
  if (status === "takeover") eventsQuery = eventsQuery.eq("takeover", true);
  if (search) {
    const safeSearch = search.replace(/[%_*,()]/g, "");
    if (safeSearch) eventsQuery = eventsQuery.ilike("email", `%${safeSearch}%`);
  }

  const summaryQuery = (field?: "successful" | "takeover", value = true) => {
    let query = supabase
      .from("connection_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (field) query = query.eq(field, value);
    return query;
  };

  const [events, attempts, successful, failed, takeovers] = await Promise.all([
    eventsQuery.range(from, from + PAGE_SIZE - 1),
    summaryQuery(),
    summaryQuery("successful", true),
    summaryQuery("successful", false),
    summaryQuery("takeover", true),
  ]);

  const error =
    events.error || attempts.error || successful.error || failed.error || takeovers.error;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Unable to load connection events" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      events: events.data ?? [],
      page,
      page_size: PAGE_SIZE,
      total: events.count ?? 0,
      summary: {
        attempts: attempts.count ?? 0,
        successful: successful.count ?? 0,
        failed: failed.count ?? 0,
        takeovers: takeovers.count ?? 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
