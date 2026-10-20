import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Satu .env di root monorepo (BLUEPRINT 14.2). Di Vercel variabel diisi lewat dashboard.
loadEnvConfig(path.resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  // Semua halaman membaca sesi pengguna (dinamis per request), jadi Cache Components
  // dinonaktifkan agar model render tetap sederhana. Lihat CHANGELOG.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "resources.premierleague.com" }],
  },
};

export default nextConfig;
