import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdf-to-img", "pdfjs-dist"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
  env: {
    SKIP_AUTH: process.env.SKIP_AUTH,
  },
};

export default withSerwist(nextConfig);
