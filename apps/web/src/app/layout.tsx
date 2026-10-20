import type { Metadata, Viewport } from "next";
import { Anton, Inter } from "next/font/google";
import { getViewer } from "@/lib/data/viewer";
import { DEFAULT_THEME, type Theme } from "@/lib/preferences";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "TaktikFPL",
  description: "Asisten analisis & rekomendasi Fantasy Premier League",
  appleWebApp: { capable: true, title: "TaktikFPL", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false }, // aplikasi pribadi
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#07070C",
  width: "device-width",
  initialScale: 1,
};

/** Tema dari users.theme pengguna login; Violet (BLUEPRINT 11.2) untuk tamu atau bila Supabase gagal. */
async function resolveTheme(): Promise<Theme> {
  try {
    return (await getViewer()).theme;
  } catch {
    return DEFAULT_THEME;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await resolveTheme();
  return (
    <html lang="id" data-theme={theme} className={`${inter.variable} ${anton.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
