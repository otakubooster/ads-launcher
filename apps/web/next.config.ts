import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ["@fahd/core", "@fahd/db", "@fahd/meta", "@fahd/shared"],
};

export default nextConfig;
