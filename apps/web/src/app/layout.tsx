import type { Metadata, Viewport } from "next";
import { Anton, Inter } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Tema default Violet (BLUEPRINT 11.2); preferensi users.theme dipakai di fase berikutnya.
  return (
    <html lang="id" data-theme="violet" className={`${inter.variable} ${anton.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
