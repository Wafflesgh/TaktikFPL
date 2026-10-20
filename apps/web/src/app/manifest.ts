import type { MetadataRoute } from "next";

// Disajikan di /manifest.webmanifest (konvensi metadata Next.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaktikFPL",
    short_name: "TaktikFPL",
    description: "Asisten analisis & rekomendasi Fantasy Premier League",
    start_url: "/",
    display: "standalone",
    background_color: "#07070C",
    theme_color: "#6C3BFF",
    lang: "id",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
