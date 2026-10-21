"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ENTRY_COOKIE } from "@/lib/data/tim";

/** Simpan FPL Team ID (angka di URL halaman Points FPL) ke cookie browser. */
export async function setEntry(formData: FormData) {
  const raw = String(formData.get("entry") ?? "").trim();
  const match = raw.match(/(\d{1,10})/); // terima angka saja atau URL FPL utuh
  const jar = await cookies();
  if (match) {
    jar.set(ENTRY_COOKIE, match[1], { maxAge: 60 * 60 * 24 * 400, path: "/", sameSite: "lax", httpOnly: true, secure: true });
  } else {
    jar.delete(ENTRY_COOKIE);
  }
  redirect("/tim");
}
