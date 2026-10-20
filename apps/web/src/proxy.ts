import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Semua rute kecuali aset statis, manifest PWA, dan gambar.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.*|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
