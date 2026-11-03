import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { authorizeApiRequest, supabaseService } from "@/lib/auth";
import { securityAlertAudience } from "@/lib/security-alert-recipients";
import {
  checkSecurityUpdates,
  productionPackageVersions,
} from "@/lib/security-updates";
// Bundled at build time: the check always describes the deployed versions, so
// the alert disappears by itself once an update is deployed.
import lockfile from "@/package-lock.json";

export const dynamic = "force-dynamic";

const ONE_DAY_SECONDS = 24 * 60 * 60;

const installed = productionPackageVersions(lockfile);
const installedHash = createHash("sha256")
  .update(JSON.stringify(installed))
  .digest("hex")
  .slice(0, 16);

// npm is asked at most once a day per deployed set of versions. A failed check
// throws, so it is not cached and the next visit tries again.
const cachedSecurityUpdates = unstable_cache(
  () => checkSecurityUpdates(installed),
  ["admin-security-updates", installedHash],
  { revalidate: ONE_DAY_SECONDS }
);

export async function GET(req: Request) {
  const admin = await authorizeApiRequest(req, ["can_admin"]);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  // Only the designated IT contacts see the alert (every admin while none is
  // designated). Other admins get no report and npm is not contacted. If the
  // list cannot be read, administrators still see the alert rather than nobody.
  let audience;
  try {
    audience = await securityAlertAudience(supabaseService(), admin.user.id);
  } catch (error) {
    console.warn("Security alert IT contacts unavailable", error);
    audience = { visible: true, itContactMissing: false };
  }
  if (!audience.visible) {
    return NextResponse.json({ ok: true, status: "not_recipient" });
  }

  try {
    const report = await cachedSecurityUpdates();
    return NextResponse.json({
      ok: true,
      status: "checked",
      it_contact_missing: audience.itContactMissing,
      ...report,
    });
  } catch (error) {
    console.warn("Security update check unavailable", error);
    return NextResponse.json({ ok: true, status: "unavailable" });
  }
}
