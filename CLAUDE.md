# CLAUDE.md — TaktikFPL

Kamu adalah lead engineer untuk TaktikFPL, aplikasi web (PWA, jalan di HP dan PC) yang membantu
satu pengguna utama (Dilan, Indonesia, WIB) menganalisis Fantasy Premier League secara mendalam
setiap gameweek, dengan AI Gemini (Flash di mode gratis, Gemini 4 Argon di mode berbayar)
sebagai lapisan penalaran & narasi.

**Mulai setiap sesi dengan membaca docs/TaktikFPL.md** (status terkini, infrastruktur, tool, backlog).

Spesifikasi lengkap ada di docs/BLUEPRINT.md. Itu sumber kebenaran. Jika ada konflik antara kode
dan blueprint, ikuti blueprint atau tanyakan.

## Aturan inti
1. ANGKA DARI ENGINE, NARASI DARI LLM. Semua angka (xPts, probabilitas, statistik) dihitung oleh
   worker Python yang deterministik dan teruji. Gemini hanya menjelaskan, merangkum, mengekstrak
   berita, dan menyusun skenario — tidak boleh mengarang angka. Setiap klaim LLM wajib merujuk
   evidence_id dari data yang kita kirim.
2. Simpan waktu dalam UTC (timestamptz). Tampilkan dalam Asia/Jakarta.
3. Semua sumber eksternal lewat adapter di services/worker/app/sources/<nama>.py dengan
   rate-limit, retry eksponensial, cache, dan raw payload disimpan ke tabel raw_payloads.
   API FPL tidak bisa dipanggil dari browser (CORS) — selalu lewat worker/server.
   Mode default tanpa login FPL; endpoint ber-cookie (my-team, me, transfers-latest)
   hanya opsional, read-only, cookie disimpan sebagai secret worker (Bagian 6.2.3).
4. Jangan hardcode nama pelatih, klub, pemain, atau aturan poin FPL. Ambil dari API
   (bootstrap-static) dan tabel config (fpl_scoring_rules). Musim berganti, aturan berubah.
5. Setiap job terjadwal mencatat diri ke tabel job_runs (mulai, selesai, status, error).
6. Output AI divalidasi dengan schema (Pydantic di worker, Zod di web). Gagal validasi = retry
   sekali dengan pesan error, lalu tandai report sebagai degraded, jangan crash.
7. Bahasa UI: ENGLISH (keputusan Dilan 2026-10-21, menggantikan Bahasa Indonesia di blueprint).
   Waktu tetap ditampilkan dalam WIB. Komentar kode & dokumen boleh Bahasa Indonesia.
8. Ikuti design tokens di Bagian 11. Jangan pakai logo klub/kompetisi resmi sebagai aset statis
   di repo; badge & foto pemain dimuat dari URL CDN yang dikonfigurasi (lihat Bagian 6).
9. DATA ADALAH ASET JANGKA PANJANG (ML, bertahun-tahun) — docs/adr/0001-data-arsip-jangka-panjang.md.
   API FPL di-reset tiap musim. Payload mentah diarsip immutable (bucket `archive` +
   tabel data_archives); tabel fakta tidak pernah dihapus/dipangkas; hanya data turunan &
   operasional boleh dipangkas, dan snapshot fitur per-deadline GW selalu disimpan (point-in-time).
   Setiap sumber/endpoint baru wajib punya kebijakan arsip. Migrasi tidak menghapus kolom fakta.

## Stack
- apps/web: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query + Recharts,
  PWA (next-pwa / serwist), Web Push.
- services/worker: Python 3.12 + FastAPI + APScheduler + SQLAlchemy 2 + pandas +
  numpy + scipy + scikit-learn + LightGBM + PuLP + google-genai SDK + httpx + tenacity.
- AI: SDK google-genai. Nama model selalu dari env. Default AI_TIER=free (model Flash, gratis);
  Gemini 4 Argon hanya jika billing aktif (AI_TIER=paid/hybrid). Lihat Bagian 10.0.
- Database: PostgreSQL (Supabase, versi mengikuti project) — Auth, Realtime, Storage dipakai. Kunci Supabase format
  baru: sb_publishable_… (front end) dan sb_secret_… (worker saja). Worker & Vercel memakai
  Session pooler, bukan direct connection (IPv6-only).
- Repo ini PUBLIK: jangan pernah commit .env, password DB, sb_secret_…, cookie FPL, atau API key.
- Cache/queue: Redis (Upstash) — opsional di Fase 1, wajib di Fase 3 (live).
- Deploy: web di Vercel, worker di Railway/Fly.io (proses always-on karena scheduler), DB di Supabase.

## Cara kerja
- Kerjakan per fase sesuai Bagian 15. Di akhir fase, jalankan test, update CHANGELOG.md,
  dan tulis ringkasan apa yang sudah/ belum.
- Tulis test untuk: parser setiap adapter (pakai fixture JSON di tests/fixtures), kalkulasi xPts,
  deteksi perubahan jadwal, dan validasi schema output AI.
- Migrasi DB hanya lewat Supabase CLI (supabase/migrations/*.sql). SQL final & langkah eksekusi ada di
  docs/INFRA_BLUEPRINT.md; DDL di Bagian 8 blueprint ini hanya acuan konsep.
- Jangan commit secret. Semua lewat .env (lihat .env.example di Bagian 14).
