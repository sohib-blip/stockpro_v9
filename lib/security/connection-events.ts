import { isIP } from "node:net";
import { supabaseService } from "../auth";
import { describeUserAgent } from "./user-agent";

export type ConnectionMetadata = {
  ip_address: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  user_agent: string | null;
  device: string;
  browser: string;
  operating_system: string;
};

type RecordConnectionEventInput = ConnectionMetadata & {
  user_id: string | null;
  email: string;
  successful: boolean;
  failure_reason?: string | null;
  auth_session_id?: string | null;
};

function cleanHeader(value: string | null, maxLength: number) {
  const cleaned = value?.trim().slice(0, maxLength);
  return cleaned || null;
}

function decodeLocationHeader(value: string | null) {
  if (!value) return null;
  try {
    return cleanHeader(decodeURIComponent(value), 120);
  } catch {
    return cleanHeader(value, 120);
  }
}

function clientIp(req: Request) {
  const raw =
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip");
  const candidate = raw?.split(",")[0]?.trim() || "";
  return isIP(candidate) ? candidate : null;
}

export function connectionMetadata(req: Request): ConnectionMetadata {
  const userAgent = cleanHeader(req.headers.get("user-agent"), 600);
  const described = describeUserAgent(userAgent);
  const country = cleanHeader(req.headers.get("x-vercel-ip-country"), 2);

  return {
    ip_address: clientIp(req),
    country_code: country?.toUpperCase() || null,
    region: cleanHeader(req.headers.get("x-vercel-ip-country-region"), 80),
    city: decodeLocationHeader(req.headers.get("x-vercel-ip-city")),
    user_agent: userAgent,
    device: described.device,
    browser: described.browser,
    operating_system: described.operatingSystem,
  };
}

export async function recordConnectionEvent(input: RecordConnectionEventInput) {
  const supabase = supabaseService();

  const { data, error } = await supabase
    .from("connection_events")
    .insert({
      ...input,
      email: input.email.trim().toLowerCase().slice(0, 320),
      failure_reason: input.failure_reason?.slice(0, 80) || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Unable to record connection event", error.message);
    return null;
  }

  return data.id as string;
}
