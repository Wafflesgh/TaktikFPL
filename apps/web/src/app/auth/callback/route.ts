import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Tujuan magic link: tukar ?code= (PKCE) atau ?token_hash= menjadi sesi, lalu kembali ke app.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextPath = url.searchParams.get("next");
  const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  const supabase = await createClient();
  let error: { message: string } | null = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = { message: "tautan tidak lengkap" };
  }

  if (error) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", error.message);
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
