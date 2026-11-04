/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/returns/template-export": [
      "./assets/templates/MultiDeviceReturnsTemplate.xlsx"
    ]
  }
};

module.exports = nextConfig;
