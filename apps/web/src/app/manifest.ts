import type { MetadataRoute } from "next";

// Disajikan di /manifest.webmanifest (konvensi metadata Next.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaktikFPL",
    short_name: "TaktikFPL",
    description: "Fantasy Premier League analysis & recommendation assistant",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0B20", // latar logo
    theme_color: "#6C3BFF",
    lang: "en",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
