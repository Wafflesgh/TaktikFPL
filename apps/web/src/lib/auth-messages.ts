// Pesan ramah (Bahasa Indonesia) untuk error Supabase Auth — dipakai server & klien.
export function friendlyAuthError(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  if (/expired|invalid|otp_/i.test(raw)) return "Tautan masuk sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.";
  if (/signups? not allowed/i.test(raw)) return "Pendaftaran ditutup. Gunakan email yang sudah terdaftar.";
  if (/rate limit|too many/i.test(raw)) return "Terlalu banyak permintaan. Tunggu beberapa menit lalu coba lagi.";
  return raw;
}
