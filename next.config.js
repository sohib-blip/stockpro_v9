// next.config.js is CommonJS: it loads the shared header builder with require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSecurityHeaders } = require("./lib/security-headers.cjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/returns/template-export": [
      "./assets/templates/MultiDeviceReturnsTemplate.xlsx"
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

module.exports = nextConfig;
