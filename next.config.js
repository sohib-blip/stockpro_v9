/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/returns/template-export": [
        "./assets/templates/MultiDeviceReturnsTemplate.xlsx"
      ]
    }
  }
};

module.exports = nextConfig;
