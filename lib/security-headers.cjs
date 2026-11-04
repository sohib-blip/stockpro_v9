// Security headers sent with every page and API response (see next.config.js).
// Plain CommonJS so next.config.js can load it without a build step.

const VERCEL_TOOLBAR = {
  script: ["https://vercel.live"],
  style: ["https://vercel.live"],
  img: ["https://vercel.live", "https://vercel.com"],
  font: ["https://vercel.live", "https://assets.vercel.com"],
  connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
  frame: ["https://vercel.live"],
};

function supabaseOrigins(supabaseUrl) {
  if (!supabaseUrl) return [];
  try {
    const url = new URL(supabaseUrl);
    const socket = url.protocol === "http:" ? "ws:" : "wss:";
    return [url.origin, `${socket}//${url.host}`];
  } catch {
    return [];
  }
}

/**
 * Builds the Content-Security-Policy value.
 * - Scripts keep 'unsafe-inline': Next.js streams inline bootstrap scripts and
 *   the root layout sets the theme before paint. A nonce-based policy would make
 *   every page dynamic (see the Next.js CSP guide).
 * - 'unsafe-eval' only in development (React debugging needs it).
 * - The Vercel feedback toolbar is only allowed on preview deployments.
 */
function buildContentSecurityPolicy({
  isDev = false,
  isVercelPreview = false,
  supabaseUrl,
} = {}) {
  const toolbar = (key) => (isVercelPreview ? VERCEL_TOOLBAR[key] : []);
  const directives = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...toolbar("script")],
    ],
    [
      "style-src",
      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", ...toolbar("style")],
    ],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com", ...toolbar("font")]],
    ["img-src", ["'self'", "data:", "blob:", ...toolbar("img")]],
    ["connect-src", ["'self'", ...supabaseOrigins(supabaseUrl), ...toolbar("connect")]],
    ["frame-src", isVercelPreview ? toolbar("frame") : ["'none'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

function buildSecurityHeaders(env = process.env) {
  return [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({
        isDev: env.NODE_ENV === "development",
        isVercelPreview: env.VERCEL_ENV === "preview",
        supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      }),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
}

module.exports = { buildContentSecurityPolicy, buildSecurityHeaders };
