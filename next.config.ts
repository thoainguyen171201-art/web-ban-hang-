import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@neondatabase/serverless", "cheerio"],
  outputFileTracingIncludes: { "/*": ["./source/*.html"] },
  poweredByHeader: false,
};
export default config;
