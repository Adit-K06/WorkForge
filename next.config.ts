import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.11"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.VERCEL
          ? "/api/"
          : "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
