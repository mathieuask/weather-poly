import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/proxy/:path*",
        destination: "http://91.98.195.31:8080/:path*",
      },
    ];
  },
};

export default nextConfig;
