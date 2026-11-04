// Public address of this StockPro environment, used to build links sent by
// email (invitations). It must not depend on the Host header of a request.

let warnedMissingSiteUrl = false;

export function configuredSiteOrigin(
  value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Absolute link to `path` on the configured site. Falls back to the request
 * address (previous behaviour) with one server warning when
 * NEXT_PUBLIC_SITE_URL is missing or invalid.
 */
export function siteLink(
  path: string,
  requestUrl: string,
  value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL
): string {
  const origin = configuredSiteOrigin(value);
  if (origin) return new URL(path, origin).toString();

  if (!warnedMissingSiteUrl) {
    warnedMissingSiteUrl = true;
    console.warn(
      "NEXT_PUBLIC_SITE_URL is missing or invalid: email links use the request address."
    );
  }
  return new URL(path, requestUrl).toString();
}
