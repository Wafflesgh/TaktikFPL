# TaktikFPL — Blueprint Aplikasi Analisis & Rekomendasi FPL

> **Dokumen landasan tunggal** untuk membangun aplikasi asisten Fantasy Premier League (FPL) bertenaga AI **Gemini 4 Argon**.
> Ditulis untuk diserahkan ke **Claude Code** sebagai spesifikasi engineering, dan bisa terus dikembangkan.
>
> - Versi dokumen: `v0.4` — 20 Oktober 2026 (musim 2026/27)
> - Pemilik produk: Dilan
> - Zona waktu tampilan default: **WIB (Asia/Jakarta, UTC+7)** — semua data disimpan dalam **UTC**
> - Bahasa UI default: **Bahasa Indonesia** (istilah sepakbola/FPL tetap bahasa Inggris: xG, xA, clean sheet, captain, dll.)

---

## Daftar Isi

0. [Cara Pakai Dokumen Ini](#0-cara-pakai-dokumen-ini)
1. [Master Prompt untuk Claude Code](#1-master-prompt-untuk-claude-code)
2. [Visi Produk & Prinsip Analisis](#2-visi-produk--prinsip-analisis)
3. [Konteks Musim 2026/27 yang Harus Diketahui Engine](#3-konteks-musim-202627-yang-harus-diketahui-engine)
4. [Kerangka Analisis Mendalam (Inti Aplikasi)](#4-kerangka-analisis-mendalam-inti-aplikasi)
5. [Model Proyeksi Poin & Mesin Rekomendasi](#5-model-proyeksi-poin--mesin-rekomendasi)
6. [Sumber Data & Kebutuhan API](#6-sumber-data--kebutuhan-api)
7. [Arsitektur Sistem](#7-arsitektur-sistem)
8. [Desain Database](#8-desain-database)
9. [Pipeline Data, Scheduler & Protokol Deadline T-60](#9-pipeline-data-scheduler--protokol-deadline-t-60)
10. [Integrasi Gemini 4 Argon & Library Prompt](#10-integrasi-gemini-4-argon--library-prompt)
11. [Desain UI/UX (dari Referensi)](#11-desain-uiux-dari-referensi)
12. [Fitur Tambahan](#12-fitur-tambahan)
13. [API Internal (Kontrak Backend ↔ Frontend)](#13-api-internal-kontrak-backend--frontend)
14. [Struktur Repo, Environment & DevOps](#14-struktur-repo-environment--devops)
15. [Roadmap Pengerjaan Bertahap](#15-roadmap-pengerjaan-bertahap)
16. [Risiko, Legal & Batasan Data](#16-risiko-legal--batasan-data)
17. [Glosarium](#17-glosarium)

---

## 0. Cara Pakai Dokumen Ini

1. Buat repo GitHub baru, misalnya `taktikfpl`.
2. Simpan file ini sebagai `docs/BLUEPRINT.md`, lalu salin **Bagian 1 (Master Prompt)** ke `CLAUDE.md` di root repo.
3. Simpan 3 gambar referensi UI ke folder `docs/design/`:
   - `docs/design/ref-01-ember-mobile.png` — 3 layar mobile oranye-merah ("Choose the Game", live match, match schedule)
   - `docs/design/ref-02-pitch-dashboard.png` — dashboard desktop hijau stadion ("AI Powered Dashboard")
   - `docs/design/ref-03-violet-mobile.png` — 3 layar mobile ungu gelap (home live match, league center, lineup)
4. Isi API key di `.env` (daftar di [Bagian 6.4](#64-checklist-api-key-yang-perlu-anda-siapkan)).
5. Jalankan Claude Code di root repo dan beri perintah:
   `Baca CLAUDE.md dan docs/BLUEPRINT.md. Kerjakan Fase 1 dari roadmap. Tanyakan saya jika ada keputusan yang ambigu.`
6. Kerjakan per fase ([Bagian 15](#15-roadmap-pengerjaan-bertahap)). Setiap fase punya kriteria selesai yang bisa diuji.

Semua diagram di dokumen ini memakai **Mermaid**, yang otomatis dirender menjadi gambar oleh GitHub.

---

## 1. Master Prompt untuk Claude Code

> Salin blok berikut ke `CLAUDE.md`.

```markdown
# CLAUDE.md — TaktikFPL

Kamu adalah lead engineer untuk TaktikFPL, aplikasi web (PWA, jalan di HP dan PC) yang membantu
satu pengguna utama (Dilan, Indonesia, WIB) menganalisis Fantasy Premier League secara mendalam
setiap gameweek, dengan AI Gemini (Flash di mode gratis, Gemini 4 Argon di mode berbayar)
sebagai lapisan penalaran & narasi.

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
7. Bahasa UI: Bahasa Indonesia natural. Istilah teknis sepakbola tetap bahasa Inggris.
8. Ikuti design tokens di Bagian 11. Jangan pakai logo klub/kompetisi resmi sebagai aset statis
   di repo; badge & foto pemain dimuat dari URL CDN yang dikonfigurasi (lihat Bagian 6).

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
```

---

## 2. Visi Produk & Prinsip Analisis

### 2.1 Masalah yang diselesaikan

Memilih 15 pemain FPL tiap minggu butuh menggabungkan puluhan faktor: performa underlying (xG, xA, chance created), gaya bermain pemain, taktik dan kebiasaan rotasi pelatih, gaya lawan, duel individu, jadwal padat Eropa/piala, berita cedera, sampai perubahan jadwal. TaktikFPL menyatukan semuanya, menghitung peluang poin secara kuantitatif, lalu Gemini menjelaskan **kenapa** seorang pemain layak dipilih dan **skenario apa** yang bisa membuatnya meledak (atau gagal).

### 2.2 Output utama per gameweek

| Output | Isi |
|---|---|
| **Rekomendasi Transfer** | Siapa keluar, siapa masuk, gain xPts 1/3/6 GW, risiko, alasan |
| **Kapten & Vice** | EV kapten, ceiling (P90), effective ownership, skenario |
| **Starting XI & Bench Order** | Optimal berdasarkan xPts dan risiko menit |
| **Player Deep Dive** | Profil arketipe, statistik lintas kompetisi, matchup, skenario poin |
| **Laporan Deadline T-60** | Audit final 60 menit sebelum deadline: berita terbaru, perubahan status, rekomendasi final |
| **Live Match Center** | Visual lapangan, timeline event, poin FPL live tim saya |
| **Fixture & Perubahan Jadwal** | Kalender per GW, ticker kesulitan, notifikasi jika jadwal berubah |

### 2.3 Prinsip

1. **Kuantitatif dulu, naratif kemudian.** Engine menghitung; Gemini menjelaskan.
2. **Setiap alasan bisa dilacak.** Tiap reason punya `evidence_id` → klik untuk melihat datanya.
3. **Ketidakpastian ditampilkan.** Selalu tampilkan rentang (P10–P90) dan confidence, bukan satu angka.
4. **Recency + sample size.** Statistik dibobot: terkini lebih berat, sampel kecil disusutkan ke rata-rata (shrinkage), supaya 2 laga bagus tidak dianggap tren.
5. **Kompetisi berbeda, bobot berbeda.** Data UCL/FA Cup/Carabao dipakai untuk profil pemain dan beban menit, tapi dengan penyesuaian kekuatan lawan.
6. **Tidak ada nama hardcode.** Pelatih, klub, aturan poin diambil dari data supaya aplikasi tetap jalan musim depan.

---

## 3. Konteks Musim 2026/27 yang Harus Diketahui Engine

Ini konteks per 20 Oktober 2026 untuk seed awal dan pengujian. **Di runtime, semua harus diambil ulang dari API**, bukan dari daftar ini.

- **Klub promosi 2026/27:** Coventry City, Ipswich Town, dan Hull City. Hull lolos lewat play-off Championship meski finis keenam, dan kembali ke PL pertama kali sejak 2016/17. Profil taktik klub promosi harus di-bootstrap dari data Championship musim lalu (lihat 4.4).
- **Manchester City:** Enzo Maresca resmi menggantikan Pep Guardiola pada 29 Juni 2026 dengan kontrak tiga tahun hingga 2029. Engine perlu menandai ini sebagai *manager change* → data taktik City sebelum Juli 2026 diberi bobot rendah untuk profil tim, tapi data Maresca di Chelsea/Leicester dipakai sebagai prior gaya pelatih.
- **Manchester United:** Michael Carrick menjadi head coach permanen pada Mei 2026 dengan kontrak dua tahun setelah masa interim yang sukses di 2025/26, dan musim ini United juga bermain di Liga Champions → faktor rotasi lebih tinggi daripada musim lalu.
- **Aturan FPL 2026/27:**
  - Defensive contribution (DefCon) tetap ada dan tidak berubah: bek mendapat 2 poin di 10+ CBIT (clearances, blocks, interceptions, tackles); gelandang & penyerang di 12+ dengan ball recoveries ikut dihitung; maksimal 2 poin per laga.
  - Bonus Points System dirombak untuk mengurangi tumpang tindih dengan DefCon dan menaikkan peluang bonus kiper, full-back, dan pemain menyerang. Contohnya, 1 BPS kini didapat per 3 clearances/blocks/interceptions, bukan per 2.
  - Poin dan klasemen mini-league kini update real-time, dan bonus proyeksi ditambahkan setelah menit ke-20 tiap laga.
  - Skor GW baru final pukul 09:00 waktu Inggris sehari setelah laga terakhir GW.
  - Ada Price Change Predictor resmi yang menunjukkan progres naik/turun harga, dengan perubahan harga pukul 00:00 waktu Inggris.
- **Data statistik lanjutan:** FBref tidak lagi menyediakan statistik lanjutan (xG, progressive passes, shot-creating actions) sejak Januari 2026 karena kontrak data dari Opta dihentikan. **Jangan bangun pipeline di atas FBref.** Alternatif ada di Bagian 6.

> Semua aturan poin disimpan di tabel `fpl_scoring_rules` (versi per musim), bukan di kode.

---

## 4. Kerangka Analisis Mendalam (Inti Aplikasi)

Analisis disusun dalam **7 lapisan**. Tiap lapisan menghasilkan *feature* numerik (masuk model) dan *insight* teks (masuk narasi Gemini).

```mermaid
flowchart TB
    L1["L1 · Identitas Pemain<br/>posisi FPL, harga, kepemilikan, status"]
    L2["L2 · Arketipe & Profil Statistik<br/>Inverted Winger, Poacher, Box-to-box, dll"]
    L3["L3 · Konteks Tim & Pelatih<br/>gaya main, formasi, rotasi, set-piece"]
    L4["L4 · Lawan (Tim)<br/>low block, high press, counter, kelemahan"]
    L5["L5 · Matchup Individu & Efek Rekan<br/>bek lawan di sisinya, efek Rodri, dll"]
    L6["L6 · Jadwal, Beban & Kondisi<br/>UCL midweek, perjalanan, cuaca, wasit"]
    L7["L7 · Berita & Sinyal Pasar<br/>cedera, konflik, presser, odds, harga"]
    ENG["Model xPts + Simulasi Monte Carlo"]
    AI["Gemini 4 Argon<br/>alasan + skenario + risiko"]
    OUT["Rekomendasi Mingguan"]
    L1 --> ENG
    L2 --> ENG
    L3 --> ENG
    L4 --> ENG
    L5 --> ENG
    L6 --> ENG
    L7 --> ENG
    ENG --> AI
    L7 --> AI
    AI --> OUT
    ENG --> OUT
```

### 4.1 Lapisan 1 — Identitas Pemain

Sumber: FPL `bootstrap-static` + API-Football.

| Field | Keterangan |
|---|---|
| Nama, klub, posisi FPL (GKP/DEF/MID/FWD) | Posisi FPL bisa beda dari posisi riil. Simpan keduanya. |
| Posisi riil & sisi | mis. RW yang cut inside, LCB, DM. Diturunkan dari formasi lineup + data posisi API-Football |
| Harga, % kepemilikan, net transfer | Snapshot harian |
| Status & `chance_of_playing_next_round` | Dari FPL, dicek ulang berkala |
| Peran set-piece | Penalti, tendangan bebas, corner (urutan eksekutor) |
| Foto kepala (headshot) | URL dari CDN FPL (lihat 6.3) |

### 4.2 Lapisan 2 — Arketipe & Profil Statistik Pemain

**Tujuan:** menjawab "tipe pemain seperti apa dia?" berbasis data, bukan label media.

#### 4.2.1 Katalog statistik yang dikumpulkan (per 90 & total, per kompetisi)

Kumpulkan dari **semua kompetisi**: Premier League, UEFA Champions League / Europa League / Conference League, FA Cup, Carabao Cup (EFL Cup), plus timnas bila tersedia.

| Kelompok | Metrik |
|---|---|
| **Finishing** | Goals, npG, xG, npxG, xG/shot, shots, shots on target, shots in box %, big chances missed, goals − xG (overperformance), header xG |
| **Kreasi** | Assists, xA, key passes (chances created), big chances created, shot-creating actions*, through balls, crosses & akurasi, passes into box, cutbacks* |
| **Progresi** | Progressive carries*, progressive passes*, dribbles attempted/success %, touches in box, final-third entries* |
| **Penguasaan** | Touches, pass completion %, passes per 90, possession lost |
| **Bertahan / Ball winning** | Tackles, tackles won %, interceptions, clearances, blocks, ball recoveries, duels won %, aerials won %, dribbled past, fouls, errors leading to shot |
| **FPL-spesifik** | CBIT & CBIRT per 90 (untuk DefCon), P(DefCon) historis, BPS per 90, bonus rate, saves (GK), penalties won/conceded |
| **Ketersediaan** | Menit, starts, % menit tim, sub-on/sub-off timing, cedera historis (hari absen), kartu |

`*` = tersedia hanya bila provider mendukung (Sportmonks/Opta tier). Engine harus **degrade gracefully**: arketipe tetap dihitung dari metrik yang ada, dengan confidence turun.

#### 4.2.2 Penyesuaian lintas kompetisi

- **Opponent strength adjustment:** statistik per laga dikalikan faktor kekuatan lawan (Elo/rating tim dari Club Elo atau rating internal). Gol ke tim League Two di Carabao tidak setara gol ke Arsenal.
- **Bobot kompetisi default** (bisa diubah di `config.competition_weights`): PL 1.00 · UCL 0.95 · UEL 0.85 · UECL 0.75 · FA Cup 0.70 (dikali faktor lawan) · Carabao 0.65 (dikali faktor lawan).
- **Recency decay:** bobot laga = `exp(-Δhari / τ)` dengan τ = 120 hari (default), plus *manager-change cut*: laga di bawah pelatih lama dibobot 0.5×.
- **Shrinkage:** metrik per 90 di-shrink ke rata-rata posisi berdasarkan menit (empirical Bayes), supaya pemain dengan 200 menit tidak terlihat seperti mesin gol.

#### 4.2.3 Taksonomi arketipe

Dihitung dengan clustering (Gaussian Mixture) pada vektor metrik ter-standardisasi per posisi, lalu cluster dinamai via mapping aturan + Gemini memberi label & deskripsi. Pemain bisa punya **arketipe utama + sekunder** dengan skor keanggotaan.

| Grup | Arketipe | Ciri data | Implikasi FPL |
|---|---|---|---|
| **FWD** | Poacher / Box Striker | touches in box tinggi, xG/shot tinggi, dribel rendah | Bergantung servis; meledak vs tim yang kebobolan banyak cross & cutback |
| | Target Man | aerial won tinggi, header xG | Bagus vs bek pendek; set-piece threat |
| | Pressing Forward | tackles/recoveries di final third tinggi | Bonus BPS & peluang DefCon kecil |
| | False 9 / Deep-lying Forward | key passes & progressive passes tinggi | xA lebih stabil dari xG |
| | Channel Runner | progressive carries, through balls diterima | Kuat vs high line & tim yang press tinggi |
| **MID / Sayap** | Inverted Winger / Inside Forward | kaki kebalikan sisi, shots dari half-space, dribel ke dalam | Ceiling gol tinggi; lihat bek sayap lawan |
| | Traditional Winger | crosses tinggi, touchline width | xA via cross; tergantung target man |
| | Wide Playmaker | key passes, through balls, set-piece duty | Floor stabil dari assist & bonus |
| | Attacking Midfielder / No.10 | shots + key passes zona 14, penalti | Profil "Bruno": volume tinggi, sering penalti |
| | Advanced 8 / Box-crashing 8 | late runs, touches in box dari tengah | Gol dari lini kedua |
| | Box-to-box | balanced, recoveries tinggi | Kandidat DefCon MID |
| | Deep-lying Playmaker | progressive passes, sedikit shot | Nilai FPL rendah kecuali set-piece |
| | Ball-winning DM | tackles + interceptions + recoveries tinggi | DefCon magnet (threshold 12 CBIRT) |
| **DEF** | Attacking Full-back / Wing-back | crosses, key passes, touches in box | Ceiling assist; tergantung sistem (3 bek?) |
| | Inverted Full-back | pass ke tengah, progressive passes | Clean sheet + kadang gol |
| | Ball-playing CB | progressive passes tinggi | CS + BPS dari pass |
| | Stopper / Defensive CB | clearances, aerials tinggi | DefCon kuat vs tim yang banyak cross |
| | Set-piece Threat CB | header xG dari set-piece | Gol bonus |
| **GKP** | Shot-stopper | saves per 90, PSxG−GA | Poin save di tim lemah |
| | Sweeper Keeper | aksi keluar kotak | Relevan vs tim dengan through ball |

**Arketipe dipakai di model** sebagai fitur interaksi: `archetype × opponent_weakness` (mis. Inverted Winger × lawan yang full-back-nya sering kalah 1v1).

### 4.3 Lapisan 3 — Konteks Tim & Pelatih

#### 4.3.1 Profil gaya bermain tim (dihitung, bukan dikira)

| Dimensi | Metrik penentu | Label |
|---|---|---|
| Penguasaan bola | possession %, passes per laga, field tilt | Possession / Balanced / Direct |
| Intensitas pressing | **PPDA** (passes per defensive action, dari Understat), recoveries di final third, high turnovers | High Press / Mid Block / Low Block |
| Gegenpress | recoveries dalam ≤5 detik setelah kehilangan bola* | Gegenpress |
| Garis pertahanan | offsides lawan per laga, rata-rata posisi tackle | High Line / Deep Line |
| Kecepatan serangan | direct speed*, fast-break shots | Counter-attacking / Patient build-up |
| Lebar serangan | crosses, % serangan via sayap | Wide / Narrow / Half-space |
| Set-piece | xG dari set-piece, gol corner | Set-piece Heavy |
| Ancaman & kebobolan | xG, xGA, deep completions (Understat), big chances | Dominant / Leaky |

Label disimpan sebagai `team_style_tags` dengan skor 0–1 (satu tim bisa "High Press 0.8 + Possession 0.7").

Contoh label yang perlu didukung (sesuai kebutuhan Anda): possession football, gegenpress, low block, high press, mid block, counter-attack, tiki-taka + direct transition (mis. Barcelona), long-ball/direct, wing-oriented.

#### 4.3.2 Profil pelatih (manager)

Tabel `managers` + `manager_tenures` (riwayat klub). Untuk tiap pelatih, hitung:

| Metrik | Cara hitung | Kenapa penting di FPL |
|---|---|---|
| **Rotation Index** | rata-rata jumlah perubahan starter antar laga berurutan (semua kompetisi) | Risiko benched |
| **Post-Europe rotation** | perubahan starter pada laga PL setelah midweek UCL/UEL | Risiko "Pep roulette" |
| **Minutes concentration (Gini)** | distribusi menit dalam skuad | Banyak/sedikit pemain inti |
| **Sub timing** | menit rata-rata pergantian pertama; % starter diganti sebelum 60' | Risiko kehilangan poin appearance 60' & CS |
| **Early-sub saat unggul** | % penyerang ditarik saat menang ≥2 gol | Batas ceiling |
| **Formasi favorit & fleksibilitas** | distribusi formasi | Peran pemain berubah |
| **Kepercayaan pemain muda** | menit U21 | Rotasi tak terduga |
| **Set-piece & penalti policy** | eksekutor bervariasi atau tetap | xPts set-piece |
| **New-manager bounce** | performa 10 laga awal tenure | Untuk pelatih baru (mis. Maresca di City) |
| **Gaya dari klub sebelumnya (prior)** | style tags rata-rata di tenure lama | Bootstrap tim yang ganti pelatih |

Rotation Index dan sub timing **masuk langsung ke model xMins** (Bagian 5.2).

#### 4.3.3 Efek rekan setim (with/without)

Contoh kebutuhan Anda: *"ketika ada Rodri, Haaland lebih sering cetak gol."*

- Untuk setiap pemain target P dan rekan setim kunci K (top-N menit di tim), hitung metrik P (xG/90, xA/90, xPts/90) **saat K starter vs saat K absen**.
- Uji signifikansi (bootstrap CI). Simpan hanya efek dengan sampel ≥ 450 menit di kedua kondisi dan CI tidak memotong 0.
- Tabel `teammate_effects(player_id, teammate_id, metric, with_value, without_value, delta, ci_low, ci_high, minutes_with, minutes_without)`.
- Saat K diberitakan cedera → model otomatis menurunkan/menaikkan proyeksi P.

### 4.4 Lapisan 4 — Lawan (Tim)

Untuk setiap fixture, bandingkan profil tim pemain vs profil lawan.

| Analisis | Isi |
|---|---|
| **Style clash matrix** | mis. tim possession vs low block → xG lebih rendah tapi volume cross & set-piece naik; high press vs tim yang suka build-up pendek → peluang turnover |
| **Kelemahan lawan per zona/sumber** | xGA dari cross, dari counter, dari set-piece, dari tembakan luar kotak; sisi kiri vs kanan |
| **Defensive record terkini** | xGA 6 laga, big chances conceded, clean sheet rate kandang/tandang |
| **Kekuatan serangan lawan** | untuk menghitung P(clean sheet) tim pemain |
| **Head-to-head** | H2H 5 pertemuan terakhir (semua kompetisi), tapi **dibobot rendah** jika pelatih/skuad sudah banyak berubah; tampilkan juga tanggal & venue |
| **Waktu laga** | early kick-off (12:30 UK) / Monday night / setelah jeda internasional; performa tim pada slot itu |
| **Lawan lintas kompetisi** | Lawan UCL (mis. Barcelona) juga diprofilkan memakai data API-Football agar beban dan konteks midweek jelas |

**Klub promosi** (Hull, Coventry, Ipswich): profil awal dari data Championship 2025/26, lalu disesuaikan faktor liga (PL lebih kuat) dan diperbarui cepat (τ lebih pendek = 60 hari) sampai ada ≥8 laga PL.

### 4.5 Lapisan 5 — Matchup Individu

Contoh kebutuhan Anda: *"Bruno Fernandes jadi ciut ketika melawan bek-bek Hull City."*

Data duel satu-lawan-satu yang presisi biasanya hanya ada di provider event-level berbayar (Opta/StatsBomb). Maka pendekatan bertingkat:

| Tier | Data | Metode |
|---|---|---|
| **Tier A (proxy, selalu ada)** | Posisi & sisi pemain + bek/gelandang lawan yang menjaga zonanya (dari lineup & formasi) | Pasangkan Winger kiri ↔ Full-back kanan lawan, No.10 ↔ DM lawan. Bandingkan metrik bertahan lawan (dribbled past/90, duels won %, aerials won %, tackles won %) dengan metrik menyerang pemain (dribel sukses, aerial, shots). Hasil: `matchup_edge_score` −1…+1 |
| **Tier B (riwayat langsung)** | Laga-laga di mana P dan defender D sama-sama bermain | Rata-rata output P (xG, xA, dribel, poin FPL) dibanding baseline P. Sampel kecil → di-shrink kuat |
| **Tier C (event-level, opsional berbayar)** | Duel per pasangan pemain | Langsung dari provider |

Tabel `matchup_edges(fixture_id, player_id, opponent_player_id, zone, tier, edge_score, sample_minutes, notes)`.

Narasi Gemini wajib menyebut tier sumber, contoh: *"Berdasarkan proxy zona (Tier A), Bruno akan sering berhadapan dengan DM lawan X yang memenangkan 64% duelnya — ruang Bruno di zona 14 kemungkinan sempit."*

### 4.6 Lapisan 6 — Jadwal, Beban & Kondisi

| Faktor | Detail |
|---|---|
| **Fixture congestion** | jumlah laga 7/14 hari terakhir & berikutnya, semua kompetisi |
| **Midweek Eropa** | laga UCL/UEL Selasa–Kamis sebelum GW → naikkan risiko rotasi; jarak hari & lokasi tandang (jarak tempuh km) |
| **Laga piala sebelum/ sesudah** | Carabao/FA Cup → pelatih rotasi di laga mana? |
| **Jeda internasional** | pemain yang bermain 2× untuk timnas + perjalanan jauh (mis. Amerika Selatan) |
| **Blank & Double GW** | deteksi otomatis dari fixtures (laga dengan `event = null` = blank) |
| **Home/Away** | home advantage per tim |
| **Cuaca** | hujan deras/angin kencang → kurangi xG sedikit, naikkan variansi (Open-Meteo) |
| **Wasit** | rata-rata kartu & penalti per laga (penting untuk pemain yang sering jatuh di kotak) |
| **Kick-off time** | dalam WIB untuk UI |

### 4.7 Lapisan 7 — Berita & Sinyal Pasar

| Sinyal | Sumber | Pengaruh |
|---|---|---|
| Cedera/sakit/skors | FPL `news`, situs klub, Gemini + Google Search grounding, RSS media | xMins |
| Press conference pelatih | Ringkasan presser (Gemini mengekstrak: "doubt", "back in training", "will be assessed") | xMins + confidence |
| Konflik pemain–pelatih, dropped, disiplin internal | Berita (grounded) | xMins, flag risiko |
| Pergantian pelatih / rumor sacking | Berita | Reset profil taktik |
| Transfer & kedatangan pemain baru di posisi sama | Berita + FPL | Rotasi |
| Kepemilikan & harga | FPL + Price Change Predictor | Template vs differential |
| **Odds bandar** | The Odds API: 1X2, total goals, clean sheet, anytime scorer | Kalibrasi P(goal), P(CS) — sinyal pasar paling akurat untuk dicampur dengan model |
| Lineup bocoran/terkonfirmasi | API-Football lineups (±1 jam sebelum kick-off) | Live / autosub planning |

Setiap berita diekstrak ke struktur:

```json
{
  "player_ids": [123],
  "team_ids": [11],
  "type": "injury | illness | suspension | rotation_hint | manager_conflict | manager_change | transfer | return_to_training | lineup_leak | other",
  "severity": "low | medium | high",
  "expected_absence": "none | 1_match | 2_4_weeks | long_term | unknown",
  "confidence": 0.0,
  "summary_id": "ringkasan 1–2 kalimat dalam bahasa Indonesia",
  "source_urls": ["..."],
  "published_at": "2026-10-20T08:00:00Z"
}
```

### 4.8 Analisis Tambahan (dikembangkan dari permintaan Anda)

1. **Regression-to-the-mean flag** — pemain dengan G − xG sangat positif (lucky) atau negatif (unlucky). Unlucky + volume tinggi = kandidat beli.
2. **Shot quality trend** — xG/shot naik/turun 5 laga terakhir (peran berubah?).
3. **Role change detector** — posisi rata-rata/heat zone, touches in box, atau set-piece duty berubah setelah pergantian pelatih/formasi.
4. **Penalty hierarchy tracker** — siapa eksekutor #1, #2; perubahan saat #1 absen.
5. **Game-state dependency** — pemain yang produktif saat tim tertinggal vs unggul; dikombinasikan dengan prediksi skor.
6. **Minutes cliff** — pemain baru pulih cedera biasanya dibatasi ±60 menit di 2–3 laga awal.
7. **Fatigue model** — beban menit 21 hari + usia → risiko diturunkan.
8. **Bonus magnet score** — kecocokan profil pemain dengan formula BPS 2026/27 terbaru.
9. **DefCon probability** — distribusi CBIT/CBIRT per laga → P(≥10/12) vs lawan tertentu (tim yang mendominasi bola = lebih banyak aksi bertahan untuk lawannya).
10. **Captaincy EO risk** — kapten template vs differential: dampak ke rank berdasarkan EO di top 10k & mini-league.
11. **Fixture swing** — tim yang jadwalnya membaik dalam 3–6 GW → beli sebelum harga naik.
12. **Set-piece zone threat** — tim lawan kebobolan banyak dari corner → naikkan CB tinggi tim kita.
13. **Weather & pitch** — laga sore musim dingin dengan hujan, efek pada tim possession.
14. **Derby & motivasi** — derby, laga perebutan gelar/degradasi: variansi lebih tinggi, kartu lebih banyak.
15. **Post-UCL hangover** — performa tim di PL setelah laga UCL tandang jauh.
16. **Manager pressure index** — pelatih di ujung tanduk cenderung bermain lebih aman/defensif.
17. **Promoted team trajectory** — kekuatan klub promosi biasanya turun di paruh musim; pantau tren xGA.

### 4.9 Skenario & Alasan (Possibilities)

Untuk setiap pemain yang direkomendasikan, sistem menghasilkan:

1. **Kenapa dipilih (Top Reasons)** — 3–6 alasan, masing-masing dengan `evidence_id`, kategori (form, fixture, matchup, tactic, news, market), dan bobot kontribusi ke xPts (dari SHAP value model).
2. **Skenario poin** — 3 skenario dengan probabilitas dari simulasi:
   - **Haul (≥10 poin)** — mis. "City dominan, low block Hull memaksa banyak cutback → Haaland 2 gol + bonus", P = x%
   - **Solid (4–9)** — P = y%
   - **Blank (≤3)** — mis. "Maresca rotasi setelah UCL tandang, Haaland main 60 menit", P = z%
3. **Trigger risiko** — kondisi yang membuat rekomendasi dibatalkan (mis. "Jika Rodri tidak masuk squad, turunkan prioritas").
4. **Alternatif** — 2 pemain pengganti di kisaran harga serupa.

#### Contoh format kartu analisis (angka ilustratif, bukan data nyata)

```text
ERLING HAALAND · MCI · FWD · £{price}m · Owned {own}%
Arketipe: Poacher (0.82) · Channel Runner (0.31)
GW{n}: vs {opponent} (H) · Sab 22:00 WIB
xPts: {xpts}  [P10 {p10} – P90 {p90}]   xMins: {xmins}   Confidence: {conf}

Alasan utama
1. [MATCHUP] Lawan bermain low block dan kebobolan {x}% xGA dari cutback — sesuai pola gol Haaland. (ev#1021)
2. [TACTIC] Di bawah Maresca, City mendorong full-back ke dalam → lebih banyak umpan ke kotak. (ev#1088)
3. [TEAMMATE] Rodri starter: xG/90 Haaland naik dari {a} ke {b} (sampel {m} menit). (ev#1104)
4. [MARKET] Odds anytime scorer menyiratkan P(gol) {p}%. (ev#1130)

Skenario
- Haul ≥10 poin ({p_haul}%): ...
- Solid 4–9 ({p_solid}%): ...
- Blank ≤3 ({p_blank}%): rotasi setelah UCL tandang (laga Rabu) ...

Batalkan jika: Haaland tidak ikut latihan Jumat / Rodri absen + City main 3 bek.
```

---

## 5. Model Proyeksi Poin & Mesin Rekomendasi

### 5.1 Struktur xPts

Untuk pemain *i* di fixture *f*:

```
xPts(i,f) = E[appearance] + E[goal pts] + E[assist pts] + E[CS pts] + E[DefCon]
          + E[bonus] + E[saves] + E[pen save] − E[goals conceded pen] − E[cards] − E[own goal]
```

Setiap komponen = probabilitas × poin dari `fpl_scoring_rules` musim berjalan.

### 5.2 Sub-model

| Sub-model | Input utama | Metode |
|---|---|---|
| **xMins** (P start, P 60+, menit harapan) | status FPL, berita (Gemini), Rotation Index pelatih, beban menit, midweek Eropa, kompetisi posisi, minutes cliff | LightGBM classifier (start) + regresi menit; dikalibrasi isotonic |
| **Team goals (λ)** | xG/xGA ter-adjust, home adv, style clash, odds total goals | Poisson / Dixon-Coles, dicampur dengan odds (bobot dikalibrasi) |
| **Share gol & assist pemain** | share xG/xA pemain dalam tim (shrunk), peran set-piece, efek rekan, matchup edge | Multinomial share × λ tim |
| **Clean sheet** | λ lawan, P(pemain main 60+) | Poisson P(0) |
| **DefCon** | distribusi CBIT/CBIRT pemain, possession lawan, style clash | Negative binomial → P(≥threshold) |
| **Bonus** | proyeksi BPS per komponen dengan formula 2026/27 | Simulasi BPS antar pemain di laga yang sama |
| **Saves** | shots on target lawan yang diharapkan | Poisson |
| **Kartu** | rata-rata kartu pemain × faktor wasit × derby | Bernoulli |

### 5.3 Simulasi Monte Carlo

- 10.000 simulasi per fixture: skor laga → distribusi gol/assist ke pemain → BPS → poin.
- Output per pemain: mean, P10, P50, P90, P(≥10), P(blank ≤2).
- Double GW: jumlahkan simulasi per fixture dengan korelasi menit (cedera di laga 1 mempengaruhi laga 2).

### 5.4 Optimizer

- **Transfer planner** multi-GW (horizon 1–6 GW) dengan Integer Linear Programming (PuLP): maksimalkan Σ xPts terdiskon (faktor 0.85/GW) − biaya hit (−4) − penalti risiko, dengan kendala budget, maks 3 pemain/klub, formasi valid, free transfers tersisa, chip yang tersedia.
- **Captain picker:** EV kapten + mode "aman" (maks P50) atau "agresif" (maks P90 / EO-adjusted).
- **Bench order:** urut berdasarkan P(dibutuhkan autosub) × xPts.
- **Chip planner:** deteksi DGW/BGW, simulasi nilai Bench Boost, Triple Captain, Free Hit, Wildcard. Daftar chip & aturannya dibaca dari `bootstrap-static` (field `chips`), bukan hardcode.

### 5.5 Evaluasi model (wajib)

- Setelah GW final, bandingkan proyeksi vs poin aktual: MAE, Brier score untuk P(start), P(CS), P(gol); kalibrasi plot.
- Simpan di `model_evaluations`. Tampilkan di halaman "Akurasi Model" supaya Anda tahu seberapa bisa dipercaya.
- Backtest musim 2024/25–2025/26 sebelum dipakai serius.

---

## 6. Sumber Data & Kebutuhan API

### 6.1 Tabel sumber data

| # | Sumber | Data | Biaya | Kebutuhan Key | Prioritas |
|---|---|---|---|---|---|
| 1 | **FPL Official API** (tidak resmi didokumentasikan, publik) | pemain, harga, kepemilikan, status & berita singkat, fixtures & GW, deadline, poin live per GW, tim user, mini-league, chip, aturan | Gratis | Tidak | **Wajib** |
| 2 | **API-Football (api-sports.io)** | fixtures semua kompetisi (PL, UCL, UEL, FA Cup, Carabao, Championship), lineup & formasi, event live, statistik pemain per laga, cedera, wasit, H2H, standings | Berbayar (ada free tier kecil; Pro untuk polling live) | Ya | **Wajib** |
| 3 | **Understat** (scrape ringan, tidak ada API resmi) | xG/xA per tembakan (PL), PPDA tim, deep completions, xG per laga | Gratis | Tidak | **Wajib** (PL xG) |
| 4 | **Sportmonks Football API** + add-on xG/Advanced | xG lintas kompetisi (termasuk UCL & piala), statistik lanjutan per pemain | Berbayar | Ya | Disarankan (mengisi celah xG non-PL) |
| 5 | **The Odds API** | odds 1X2, total gol, BTTS, player props (anytime scorer) bila tersedia | Free tier / berbayar | Ya | Disarankan |
| 6 | **Gemini API** (`gemini-4-argon`) + Google Search grounding | ekstraksi berita, narasi, skenario, label arketipe | Berbayar per token | Ya | **Wajib** |
| 7 | **News: RSS** (BBC Sport, Sky Sports, Guardian football, situs resmi klub) + **GNews/NewsAPI** | berita & cedera | RSS gratis; NewsAPI/GNews ada free tier | Ya (untuk NewsAPI/GNews) | **Wajib** (RSS) |
| 8 | **Open-Meteo** | cuaca per stadion & jam kick-off | Gratis | Tidak | Opsional |
| 9 | **Club Elo** (clubelo.com API CSV) | rating kekuatan tim Eropa → opponent adjustment lintas kompetisi | Gratis | Tidak | Disarankan |
| 10 | **Opta / Stats Perform, StatsBomb** | event data lengkap, duel 1v1 | Enterprise (mahal) | Ya | Opsional (Tier C matchup) |
| 11 | **Telegram Bot API** | notifikasi ke HP | Gratis | Token bot | Opsional |
| 12 | **Web Push (VAPID)** | notifikasi PWA | Gratis | Key pair dibuat sendiri | Disarankan |

> Hindari scraping Sofascore, FotMob, WhoScored, dan Transfermarkt untuk produksi: Terms of Service mereka melarang, dan endpoint sering berubah. Jika dipakai untuk eksperimen pribadi, isolasi di adapter terpisah dengan flag `EXPERIMENTAL_SOURCES=false` sebagai default.

### 6.2 Endpoint FPL yang dipakai

Base: `https://fantasy.premierleague.com/api/`

Rujukan dokumentasi komunitas: [FPL APIs Explained — Oliver Looney](https://www.oliverlooney.com/blogs/FPL-APIs-Explained). Tidak ada dokumentasi resmi; semua endpoint di bawah wajib diverifikasi dengan contract test.

#### 6.2.1 Istilah ID

| ID | Arti | Di DB kita |
|---|---|---|
| `element_id` | ID pemain sepakbola di FPL (berubah tiap musim) | `player_seasons.fpl_element_id` |
| `event_id` | Nomor gameweek 1–38 | `gameweeks.number` |
| `manager_id` (= entry id) | ID tim FPL pengguna; terlihat di URL tab **Points** | `user_fpl_entries.fpl_entry_id` |
| `league_id` | ID mini-league / H2H / liga publik; terlihat di URL tab **Leagues & Cups** | `user_fpl_entries.mini_league_ids` / `h2h_league_ids` |
| `team` / `team_code` | `team` = id 1–20 musim ini; `code` = kode tetap (dipakai untuk badge) | `team_seasons.fpl_team_id` / `teams.fpl_team_code` |

#### 6.2.2 Endpoint publik (tanpa login)

| # | Endpoint | Isi | Dipakai untuk | Frekuensi |
|---|---|---|---|---|
| 1 | `bootstrap-static/` | elements (pemain), teams, events (GW + deadline), element_types, chips, phases, game_settings | master data, harga, status, deadline, aturan | tiap 30 menit; tiap 5 menit di H-1 deadline |
| 2 | `fixtures/` | semua laga musim; laga lampau berisi stats per laga | kalender, deteksi perubahan jadwal | tiap 15 menit |
| 3 | `fixtures/?event={event_id}` | laga satu GW | refresh cepat GW berjalan | tiap 5 menit saat GW live |
| 4 | `element-summary/{element_id}/` | riwayat per laga musim ini, fixtures mendatang, ringkasan musim-musim lalu | `player_fpl_gw_stats`, history | harian (batch, throttled) |
| 5 | `event/{event_id}/live/` | statistik & poin semua pemain di GW tersebut | live points, BPS, DefCon live | tiap 60 detik saat laga berlangsung |
| 6 | `event-status/` | status penambahan bonus poin & update liga untuk GW berjalan | **penanda kapan bonus sudah dikonfirmasi dan kapan GW final** → memicu `gw_finalize` & evaluasi model | tiap 10 menit pada hari laga & pagi hari setelahnya |
| 7 | `dream-team/{event_id}/` | Dream Team GW | fitur GW Review + evaluasi (apakah model menangkap pemain terbaik) | sekali setelah GW final |
| 8 | `team/set-piece-notes/` | catatan eksekutor set-piece tiap tim (dari tim FPL) | **sumber utama `set_piece_roles`** (penalti, FK, corner) + diff untuk alert perubahan | harian + saat H-1 deadline |
| 9 | `entry/{manager_id}/` | ringkasan tim pengguna (nama, rank, nilai tim, bank GW terakhir) | profil tim | saat login / harian |
| 10 | `entry/{manager_id}/history/` | `current` per GW, `past` musim lalu, `chips` terpakai | chip tersisa, grafik rank | harian |
| 11 | `entry/{manager_id}/transfers/` | semua transfer musim ini (harga beli/jual tiap transfer) | **menghitung harga jual (selling price)** tanpa login | harian + setelah deadline |
| 12 | `entry/{manager_id}/event/{event_id}/picks/` | 15 pemain, kapten, vice, chip aktif, `entry_history` (bank, transfer, hit) | skuad pengguna & skuad rival | setelah deadline; saat live untuk rival |
| 13 | `leagues-classic/{league_id}/standings/` | klasemen mini-league; query opsional `page_standings`, `page_new_entries`, `phase` | rival tracker | tiap 5 menit saat live (paginasi) |
| 14 | `leagues-h2h-matches/league/{league_id}/?page={n}` | pertandingan liga Head-to-Head | dukungan liga H2H | tiap 15 menit saat live |
| 15 | `league/{league_id}/cup-status/` | status FPL Cup untuk liga | info cup | harian |
| 16 | `stats/most-valuable-teams/` | 5 tim FPL bernilai tertinggi | opsional, trivia | mingguan |

> Catatan: di artikel rujukan, endpoint "Best Leagues" ditulis dengan URL yang sama persis dengan "Most Valuable Teams" (kemungkinan salah salin). Jangan diimplementasikan sampai path yang benar diverifikasi langsung dari Network tab situs FPL.

#### 6.2.3 Endpoint yang butuh login (opsional)

| Endpoint | Isi | Nilai tambah |
|---|---|---|
| `me/` | data akun yang sedang login | validasi bahwa cookie masih aktif |
| `my-team/{manager_id}/` | skuad **saat ini** (termasuk transfer yang belum terkunci), harga jual resmi, status chip, info transfer GW ini | sinkron skuad real-time sebelum deadline tanpa menunggu deadline lewat |
| `entry/{manager_id}/transfers-latest/` | transfer di GW terakhir yang sudah selesai (bukan transfer yang sedang berjalan) | rekonsiliasi |

Autentikasi endpoint ini **bukan API key resmi**, melainkan cookie sesi browser dari akun FPL yang sedang login. Siapa pun yang memegang cookie itu bisa bertindak sebagai akun tersebut. Karena itu:

- **Default aplikasi: mode publik (tanpa login).** Semua fitur inti harus jalan hanya dengan endpoint publik.
- Skuad sebelum deadline diambil dari `picks` GW sebelumnya + transfer yang Anda masukkan manual di Transfer Planner (aplikasi tidak pernah melakukan transfer di FPL).
- **Harga jual dihitung sendiri** dari `entry/{id}/transfers/` + `price_snapshots`: jika harga naik, harga jual = harga beli + floor((harga sekarang − harga beli) / 2) dalam satuan £0.1m; jika turun, harga jual = harga sekarang. Simpan di `user_squad_picks.selling_price_tenths`.
- **Mode login (opsional, nonaktif default):** cookie disimpan hanya sebagai secret di worker (`FPL_SESSION_COOKIE`), dienkripsi bila disimpan di DB, tidak pernah dikirim ke browser, dan hanya dipakai untuk endpoint read-only di atas. Jika `me/` gagal (cookie kedaluwarsa), aplikasi otomatis kembali ke mode publik dan memberi notifikasi. Mekanisme login FPL bisa berubah sewaktu-waktu, jadi fitur ini diperlakukan sebagai bonus, bukan fondasi.

#### 6.2.4 Catatan teknis

- **CORS:** API FPL tidak bisa dipanggil langsung dari browser/front end. Semua panggilan FPL wajib lewat worker (atau route handler server-side Next.js), lalu hasilnya disimpan ke DB/Redis untuk dibaca UI.
- Set header `User-Agent` yang wajar; batasi ±1 request/detik; cache agresif; backoff saat 429/503 (FPL sering menolak request di jam deadline dan saat update GW, dan menampilkan status "game is being updated").
- API ini tidak resmi; bungkus dengan adapter + contract test berbasis sampel JSON di `tests/fixtures/fpl/` agar perubahan field cepat ketahuan.
- Fitur 2026/27 seperti projected bonus real-time dibaca dari `event/{gw}/live/` (cek field yang tersedia saat implementasi; jangan diasumsikan).
- Paginasi: `leagues-classic` mengembalikan halaman berisi ±50 entri dengan flag `has_next`; loop sampai habis untuk liga kecil, batasi halaman pertama untuk liga publik besar.

### 6.3 Foto pemain & badge klub

- FPL `elements[].photo` berisi nama file (mis. `"223094.jpg"`) dan `elements[].code` berisi kode pemain.
- Pola CDN Premier League **berubah antar musim**. Simpan pola URL di config, bukan di kode:

```env
# contoh — verifikasi pola terbaru saat implementasi (buka satu URL di browser)
PLAYER_PHOTO_URL_TEMPLATE=https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png
PLAYER_PHOTO_FALLBACK_TEMPLATE=https://resources.premierleague.com/premierleague/photos/players/250x250/p{code}.png
TEAM_BADGE_URL_TEMPLATE=https://resources.premierleague.com/premierleague/badges/70/t{team_code}.png
```

- Komponen `<PlayerHeadshot>`: coba template utama → fallback → avatar inisial dengan warna klub. Crop **kepala saja** dengan `object-position: top` dalam lingkaran (lihat 11.4).
- Simpan URL yang berhasil di kolom `players.photo_url_resolved` agar tidak dicoba ulang.
- Gambar tidak disimpan di repo; boleh di-cache di Supabase Storage untuk performa (pemakaian pribadi).

### 6.4 Checklist API key yang perlu Anda siapkan

| Key | Daftar di | Paket yang disarankan | Wajib di fase |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | Mulai **gratis** (model Flash); aktifkan billing hanya jika ingin Argon (lihat 10.0) | Fase 2 |
| `API_FOOTBALL_KEY` | dashboard.api-football.com (api-sports.io) | Pro (rate limit cukup untuk live polling) | Fase 1 |
| `SPORTMONKS_API_TOKEN` | sportmonks.com | Plan yang mencakup PL + UCL + xG add-on | Fase 4 (opsional) |
| `ODDS_API_KEY` | the-odds-api.com | Free dulu, naik jika butuh player props | Fase 2 |
| `GNEWS_API_KEY` atau `NEWSAPI_KEY` | gnews.io / newsapi.org | Free tier | Fase 2 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`), `SUPABASE_SECRET_KEY` (`sb_secret_…`), `DATABASE_URL` | supabase.com | Free → Pro bila data besar | Fase 1 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | upstash.com | Free | Fase 3 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | dibuat dengan `npx web-push generate-vapid-keys` | — | Fase 3 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather | — | Fase 3 (opsional) |
| `FPL_TEAM_ID` | ID tim Anda (angka di URL halaman poin FPL) | — | Fase 1 |

> Model Gemini: lihat **Bagian 10.0** untuk mode gratis (Flash) vs berbayar (Argon). Semua nama model lewat env (`GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_PREMIUM_MODEL`) agar mudah diganti.
>
> **Supabase:** koneksi *Direct* (`db.<ref>.supabase.co:5432`) hanya lewat IPv6. Untuk worker di Railway/Fly dan untuk Vercel, pakai string **Session pooler** (Dashboard → Connect → Session pooler) sebagai `DATABASE_URL`. Kunci `sb_publishable_…` aman di front end; kunci `sb_secret_…` dan password DB hanya untuk worker dan tidak boleh masuk repo.

---

## 7. Arsitektur Sistem

### 7.1 Gambaran besar

```mermaid
flowchart LR
    subgraph EXT["Sumber Eksternal"]
        FPL["FPL API"]
        APIF["API-Football"]
        UND["Understat"]
        SPM["Sportmonks (opsional)"]
        ODDS["The Odds API"]
        NEWS["RSS + GNews"]
        WX["Open-Meteo"]
        ELO["Club Elo"]
    end

    subgraph WORKER["services/worker (Python, Railway/Fly)"]
        SCH["APScheduler<br/>job terjadwal + job dinamis deadline"]
        ING["Ingestion Adapters<br/>rate-limit, retry, raw cache"]
        FE["Feature Builder<br/>arketipe, gaya tim, rotasi, matchup"]
        MDL["Model Engine<br/>xMins, Poisson, DefCon, BPS, Monte Carlo"]
        OPT["Optimizer (PuLP)<br/>transfer, kapten, chip"]
        AIO["AI Orchestrator<br/>Gemini 4 Argon + Search grounding"]
        LIVE["Live Poller<br/>event/live + API-Football events"]
        API["FastAPI<br/>endpoint internal + webhook"]
    end

    subgraph DATA["Supabase"]
        PG[("PostgreSQL")]
        RT["Realtime"]
        ST["Storage<br/>cache foto, export"]
        AUTH["Auth"]
    end

    REDIS[("Upstash Redis<br/>cache + lock + pubsub")]
    GEM["Gemini API<br/>gemini-4-argon"]

    subgraph WEB["apps/web (Next.js PWA, Vercel)"]
        UI["UI Mobile + Desktop"]
        BFF["Route Handlers / Server Actions"]
        PUSH["Web Push"]
    end

    TG["Telegram Bot (opsional)"]

    EXT --> ING
    SCH --> ING
    SCH --> FE
    SCH --> MDL
    SCH --> AIO
    ING --> PG
    FE --> PG
    MDL --> PG
    OPT --> PG
    AIO <--> GEM
    AIO --> PG
    LIVE --> REDIS
    LIVE --> PG
    PG --> RT
    RT --> UI
    UI --> BFF
    BFF --> PG
    BFF --> API
    API --> OPT
    AIO --> PUSH
    AIO --> TG
    AUTH --> UI
```

### 7.2 Alasan pemilihan

| Komponen | Pilihan | Alasan |
|---|---|---|
| Frontend | Next.js PWA | Satu kode untuk HP & PC, bisa di-install ke home screen, mendukung push |
| Worker | Python | Ekosistem data & ML (pandas, LightGBM, PuLP, scipy) paling matang |
| Scheduler | APScheduler (in-process, persistent jobstore di Postgres) | Butuh job dinamis presisi menit (T-60 dari deadline), bukan cron statis |
| DB | Supabase Postgres | SQL kuat untuk analitik, Realtime untuk live, Auth & Storage satu paket |
| Cache | Upstash Redis | Lock antar job, cache respons API, pubsub skor live |
| AI | Gemini 4 Argon | Penalaran panjang, konteks besar (bisa kirim seluruh data GW sekaligus), grounding Google Search untuk berita terkini |

### 7.3 Alur data mingguan

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler
    participant I as Ingestion
    participant DB as Postgres
    participant F as Feature Builder
    participant M as Model Engine
    participant G as Gemini Argon
    participant U as User (PWA)

    S->>I: GW selesai (skor final 09:00 UK)
    I->>DB: simpan statistik final, poin, harga
    S->>M: evaluasi model GW lalu
    S->>F: hitung ulang arketipe, gaya tim, rotasi, matchup
    F->>DB: features_* tersimpan
    S->>M: proyeksi GW berikut (Monte Carlo)
    M->>DB: projections
    S->>G: kirim data terstruktur + berita
    G-->>DB: alasan, skenario, risiko (JSON tervalidasi)
    DB-->>U: Draft rekomendasi (Realtime)
    loop T-48h, T-24h, T-6h, T-2h
        S->>I: refresh berita + status FPL + odds
        S->>M: proyeksi ulang jika ada perubahan material
        S->>G: update alasan
    end
    S->>I: T-60 menit: sweep penuh berita & status
    S->>M: proyeksi final
    S->>G: Deadline Audit Report
    G-->>U: Push notification + laporan final
```

---

## 8. Desain Database

### 8.1 ERD inti

```mermaid
erDiagram
    seasons ||--o{ gameweeks : has
    seasons ||--o{ team_seasons : has
    competitions ||--o{ fixtures : hosts
    gameweeks ||--o{ fixtures : contains
    teams ||--o{ team_seasons : plays
    teams ||--o{ fixtures : home_away
    managers ||--o{ manager_tenures : has
    teams ||--o{ manager_tenures : employs
    players ||--o{ player_seasons : registered
    teams ||--o{ player_seasons : squad
    players ||--o{ player_external_ids : maps
    teams ||--o{ team_external_ids : maps
    fixtures ||--o{ fixture_changes : history
    fixtures ||--o{ lineups : has
    fixtures ||--o{ player_match_stats : produces
    fixtures ||--o{ team_match_stats : produces
    fixtures ||--o{ match_events : produces
    fixtures ||--o{ odds_snapshots : priced
    fixtures ||--o| fixture_conditions : weather_ref
    players ||--o{ player_match_stats : records
    players ||--o{ player_fpl_gw_stats : scores
    players ||--o{ player_status_snapshots : status
    players ||--o{ price_snapshots : price
    players ||--o{ player_archetypes : classified
    teams ||--o{ team_style_profiles : has_style
    managers ||--o{ manager_profiles : profile
    players ||--o{ teammate_effects : effect
    fixtures ||--o{ matchup_edges : matchup
    news_items ||--o{ news_entities : mentions
    players ||--o{ projections : projected
    fixtures ||--o{ projections : for_fixture
    model_runs ||--o{ projections : generated
    gameweeks ||--o{ analysis_reports : report
    analysis_reports ||--o{ recommendations : contains
    recommendations ||--o{ recommendation_reasons : explains
    evidence ||--o{ recommendation_reasons : supports
    users ||--o{ user_fpl_entries : owns
    user_fpl_entries ||--o{ user_squad_picks : picks
    users ||--o{ notifications : receives
    users ||--o{ push_subscriptions : devices

    players {
        bigint id PK
        text full_name
        text web_name
        int fpl_code
        text photo_url_resolved
        date birth_date
        text preferred_foot
        int height_cm
    }
    fixtures {
        bigint id PK
        int competition_id FK
        int gameweek_id FK
        bigint home_team_id FK
        bigint away_team_id FK
        timestamptz kickoff_utc
        text status
        int home_goals
        int away_goals
    }
    projections {
        bigint id PK
        bigint player_id FK
        bigint fixture_id FK
        bigint model_run_id FK
        numeric xmins
        numeric p_start
        numeric xpts
        numeric p10
        numeric p90
    }
    recommendations {
        bigint id PK
        bigint report_id FK
        text rec_type
        bigint player_id FK
        int rank
        numeric xpts
        numeric confidence
    }
```

### 8.2 DDL acuan konsep

> **SQL final yang dijalankan ada di `docs/INFRA_BLUEPRINT.md` Bagian 5** (migrasi Supabase, sudah diuji, termasuk RLS, Realtime, Storage, dan tabel tambahan). DDL di bawah adalah versi konsep awal untuk memahami model data.

```sql
-- =========================================================
-- 0. EXTENSIONS & UTIL
-- =========================================================
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;   -- pencarian nama pemain fuzzy

-- =========================================================
-- 1. MASTER DATA
-- =========================================================
create table seasons (
    id            serial primary key,
    label         text not null unique,          -- '2026/27'
    start_date    date not null,
    end_date      date not null,
    is_current    boolean not null default false
);

create table competitions (
    id            serial primary key,
    code          text not null unique,          -- 'PL','UCL','UEL','UECL','FAC','EFLC','CHAMP'
    name          text not null,
    weight        numeric(4,2) not null default 1.0,  -- bobot analisis (Bagian 4.2.2)
    is_cup        boolean not null default false
);

create table teams (
    id            bigserial primary key,
    name          text not null,
    short_name    text,
    country       text,
    fpl_team_code int,                            -- 'code' di bootstrap-static (untuk badge)
    stadium_name  text,
    stadium_lat   numeric(9,6),
    stadium_lon   numeric(9,6),
    primary_color text,
    secondary_color text
);

create table team_external_ids (
    team_id       bigint not null references teams(id) on delete cascade,
    source        text   not null,                -- 'fpl','api_football','understat','sportmonks','clubelo','odds_api'
    external_id   text   not null,
    primary key (source, external_id)
);
create index on team_external_ids(team_id);

create table team_seasons (
    team_id       bigint not null references teams(id),
    season_id     int    not null references seasons(id),
    fpl_team_id   int,                            -- id 1..20 di FPL musim itu
    league_code   text   not null default 'PL',
    is_promoted   boolean not null default false,
    primary key (team_id, season_id)
);

create table managers (
    id            bigserial primary key,
    full_name     text not null,
    nationality   text,
    birth_date    date,
    api_football_id int unique
);

create table manager_tenures (
    id            bigserial primary key,
    manager_id    bigint not null references managers(id),
    team_id       bigint not null references teams(id),
    start_date    date not null,
    end_date      date,                           -- null = masih menjabat
    role          text not null default 'head_coach',  -- 'head_coach','interim'
    source_url    text
);
create index on manager_tenures(team_id, start_date desc);

create table players (
    id            bigserial primary key,
    full_name     text not null,
    web_name      text not null,
    birth_date    date,
    nationality   text,
    preferred_foot text,                          -- 'left','right','both'
    height_cm     int,
    fpl_code      int unique,                     -- 'code' di bootstrap-static (untuk foto)
    photo_file    text,                           -- 'photo' di bootstrap-static
    photo_url_resolved text,
    created_at    timestamptz not null default now()
);
create index players_name_trgm on players using gin (full_name gin_trgm_ops);

create table player_external_ids (
    player_id     bigint not null references players(id) on delete cascade,
    source        text   not null,
    external_id   text   not null,
    match_confidence numeric(3,2) not null default 1.0,  -- hasil entity matching
    primary key (source, external_id)
);
create index on player_external_ids(player_id);

create table player_seasons (
    player_id     bigint not null references players(id),
    season_id     int    not null references seasons(id),
    team_id       bigint references teams(id),
    fpl_element_id int,                            -- id pemain FPL musim itu
    fpl_position  text check (fpl_position in ('GKP','DEF','MID','FWD')),
    real_position text,                           -- 'RW','LCB','DM', dst
    shirt_number  int,
    joined_on     date,
    left_on       date,
    primary key (player_id, season_id, team_id)
);
create unique index on player_seasons(season_id, fpl_element_id) where fpl_element_id is not null;

-- =========================================================
-- 2. KALENDER & FIXTURE (+ riwayat perubahan jadwal)
-- =========================================================
create table gameweeks (
    id            serial primary key,
    season_id     int not null references seasons(id),
    number        int not null,                   -- 1..38
    deadline_utc  timestamptz not null,
    is_current    boolean not null default false,
    is_next       boolean not null default false,
    is_finished   boolean not null default false,
    scores_final_at timestamptz,
    is_blank      boolean not null default false, -- dihitung: ada tim tanpa laga
    is_double     boolean not null default false, -- dihitung: ada tim 2 laga
    unique (season_id, number)
);

create table fixtures (
    id            bigserial primary key,
    season_id     int not null references seasons(id),
    competition_id int not null references competitions(id),
    gameweek_id   int references gameweeks(id),   -- null utk non-PL atau laga PL yang ditunda (blank)
    round_label   text,                           -- 'League Phase MD3', 'Round 4', dll
    home_team_id  bigint not null references teams(id),
    away_team_id  bigint not null references teams(id),
    kickoff_utc   timestamptz,                    -- null = TBC
    venue         text,
    status        text not null default 'scheduled', -- scheduled|live|ht|finished|postponed|cancelled|tbc
    minute        int,
    home_goals    int,
    away_goals    int,
    referee_id    bigint,
    fpl_fixture_id int,
    api_football_fixture_id bigint unique,
    understat_match_id bigint,
    difficulty_home int,                          -- FDR FPL
    difficulty_away int,
    custom_difficulty_home numeric(4,2),          -- FDR internal dari model
    custom_difficulty_away numeric(4,2),
    updated_at    timestamptz not null default now()
);
create index on fixtures(gameweek_id);
create index on fixtures(kickoff_utc);
create index on fixtures(home_team_id, kickoff_utc);
create index on fixtures(away_team_id, kickoff_utc);

create table fixture_changes (
    id            bigserial primary key,
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    detected_at   timestamptz not null default now(),
    change_type   text not null,                  -- kickoff_moved|gameweek_moved|postponed|rescheduled|venue_changed|status_changed
    old_value     jsonb,
    new_value     jsonb,
    source        text not null,
    reason        text,                           -- mis. 'bentrok FA Cup', 'siaran TV'
    notified      boolean not null default false
);
create index on fixture_changes(fixture_id, detected_at desc);

create table referees (
    id            bigserial primary key,
    name          text not null unique,
    avg_yellow    numeric(4,2),
    avg_red       numeric(4,3),
    avg_penalties numeric(4,3),
    matches_count int
);
alter table fixtures add constraint fixtures_referee_fk foreign key (referee_id) references referees(id);

create table fixture_conditions (
    fixture_id    bigint primary key references fixtures(id) on delete cascade,
    temperature_c numeric(4,1),
    precipitation_mm numeric(5,2),
    wind_kph      numeric(5,1),
    condition_label text,
    fetched_at    timestamptz not null default now()
);

-- =========================================================
-- 3. DATA PERTANDINGAN
-- =========================================================
create table lineups (
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    team_id       bigint not null references teams(id),
    player_id     bigint not null references players(id),
    is_starter    boolean not null,
    formation     text,                           -- '4-3-3'
    grid_position text,                           -- '2:3' dari API-Football (baris:kolom)
    position_label text,                          -- 'RW','DM'
    minute_on     int,
    minute_off    int,
    is_confirmed  boolean not null default true,  -- false = prediksi/bocoran
    source        text not null,
    primary key (fixture_id, player_id)
);

create table player_match_stats (
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    player_id     bigint not null references players(id),
    team_id       bigint not null references teams(id),
    source        text not null,                  -- 'api_football','understat','sportmonks','fpl'
    minutes       int,
    goals         int, assists int,
    shots         int, shots_on_target int,
    xg            numeric(6,3), npxg numeric(6,3), xa numeric(6,3),
    key_passes    int,
    big_chances_created int, big_chances_missed int,
    passes        int, pass_accuracy numeric(5,2),
    crosses       int, crosses_accurate int,
    dribbles_attempted int, dribbles_success int,
    touches       int, touches_in_box int,
    progressive_passes int, progressive_carries int,
    tackles       int, tackles_won int,
    interceptions int, clearances int, blocks int, recoveries int,
    duels         int, duels_won int,
    aerials       int, aerials_won int,
    dribbled_past int,
    fouls_committed int, fouls_drawn int,
    yellow_cards  int, red_cards int,
    saves         int, goals_conceded int,
    penalties_won int, penalties_scored int, penalties_missed int, penalties_saved int,
    rating        numeric(4,2),
    extra         jsonb not null default '{}'::jsonb,   -- metrik provider lain
    primary key (fixture_id, player_id, source)
);
create index on player_match_stats(player_id);

create table team_match_stats (
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    team_id       bigint not null references teams(id),
    source        text not null,
    possession    numeric(5,2),
    xg            numeric(6,3), xga numeric(6,3),
    shots         int, shots_on_target int,
    ppda          numeric(6,2),                   -- Understat
    deep_completions int,                         -- Understat
    passes        int, pass_accuracy numeric(5,2),
    corners       int, crosses int,
    fast_break_shots int,
    set_piece_xg  numeric(6,3),
    extra         jsonb not null default '{}'::jsonb,
    primary key (fixture_id, team_id, source)
);

create table match_events (
    id            bigserial primary key,
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    minute        int not null,
    extra_minute  int,
    team_id       bigint references teams(id),
    player_id     bigint references players(id),
    related_player_id bigint references players(id),   -- assist / pemain keluar
    event_type    text not null,                  -- goal|own_goal|penalty_goal|penalty_miss|card_yellow|card_red|sub|var
    detail        text,
    source        text not null,
    received_at   timestamptz not null default now()
);
create index on match_events(fixture_id, minute);

create table shots (
    id            bigserial primary key,
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    player_id     bigint references players(id),
    team_id       bigint references teams(id),
    minute        int,
    x             numeric(5,3), y numeric(5,3),   -- koordinat 0..1 (Understat)
    xg            numeric(6,4),
    result        text,                           -- Goal|SavedShot|MissedShots|BlockedShot|ShotOnPost
    situation     text,                           -- OpenPlay|FromCorner|SetPiece|DirectFreekick|Penalty
    shot_type     text,                           -- RightFoot|LeftFoot|Head
    last_action   text,                           -- Cross|Pass|Dribble|Rebound dll (deteksi cutback)
    assist_player_id bigint references players(id),
    source        text not null default 'understat'
);
create index on shots(player_id);

-- =========================================================
-- 4. DATA FPL
-- =========================================================
create table fpl_scoring_rules (
    season_id     int not null references seasons(id),
    rule_key      text not null,                  -- 'goal_DEF','assist','cs_MID','defcon_DEF_threshold', dst
    value         numeric not null,
    notes         text,
    primary key (season_id, rule_key)
);

create table player_fpl_gw_stats (
    player_id     bigint not null references players(id),
    fixture_id    bigint not null references fixtures(id),
    gameweek_id   int not null references gameweeks(id),
    minutes       int, total_points int, bonus int, bps int,
    goals_scored  int, assists int, clean_sheets int, goals_conceded int,
    own_goals     int, penalties_saved int, penalties_missed int,
    yellow_cards  int, red_cards int, saves int,
    defensive_contribution int,                   -- angka CBIT/CBIRT
    defcon_points int,
    expected_goals numeric(6,3), expected_assists numeric(6,3),
    expected_goal_involvements numeric(6,3), expected_goals_conceded numeric(6,3),
    influence numeric(6,1), creativity numeric(6,1), threat numeric(6,1), ict_index numeric(6,1),
    value_tenths  int,                            -- harga saat laga (x10)
    selected      int,
    is_final      boolean not null default false,
    updated_at    timestamptz not null default now(),
    primary key (player_id, fixture_id)
);
create index on player_fpl_gw_stats(gameweek_id);

create table player_status_snapshots (
    id            bigserial primary key,
    player_id     bigint not null references players(id),
    captured_at   timestamptz not null default now(),
    status        text,                           -- a|d|i|s|u|n (FPL)
    chance_next   int,                            -- chance_of_playing_next_round
    chance_this   int,
    news          text,
    news_added_utc timestamptz
);
create index on player_status_snapshots(player_id, captured_at desc);

create table price_snapshots (
    player_id     bigint not null references players(id),
    captured_on   date not null,
    price_tenths  int not null,
    selected_by_pct numeric(5,2),
    transfers_in_event int,
    transfers_out_event int,
    price_change_progress numeric(6,2),           -- dari Price Change Predictor bila tersedia
    primary key (player_id, captured_on)
);

create table set_piece_roles (
    team_id       bigint not null references teams(id),
    season_id     int not null references seasons(id),
    role          text not null,                  -- penalty|direct_fk|indirect_fk|corner_left|corner_right
    player_id     bigint not null references players(id),
    order_rank    int not null,
    source        text not null,                  -- fpl_set_piece_notes|news|derived
    note_text     text,                           -- teks asli dari team/set-piece-notes/
    updated_at    timestamptz not null default now(),
    primary key (team_id, season_id, role, order_rank)
);

-- =========================================================
-- 5. FITUR ANALITIK (hasil Feature Builder)
-- =========================================================
create table player_archetypes (
    player_id     bigint not null references players(id),
    season_id     int not null references seasons(id),
    computed_at   timestamptz not null default now(),
    archetype     text not null,                  -- 'inverted_winger','poacher',...
    membership    numeric(4,3) not null,          -- 0..1
    is_primary    boolean not null default false,
    feature_vector jsonb not null,                -- metrik per90 ter-adjust yang dipakai
    description_id text,                          -- narasi Gemini (ID)
    confidence    numeric(4,3),
    primary key (player_id, season_id, archetype, computed_at)
);

create table player_form_features (
    player_id     bigint not null references players(id),
    as_of         timestamptz not null,
    window_label  text not null,                  -- 'last4','last8','season','all_comps_120d'
    metrics       jsonb not null,                 -- xg90, xa90, npxg90, cbit90, minutes_share, dst (shrunk)
    sample_minutes int not null,
    primary key (player_id, as_of, window_label)
);

create table team_style_profiles (
    team_id       bigint not null references teams(id),
    as_of         timestamptz not null,
    manager_id    bigint references managers(id),
    window_label  text not null,
    metrics       jsonb not null,                 -- possession, ppda, field_tilt, direct_speed, xg_from_crosses, ...
    style_tags    jsonb not null,                 -- {"high_press":0.82,"possession":0.71,"low_block":0.05}
    weaknesses    jsonb not null default '{}'::jsonb, -- {"xga_from_crosses_pct":0.34,"left_flank_xga":0.6}
    formation_usage jsonb,
    narrative_id  text,
    primary key (team_id, as_of, window_label)
);

create table manager_profiles (
    manager_id    bigint not null references managers(id),
    as_of         timestamptz not null,
    rotation_index numeric(5,2),
    post_europe_rotation numeric(5,2),
    minutes_gini  numeric(4,3),
    avg_first_sub_minute numeric(4,1),
    pct_starters_off_before_60 numeric(4,3),
    early_sub_when_leading numeric(4,3),
    youth_minutes_share numeric(4,3),
    preferred_formations jsonb,
    style_prior   jsonb,                          -- style tags rata-rata dari tenure sebelumnya
    narrative_id  text,
    primary key (manager_id, as_of)
);

create table teammate_effects (
    player_id     bigint not null references players(id),
    teammate_id   bigint not null references players(id),
    season_scope  text not null,                  -- '2026/27' atau 'rolling_365d'
    metric        text not null,                  -- 'xg90','xa90','xpts90'
    with_value    numeric(8,4), without_value numeric(8,4),
    delta         numeric(8,4), ci_low numeric(8,4), ci_high numeric(8,4),
    minutes_with  int, minutes_without int,
    computed_at   timestamptz not null default now(),
    primary key (player_id, teammate_id, season_scope, metric)
);

create table matchup_edges (
    id            bigserial primary key,
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    player_id     bigint not null references players(id),
    opponent_player_id bigint references players(id),
    zone          text,                           -- 'left_flank','zone14','box','aerial'
    tier          char(1) not null check (tier in ('A','B','C')),
    edge_score    numeric(4,3) not null,          -- -1..+1 (positif = menguntungkan pemain kita)
    sample_minutes int,
    detail        jsonb,
    computed_at   timestamptz not null default now()
);
create unique index matchup_edges_uniq
    on matchup_edges (fixture_id, player_id, coalesce(opponent_player_id, 0), coalesce(zone, ''));

create table fixture_context (
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    team_id       bigint not null references teams(id),
    days_rest     numeric(4,1),
    matches_last_14d int,
    europe_midweek_before boolean,
    travel_km_last_match numeric(7,1),
    style_clash   jsonb,                          -- skor interaksi gaya
    h2h_summary   jsonb,                          -- 5 laga terakhir + bobot
    team_elo      numeric(7,2),
    opp_elo       numeric(7,2),
    is_derby      boolean default false,
    computed_at   timestamptz not null default now(),
    primary key (fixture_id, team_id)
);

-- =========================================================
-- 6. PASAR & BERITA
-- =========================================================
create table odds_snapshots (
    id            bigserial primary key,
    fixture_id    bigint not null references fixtures(id) on delete cascade,
    captured_at   timestamptz not null default now(),
    bookmaker     text not null,
    market        text not null,                  -- h2h|totals|btts|player_goal_scorer_anytime|clean_sheet
    selection     text not null,                  -- 'home','over_2.5', nama pemain, dll
    player_id     bigint references players(id),
    price_decimal numeric(8,3) not null,
    implied_prob  numeric(6,5) not null           -- sudah dikoreksi overround
);
create index on odds_snapshots(fixture_id, market, captured_at desc);

create table news_items (
    id            bigserial primary key,
    url           text unique,
    source        text not null,                  -- 'bbc_rss','club_site','gnews','gemini_grounding','fpl_news'
    title         text,
    published_at  timestamptz,
    fetched_at    timestamptz not null default now(),
    raw_text      text,
    lang          text default 'en',
    content_hash  text,
    processed     boolean not null default false
);

create table news_entities (
    id            bigserial primary key,
    news_id       bigint not null references news_items(id) on delete cascade,
    player_id     bigint references players(id),
    team_id       bigint references teams(id),
    manager_id    bigint references managers(id),
    signal_type   text not null,                  -- injury|illness|suspension|rotation_hint|manager_conflict|manager_change|transfer|return_to_training|lineup_leak|other
    severity      text,
    expected_absence text,
    confidence    numeric(4,3),
    summary_id    text,
    extracted_by  text not null,                  -- nama model
    created_at    timestamptz not null default now()
);
create index on news_entities(player_id, created_at desc);

-- =========================================================
-- 7. MODEL, PROYEKSI & REKOMENDASI
-- =========================================================
create table model_runs (
    id            bigserial primary key,
    gameweek_id   int not null references gameweeks(id),
    run_type      text not null,                  -- weekly|t48|t24|t6|t2|t60|adhoc
    model_version text not null,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    status        text not null default 'running',
    input_hash    text,                           -- hash data input, untuk deteksi 'tidak ada perubahan'
    notes         jsonb
);

create table projections (
    id            bigserial primary key,
    model_run_id  bigint not null references model_runs(id) on delete cascade,
    player_id     bigint not null references players(id),
    fixture_id    bigint not null references fixtures(id),
    p_start       numeric(5,4), p_60 numeric(5,4), xmins numeric(5,2),
    xg            numeric(6,4), xa numeric(6,4),
    p_goal        numeric(5,4), p_assist numeric(5,4),
    p_cs          numeric(5,4), p_defcon numeric(5,4),
    xbonus        numeric(5,3), xsaves numeric(5,3),
    xpts          numeric(6,3) not null,
    p10 numeric(5,2), p50 numeric(5,2), p90 numeric(5,2),
    p_haul        numeric(5,4),                   -- P(>=10)
    p_blank       numeric(5,4),                   -- P(<=2)
    component_breakdown jsonb,                    -- kontribusi tiap komponen
    shap_top      jsonb,                          -- fitur penyumbang terbesar
    unique (model_run_id, player_id, fixture_id)
);
create index on projections(player_id);

create table model_evaluations (
    gameweek_id   int not null references gameweeks(id),
    model_version text not null,
    metric        text not null,                  -- mae_xpts|brier_start|brier_cs|brier_goal|calibration
    value         numeric not null,
    detail        jsonb,
    primary key (gameweek_id, model_version, metric)
);

create table evidence (
    id            bigserial primary key,
    kind          text not null,                  -- stat|matchup|teammate|tactic|news|odds|fixture
    ref_table     text,
    ref_key       jsonb,                          -- PK baris sumber
    payload       jsonb not null,                 -- snapshot nilai yang dirujuk
    created_at    timestamptz not null default now()
);

create table analysis_reports (
    id            bigserial primary key,
    gameweek_id   int not null references gameweeks(id),
    model_run_id  bigint references model_runs(id),
    report_type   text not null,                  -- weekly_draft|deadline_t60|player_deep_dive|team_tactics|gw_review
    status        text not null default 'ok',     -- ok|degraded|failed
    title         text,
    content_md    text,                           -- laporan untuk dibaca
    content_json  jsonb,                          -- versi terstruktur
    ai_model      text,
    created_at    timestamptz not null default now()
);

create table recommendations (
    id            bigserial primary key,
    report_id     bigint not null references analysis_reports(id) on delete cascade,
    user_id       uuid,                           -- null = rekomendasi umum
    rec_type      text not null,                  -- transfer_in|transfer_out|captain|vice|start|bench|differential|chip
    player_id     bigint references players(id),
    paired_player_id bigint references players(id), -- untuk transfer: keluar <-> masuk
    rank          int not null,
    xpts_1gw      numeric(6,3), xpts_3gw numeric(6,3), xpts_6gw numeric(6,3),
    confidence    numeric(4,3),
    scenarios     jsonb,                          -- [{label:'haul',prob:0.22,story:'...'}]
    risk_triggers jsonb,                          -- ['Batalkan jika ...']
    alternatives  jsonb
);

create table recommendation_reasons (
    id            bigserial primary key,
    recommendation_id bigint not null references recommendations(id) on delete cascade,
    category      text not null,                  -- form|fixture|matchup|tactic|teammate|news|market|schedule
    text_id       text not null,                  -- alasan dalam bahasa Indonesia
    weight        numeric(5,3),                   -- kontribusi (dari SHAP) bila ada
    evidence_id   bigint references evidence(id)
);

create table ai_runs (
    id            bigserial primary key,
    task          text not null,                  -- news_extract|archetype_label|team_tactics|recommendation|deadline_audit
    model         text not null,
    prompt_version text not null,
    input_tokens  int, output_tokens int,
    cost_usd      numeric(10,5),
    latency_ms    int,
    grounded      boolean default false,
    status        text not null,
    error         text,
    created_at    timestamptz not null default now()
);

-- =========================================================
-- 8. USER
-- =========================================================
create table users (
    id            uuid primary key,               -- = auth.users.id (Supabase)
    display_name  text,
    timezone      text not null default 'Asia/Jakarta',
    locale        text not null default 'id-ID',
    theme         text not null default 'violet', -- violet|ember|pitch
    risk_profile  text not null default 'balanced', -- safe|balanced|aggressive
    created_at    timestamptz not null default now()
);

create table user_fpl_entries (
    id            bigserial primary key,
    user_id       uuid not null references users(id) on delete cascade,
    fpl_entry_id  int not null,
    team_name     text,
    is_primary    boolean not null default true,
    mini_league_ids int[] default '{}',
    h2h_league_ids int[] default '{}',
    auth_mode     text not null default 'public', -- public|cookie (Bagian 6.2.3)
    unique (user_id, fpl_entry_id)
);

create table user_squad_picks (
    entry_id      bigint not null references user_fpl_entries(id) on delete cascade,
    gameweek_id   int not null references gameweeks(id),
    player_id     bigint not null references players(id),
    slot          int not null,                   -- 1..15
    is_captain    boolean not null default false,
    is_vice       boolean not null default false,
    multiplier    int not null default 1,
    purchase_price_tenths int,
    selling_price_tenths int,
    primary key (entry_id, gameweek_id, slot)
);

create table user_watchlist (
    user_id       uuid not null references users(id) on delete cascade,
    player_id     bigint not null references players(id),
    note          text,
    added_at      timestamptz not null default now(),
    primary key (user_id, player_id)
);

create table notifications (
    id            bigserial primary key,
    user_id       uuid not null references users(id) on delete cascade,
    kind          text not null,                  -- injury_alert|fixture_change|deadline_report|price_change|lineup_confirmed|goal
    title         text not null,
    body          text,
    payload       jsonb,
    channel       text[] not null default '{push}', -- push|telegram|in_app
    sent_at       timestamptz,
    read_at       timestamptz,
    created_at    timestamptz not null default now()
);

create table push_subscriptions (
    id            bigserial primary key,
    user_id       uuid not null references users(id) on delete cascade,
    endpoint      text not null unique,
    p256dh        text not null,
    auth          text not null,
    created_at    timestamptz not null default now()
);

-- =========================================================
-- 9. OPERASIONAL
-- =========================================================
create table raw_payloads (
    id            bigserial primary key,
    source        text not null,
    endpoint      text not null,
    params        jsonb,
    fetched_at    timestamptz not null default now(),
    status_code   int,
    body          jsonb,
    body_hash     text
);
create index on raw_payloads(source, endpoint, fetched_at desc);

create table job_runs (
    id            bigserial primary key,
    job_name      text not null,
    scheduled_for timestamptz,
    started_at    timestamptz not null default now(),
    finished_at   timestamptz,
    status        text not null default 'running', -- running|ok|failed|skipped
    stats         jsonb,
    error         text
);
create index on job_runs(job_name, started_at desc);

create table app_config (
    key           text primary key,
    value         jsonb not null,
    updated_at    timestamptz not null default now()
);
```

### 8.3 View penting

```sql
-- Jadwal GW berikut dalam WIB + penanda perubahan terbaru
create view v_next_gw_fixtures as
select f.id, g.number as gw,
       ht.short_name as home, at.short_name as away,
       (f.kickoff_utc at time zone 'Asia/Jakarta') as kickoff_wib,
       f.status,
       exists (select 1 from fixture_changes c
               where c.fixture_id = f.id and c.detected_at > now() - interval '7 days') as recently_changed
from fixtures f
join gameweeks g on g.id = f.gameweek_id and g.is_next
join teams ht on ht.id = f.home_team_id
join teams at on at.id = f.away_team_id
order by f.kickoff_utc;

-- Proyeksi terbaru per pemain untuk GW berikut
create view v_latest_projections as
select distinct on (p.player_id, p.fixture_id) p.*
from projections p
join model_runs r on r.id = p.model_run_id and r.status = 'ok'
join gameweeks g on g.id = r.gameweek_id and g.is_next
order by p.player_id, p.fixture_id, r.finished_at desc;
```

### 8.4 Entity matching antar sumber

Nama pemain beda-beda antar provider (mis. "Bruno Fernandes" vs "Bruno Miguel Borges Fernandes"). Buat modul `entity_resolver`:
1. Cocokkan klub + tanggal lahir + nomor punggung bila ada.
2. Fuzzy name (pg_trgm / rapidfuzz) ≥ 0.85.
3. Sisanya masuk antrean `unmatched_entities` untuk dicek manual di halaman Admin.

---

## 9. Pipeline Data, Scheduler & Protokol Deadline T-60

### 9.1 Jadwal job

| Job | Jadwal | Isi |
|---|---|---|
| `sync_bootstrap` | tiap 30 menit (tiap 5 menit di 24 jam terakhir sebelum deadline) | pemain, harga, status, GW, deadline |
| `sync_fixtures_all` | tiap 15 menit | fixtures FPL + API-Football (PL, UCL, UEL, UECL, FAC, EFL Cup); **deteksi perubahan jadwal** |
| `sync_player_history` | harian 05:00 UTC | element-summary semua pemain (throttled) |
| `sync_set_piece_notes` | harian + T-6j deadline | `team/set-piece-notes/` → `set_piece_roles`; alert jika eksekutor penalti berubah |
| `sync_user_entry` | harian + setelah deadline | `entry/{id}/`, `history/`, `transfers/`, `picks/` → skuad, chip, harga jual |
| `poll_event_status` | tiap 10 menit di hari laga s/d GW final | `event-status/` → tandai bonus terkonfirmasi & picu `gw_finalize` |
| `sync_match_stats` | 2 jam setelah tiap laga selesai, ulang +24 jam | statistik pemain & tim, shot data Understat |
| `sync_injuries` | tiap 3 jam | cedera API-Football + status FPL |
| `sync_news` | tiap 30 menit (tiap 10 menit di H-1) | RSS + GNews → `news_items` |
| `extract_news` | setelah `sync_news` | Gemini Flash: klasifikasi & ekstraksi entitas |
| `sync_odds` | tiap 6 jam; tiap jam di H-1 | odds semua laga GW berikut |
| `sync_weather` | H-2 dan H-0 tiap laga | Open-Meteo |
| `build_features` | harian 06:00 UTC + setelah GW final | arketipe, form, gaya tim, profil pelatih, teammate effects, matchup, fixture context |
| `run_projections` | setelah `build_features`; dan di setiap checkpoint deadline | model + Monte Carlo |
| `generate_weekly_report` | setelah GW final (±09:30 UK) | Draft rekomendasi GW berikut |
| `deadline_checkpoints` | **dinamis**: T-48j, T-24j, T-6j, T-2j, **T-60m**, T-15m | lihat 9.3 |
| `live_poller` | aktif dari kick-off −15 menit s/d selesai | poin live, event, lineup |
| `lineup_watch` | kick-off −75 s/d −45 menit | lineup terkonfirmasi → notifikasi jika pemain Anda tidak starter |
| `gw_finalize` | dipicu `event-status` (fallback 09:00 UK hari setelah laga terakhir GW) | tandai final, ambil `dream-team/{gw}`, evaluasi model |

### 9.2 Deteksi perubahan jadwal

```mermaid
flowchart TD
    A["sync_fixtures_all"] --> B{"Fixture baru<br/>vs data tersimpan"}
    B -->|kickoff berubah| C["change_type = kickoff_moved"]
    B -->|event/GW berubah| D["change_type = gameweek_moved"]
    B -->|event menjadi null| E["change_type = postponed<br/>tandai GW sebagai blank untuk 2 tim"]
    B -->|status postponed/cancelled| E
    B -->|tidak ada perubahan| Z["selesai"]
    C --> F["insert fixture_changes"]
    D --> F
    E --> F
    F --> G["hitung ulang is_blank / is_double GW"]
    G --> H{"Menyangkut pemain<br/>di skuad / watchlist user?"}
    H -->|ya| I["notifikasi push + Telegram<br/>'Jadwal berubah: lama → baru (WIB)'"]
    H -->|tidak| J["tampilkan badge di halaman Jadwal"]
    I --> K["trigger run_projections jika GW berikut terdampak"]
    J --> K
```

Aturan:
- Bandingkan dua sumber (FPL & API-Football). Jika berbeda, percayai FPL untuk GW, API-Football untuk laga non-PL; catat konflik di `fixture_changes.reason`.
- Jika deadline GW berubah (FPL kadang memajukan deadline), **jadwalkan ulang semua checkpoint deadline**.

### 9.3 Protokol Deadline (strict)

```mermaid
sequenceDiagram
    autonumber
    participant SCH as Scheduler
    participant SRC as Sumber (FPL, API-Football, News, Odds)
    participant G as Gemini Argon (grounded)
    participant M as Model
    participant U as Dilan

    Note over SCH: Deadline D diambil dari gameweeks.deadline_utc
    SCH->>SRC: T-48j / T-24j / T-6j / T-2j: refresh penuh
    SRC-->>SCH: status, cedera, berita, odds
    SCH->>M: proyeksi ulang (hanya jika input_hash berubah)
    SCH-->>U: ringkasan perubahan (jika material)

    Note over SCH: T-60 menit — FINAL AUDIT
    SCH->>SRC: paksa refresh semua (bypass cache)
    SCH->>G: Google Search grounding untuk setiap pemain di skuad + top 30 kandidat:<br/>"berita 48 jam terakhir: cedera, latihan, presser, konflik"
    G-->>SCH: sinyal terstruktur + URL sumber
    SCH->>M: proyeksi final + optimizer
    SCH->>G: Deadline Audit Report (perubahan vs draft, keputusan final, risiko)
    G-->>U: Push "Laporan Final GW{n} siap" + ringkasan 3 baris
    Note over SCH: T-15 menit — hanya kirim alert jika ada berita high severity baru
```

Definisi **perubahan material**: Δ xPts ≥ 0.5 pada pemain di skuad atau top-5 rekomendasi, perubahan status FPL, berita severity high, atau perubahan urutan kapten.

Isi **Laporan Deadline T-60**:
1. Status final 15 pemain Anda (hijau/kuning/merah) + sumber berita.
2. Perubahan sejak draft (apa yang berubah dan kenapa).
3. Keputusan final: transfer, kapten, vice, starting XI, urutan bench, chip.
4. Risiko tersisa & rencana cadangan (mis. "Jika X tidak starter, autosub ke Y").
5. Waktu kick-off semua laga GW dalam WIB.

### 9.4 Live poller

- Satu proses async; ambil `event/{gw}/live/` tiap 60 detik dan event API-Football tiap 15–30 detik untuk laga berlangsung.
- Tulis delta ke Redis pubsub → endpoint SSE `/api/live/stream` di web, dan persist ke `match_events`.
- Hitung poin live tim user, projected bonus, perkiraan autosub, dan rank mini-league.
- Notifikasi in-app untuk gol/assist/kartu pemain di skuad Anda.

---

## 10. Integrasi Gemini 4 Argon & Library Prompt

### 10.0 Mode gratis vs berbayar

Per Oktober 2026, **Gemini 4 Argon tidak tersedia di Free tier Gemini API**; memanggil `gemini-4-argon` lewat API butuh project dengan billing aktif. Mencoba Argon di antarmuka chat AI Studio berbeda dengan aplikasi yang memanggil API. Model Flash (mis. `gemini-3.8-flash`) punya free tier. Aplikasi dirancang dengan dua mode:

| Mode | `AI_TIER` | `GEMINI_MODEL` (tugas berat) | `GEMINI_FAST_MODEL` (tugas massal) | Catatan |
|---|---|---|---|---|
| **Gratis (default)** | `free` | `gemini-3.8-flash` | `gemini-3.8-flash` atau Flash-Lite | Rate limit free tier ketat → antrean + retry; data free tier dapat dipakai Google untuk meningkatkan produk (aman untuk data FPL publik, jangan kirim data pribadi) |
| **Berbayar** | `paid` | `gemini-4-argon` | Flash | Argon $2/$10 per 1M token input/output sampai 30 Nov 2026, lalu $4/$20 mulai 1 Des 2026; Search grounding gratis 5.000 request/bulan lalu $14 per 1.000 |
| **Hibrida (disarankan bila berbayar)** | `hybrid` | Argon **hanya** untuk rekomendasi mingguan & audit T-60 | Flash untuk berita, label, chat | Biaya terkendali, kualitas tertinggi di titik penting |

Aturan implementasi:
- Semua tugas harus bisa jalan di mode gratis. Kualitas narasi boleh turun, tetapi angka tetap dari engine.
- Worker membaca daftar model yang tersedia (`models.list`) saat start; jika model di env tidak tersedia untuk key tersebut, otomatis turun ke `GEMINI_FAST_MODEL` dan mencatat peringatan di `/admin/health`.
- Grounding Google Search dipakai hemat: satu request grounded per **kelompok** pemain (mis. per klub), bukan per pemain.
- Verifikasi ketersediaan grounding di free tier saat implementasi; jika tidak tersedia, audit T-60 di mode gratis memakai RSS + GNews + FPL `news` saja.

### 10.1 Pembagian tugas model

`HEAVY` = `GEMINI_MODEL` (Argon di mode berbayar, Flash di mode gratis). `FAST` = `GEMINI_FAST_MODEL`.

| Tugas | Model | Grounding | Output |
|---|---|---|---|
| Klasifikasi & ekstraksi berita massal | FAST | Tidak | `news_entities` JSON |
| Cek berita final T-60 per kelompok pemain | HEAVY | **Ya (Google Search)** bila tersedia | sinyal + URL |
| Label & deskripsi arketipe pemain | FAST | Tidak | label + 3 kalimat |
| Profil taktik tim & pelatih | HEAVY | Opsional | narasi + tag yang dikonfirmasi |
| Alasan & skenario rekomendasi | HEAVY | Tidak (data sudah dikirim) | JSON rekomendasi |
| Deadline Audit Report | HEAVY | Ya bila tersedia | Markdown + JSON |
| Chat "Tanya Analis" | FAST (HEAVY opsional) | Opsional | jawaban + kutipan evidence |

### 10.2 Aturan teknis

- Gunakan SDK `google-genai` (Python) dengan **structured output** (`response_mime_type="application/json"` + `response_schema` dari model Pydantic).
- Kirim data sebagai JSON ringkas dengan `evidence_id` di setiap item. Larang model menambah angka yang tidak ada di input.
- Simpan setiap prompt sebagai file versi di `services/worker/app/ai/prompts/<task>.v<n>.md`. Catat `prompt_version` di `ai_runs`.
- Batas biaya: `AI_DAILY_BUDGET_USD` (default 3). Jika terlampaui, hanya job T-60 yang boleh jalan.
- Cache: jika `input_hash` sama dengan run sebelumnya, pakai hasil lama.
- Validasi pasca-generate: setiap `evidence_id` yang disebut harus ada di input; angka dalam teks dicek dengan regex terhadap payload. Jika gagal → retry sekali → `status=degraded`.

### 10.3 System prompt dasar (dipakai semua tugas)

```text
Kamu adalah analis Fantasy Premier League senior untuk aplikasi TaktikFPL.
Pengguna: manajer FPL di Indonesia. Tulis dalam Bahasa Indonesia yang natural dan lugas,
seperti analis yang berbicara ke teman. Istilah sepakbola/FPL tetap bahasa Inggris
(xG, xA, clean sheet, low block, captain, differential, dll).

ATURAN KERAS:
1. Semua angka yang kamu tulis HARUS berasal dari data input. Jangan menghitung ulang,
   jangan membulatkan berbeda, jangan mengarang statistik.
2. Setiap alasan wajib mencantumkan evidence_id dari input.
3. Jika data tidak cukup, katakan "data terbatas" dan turunkan confidence. Jangan menebak.
4. Bedakan fakta (dari data/berita bersumber) dan interpretasi (analisismu).
5. Untuk berita, hanya gunakan sumber yang kamu temukan dan sertakan URL-nya.
   Rumor dari akun tidak kredibel ditandai sebagai rumor dengan confidence rendah.
6. Output HARUS sesuai JSON schema yang diberikan. Tidak ada teks di luar JSON.
```

### 10.4 Prompt: Ekstraksi Berita (`news_extract.v1`)

```text
TUGAS: Baca artikel berikut dan ekstrak sinyal yang relevan untuk FPL.

Daftar pemain & tim yang valid (gunakan ID ini saja):
{entity_dictionary_json}

Artikel:
- sumber: {source}
- dipublikasikan: {published_at}
- judul: {title}
- isi: {text}

Kembalikan array sinyal sesuai schema NewsSignal:
- type: injury|illness|suspension|rotation_hint|manager_conflict|manager_change|transfer|return_to_training|lineup_leak|other
- severity: low|medium|high
- expected_absence: none|1_match|2_4_weeks|long_term|unknown
- confidence 0..1 (kutipan langsung pelatih = tinggi; "laporan menyebut" = sedang; rumor = rendah)
- summary_id: 1–2 kalimat Bahasa Indonesia
Jika artikel tidak relevan untuk FPL, kembalikan array kosong.
```

### 10.5 Prompt: Profil Arketipe Pemain (`archetype_label.v1`)

```text
TUGAS: Beri label dan deskripsi gaya bermain pemain berdasarkan data.

Input:
- pemain: {player_json}            # nama, klub, posisi FPL, posisi riil, kaki dominan
- skor arketipe dari model: {archetype_scores_json}
- metrik per90 ter-adjust (semua kompetisi, dengan persentil posisi): {metrics_json}
- pelatih & sistem tim saat ini: {team_context_json}

Hasilkan:
1. primary_archetype & secondary_archetype (pilih dari daftar yang diberikan, boleh menolak
   jika data tidak mendukung)
2. description_id: 3–4 kalimat — bagaimana dia bermain, zona favorit, sumber poin FPL utama
3. strengths[] dan weaknesses[] masing-masing dengan evidence_id
4. ideal_opponent_profile: gaya lawan yang paling menguntungkan dia (mis. "tim high line
   yang full-back kanannya sering naik")
5. worst_opponent_profile
```

### 10.6 Prompt: Taktik Tim & Pelatih (`team_tactics.v1`)

```text
TUGAS: Jelaskan gaya bermain tim dan kebiasaan pelatih, khusus implikasinya untuk FPL.

Input:
- tim: {team_json}
- pelatih & riwayat: {manager_json}          # termasuk tanggal mulai menjabat
- metrik gaya (rolling, per kompetisi): {style_metrics_json}
- style_tags dari model: {style_tags_json}
- profil rotasi & sub: {manager_profile_json}
- formasi yang dipakai: {formation_usage_json}
- jadwal 3 minggu ke depan semua kompetisi: {schedule_json}

Hasilkan:
1. style_summary_id (4–6 kalimat): fase build-up, pressing, transisi, set-piece
2. confirmed_tags[] (dari style_tags; beri alasan jika menolak satu tag)
3. fpl_implications[]: siapa diuntungkan sistem ini (posisi/peran), dengan evidence_id
4. rotation_outlook: risiko rotasi tiap pemain inti dalam 3 minggu (low/medium/high) + alasan
5. weaknesses_to_exploit[]: dari sisi lawan, bagaimana tim ini bisa dibongkar
```

### 10.7 Prompt: Rekomendasi Mingguan (`gw_recommendation.v1`)

```text
TUGAS: Susun rekomendasi GW{gw} untuk skuad pengguna.

Input (semua angka final dari engine, JANGAN diubah):
- skuad pengguna, bank, free transfers, chip tersisa: {squad_json}
- hasil optimizer (transfer, kapten, XI, bench, chip): {optimizer_json}
- proyeksi kandidat (xPts, P10/P50/P90, P(haul), P(blank), xMins, breakdown): {projections_json}
- SHAP top features per pemain: {shap_json}
- konteks fixture (style clash, H2H, jadwal, cuaca, wasit): {fixture_context_json}
- matchup edges (dengan tier A/B/C): {matchups_json}
- teammate effects signifikan: {teammate_json}
- sinyal berita 7 hari: {news_json}
- profil risiko pengguna: {risk_profile}

Untuk SETIAP rekomendasi (transfer masuk/keluar, kapten, vice, differential):
1. reasons[]: 3–6 alasan; kategori form|fixture|matchup|tactic|teammate|news|market|schedule;
   urutkan sesuai bobot SHAP; tiap alasan wajib evidence_id
2. scenarios[]: tepat 3 — haul (>=10), solid (4–9), blank (<=3). Pakai probabilitas dari
   input (p_haul, dst). Ceritakan BAGAIMANA tiap skenario terjadi secara taktis.
3. risk_triggers[]: kondisi konkret yang membatalkan rekomendasi
4. alternatives[]: 2 pemain dari input dengan harga ±£0.5m
5. one_liner_id: satu kalimat inti

Tambahkan ringkasan GW: tema minggu ini (mis. "banyak tim besar main midweek UCL"),
laga yang paling menentukan, dan peringatan jadwal/berita.
```

### 10.8 Prompt: Deadline Audit T-60 (`deadline_audit.v1`, grounded)

```text
TUGAS: Audit final 60 menit sebelum deadline GW{gw} ({deadline_wib} WIB).

1. Gunakan Google Search untuk SETIAP pemain di daftar berikut. Cari berita 48 jam terakhir
   tentang: cedera, sakit, absen latihan, konferensi pers pelatih, skors, masalah disiplin,
   konflik dengan pelatih, bocoran lineup.
   Daftar: {players_to_check_json}
2. Bandingkan dengan sinyal yang sudah kita punya: {known_signals_json}
3. Tandai: NEW (baru ditemukan), CONFIRMED (sama), CONTRADICTED (berita baru membantah).
4. Bandingkan draft rekomendasi {draft_json} dengan hasil engine final {final_json}.

Output JSON DeadlineAudit:
- player_checks[]: {player_id, status: green|yellow|red, finding_id, sources[], flag}
- changes_since_draft[]: apa berubah & kenapa (rujuk evidence_id)
- final_decision: transfer, captain, vice, xi, bench_order, chip — SALIN dari engine final
- residual_risks[] dan contingency[]
- summary_3_lines_id: tiga baris untuk push notification
Jika pencarian tidak menemukan apa pun untuk seorang pemain, tulis "tidak ada berita baru",
jangan mengarang.
```

### 10.9 Contoh schema Pydantic (worker)

```python
from pydantic import BaseModel, Field, conlist
from typing import Literal

Category = Literal["form","fixture","matchup","tactic","teammate","news","market","schedule"]

class Reason(BaseModel):
    category: Category
    text_id: str = Field(max_length=280)
    evidence_id: int

class Scenario(BaseModel):
    label: Literal["haul","solid","blank"]
    prob: float = Field(ge=0, le=1)
    story_id: str = Field(max_length=400)

class PlayerRecommendation(BaseModel):
    rec_type: Literal["transfer_in","transfer_out","captain","vice","differential","start","bench"]
    player_id: int
    paired_player_id: int | None = None
    one_liner_id: str
    reasons: conlist(Reason, min_length=3, max_length=6)
    scenarios: conlist(Scenario, min_length=3, max_length=3)
    risk_triggers: list[str]
    alternatives: conlist(int, max_length=2)
    confidence: float = Field(ge=0, le=1)

class GWRecommendation(BaseModel):
    gameweek: int
    theme_id: str
    key_fixtures: list[int]
    warnings: list[str]
    items: list[PlayerRecommendation]
```

---

## 11. Desain UI/UX (dari Referensi)

### 11.1 Referensi yang dilampirkan

| File | Gaya | Yang diambil |
|---|---|---|
| `docs/design/ref-01-ember-mobile.png` | Gradien oranye → merah → hitam, judul condensed tebal huruf besar, kartu kaca (glass) | Tema **Ember**, layar live score besar, strip kalender bulanan, baris odds 3 kolom, scrubber timeline laga, bottom nav bulat |
| `docs/design/ref-02-pitch-dashboard.png` | Desktop, latar stadion hijau gelap blur, panel kaca membulat, aksen biru & hijau | Tema **Pitch**, layout dashboard desktop 3 kolom, panel "AI Prediction" dengan bar persentase, panel Live Matches dengan tab, tabel klasemen, kartu "MVP of the Day" |
| `docs/design/ref-03-violet-mobile.png` | Hitam pekat dengan glow ungu, sans-serif bersih, kartu live dengan glow warna tim | Tema **Violet** (default), sapaan + chip kategori, strip tanggal mingguan dengan pill aktif, kartu live match, lapangan lineup dengan foto bulat pemain, floating bottom nav |

> Logo klub, foto pemain, dan logo liga di gambar referensi hanya contoh. Di aplikasi, semua aset itu dimuat dari CDN via config (Bagian 6.3), bukan disalin ke repo.

### 11.2 Design tokens

```css
/* apps/web/src/styles/tokens.css */
:root {
  /* tipografi */
  --font-display: "Anton", "Bebas Neue", "Oswald", sans-serif;  /* judul condensed (ref-01) */
  --font-sans: "Inter", "Plus Jakarta Sans", system-ui, sans-serif; /* body (ref-02, ref-03) */
  --font-mono: "JetBrains Mono", ui-monospace, monospace;          /* angka statistik */

  /* radius & glass */
  --radius-sm: 12px;
  --radius-md: 20px;
  --radius-lg: 28px;
  --radius-pill: 999px;
  --glass-bg: rgba(255, 255, 255, 0.06);
  --glass-border: rgba(255, 255, 255, 0.12);
  --glass-blur: 18px;

  /* status FPL */
  --status-ok: #22C55E;
  --status-doubt: #F59E0B;
  --status-out: #EF4444;
  --live-red: #FF3B3B;

  /* FDR 1-5 */
  --fdr-1: #1F8A4C; --fdr-2: #4ADE80; --fdr-3: #9CA3AF; --fdr-4: #F97316; --fdr-5: #B91C1C;
}

/* Tema Violet (default) — ref-03 */
[data-theme="violet"] {
  --bg: #07070C;
  --bg-elev: #12121C;
  --bg-glow: radial-gradient(60% 40% at 50% 0%, rgba(108, 59, 255, 0.35), transparent 70%);
  --accent: #6C3BFF;
  --accent-soft: rgba(108, 59, 255, 0.18);
  --text: #F5F5FA;
  --text-muted: #9A9AB0;
}

/* Tema Ember — ref-01 */
[data-theme="ember"] {
  --bg: #0A0A0A;
  --bg-elev: #1A0F0B;
  --bg-glow: linear-gradient(180deg, #FF7A1A 0%, #E8261E 45%, #0A0A0A 100%);
  --accent: #FF5A1F;
  --accent-soft: rgba(255, 90, 31, 0.2);
  --text: #FFFFFF;
  --text-muted: #FFD2C2;
}

/* Tema Pitch — ref-02 */
[data-theme="pitch"] {
  --bg: #06140D;
  --bg-elev: #0D2017;
  --bg-glow: radial-gradient(80% 60% at 50% 20%, rgba(34, 197, 94, 0.25), transparent 70%);
  --accent: #3B5BFF;
  --accent-2: #22C55E;
  --accent-soft: rgba(59, 91, 255, 0.2);
  --text: #F2F7F4;
  --text-muted: #9FB8AA;
}
```

Aturan visual:
- Latar selalu gelap dengan **glow** di atas layar (ungu/oranye/hijau sesuai tema).
- Kartu = glass (`backdrop-filter: blur(var(--glass-blur))`) dengan border tipis.
- Skor dan xPts memakai `--font-display` ukuran besar (seperti "1:2" dan "3:5" di ref-01).
- Kartu live match diberi glow gradien dari warna primer dua tim (seperti ref-03).
- Bottom nav mengambang berbentuk pill dengan ikon bulat; item aktif = lingkaran terisi (`--accent` di Violet, putih di Ember).
- Angka statistik pakai tabular numerals.
- Gerak: transisi 150–250ms; skor live berdenyut halus saat gol; hormati `prefers-reduced-motion`.

### 11.3 Navigasi

**Mobile (bottom nav, 5 item):** Beranda · Analisis · Live · Jadwal · Tim Saya
**Desktop:** top bar berikon pill (seperti ref-02) + sidebar kiri untuk filter, konten 3 kolom.

```mermaid
flowchart LR
    HOME["Beranda<br/>Ringkasan GW"] --> REC["Rekomendasi GW"]
    HOME --> LIVE["Live Match Center"]
    HOME --> FIX["Jadwal & Fixture Ticker"]
    REC --> PDD["Player Deep Dive"]
    PDD --> TEAM["Tim & Taktik"]
    PDD --> CMP["Bandingkan Pemain"]
    FIX --> MATCH["Match Preview"]
    MATCH --> TEAM
    MYT["Tim Saya"] --> PLAN["Transfer Planner"]
    MYT --> CAP["Kapten Picker"]
    MYT --> CHIP["Chip Planner"]
    HOME --> NEWS["Berita & Alert"]
    HOME --> AUDIT["Laporan Deadline T-60"]
    SET["Pengaturan"] --> ACC["Akurasi Model"]
```

### 11.4 Komponen inti

| Komponen | Spesifikasi |
|---|---|
| `<PlayerHeadshot size="sm|md|lg" ring="status|team">` | Lingkaran, `object-fit: cover; object-position: center top` agar hanya kepala & bahu terlihat; cincin warna status FPL (hijau/kuning/merah) atau warna klub; fallback inisial |
| `<PlayerCard>` | Headshot, nama, klub (badge kecil), posisi, harga, xPts besar, rentang P10–P90 sebagai bar, chip arketipe, 2 alasan teratas, tombol "Lihat Analisis" |
| `<FixturePill>` | Lawan (3 huruf), H/A, warna FDR internal, jam WIB; badge "Jadwal berubah" bila `recently_changed` |
| `<LiveMatchCard>` | Badge LIVE merah, menit, skor besar, badge dua tim, glow warna tim, daftar pemain skuad Anda di laga ini + poin live |
| `<DateStrip>` | Strip 7 hari dengan pill aktif (ref-03) / strip bulanan dengan panah (ref-01) |
| `<PitchView>` | Lapangan SVG vertikal, posisi dari `grid_position` lineup, headshot bulat + label nama (ref-03); mode "Tim Saya" dan mode "Laga Live" |
| `<ProbabilityBar>` | Bar persentase seperti panel AI Prediction (ref-02) untuk P(gol), P(CS), P(haul) |
| `<ReasonChip>` | Kategori berwarna + teks; klik membuka sheet evidence |
| `<ScenarioCard>` | Tiga kartu: Haul / Solid / Blank dengan probabilitas dan cerita |
| `<StyleRadar>` | Radar gaya tim (possession, press, direct, width, set-piece) |
| `<ArchetypeRadar>` | Radar metrik pemain vs persentil posisi |
| `<MomentumChart>` | Kurva xG kumulatif dua tim per menit (live & pasca-laga) |
| `<EventTimeline>` | Timeline gol/kartu/subs dengan ikon (ref-01 scrubber) |

### 11.5 Wireframe layar

> Nama tim, skor, jam, dan angka di wireframe hanya contoh tata letak, bukan data nyata.

**A. Beranda (mobile, tema Violet)**

```text
┌──────────────────────────────────────┐
│ ◉ Halo, Dilan 👋              🔔 (3)  │
│ GW9 · Deadline Sab 17:00 WIB          │
│ ⏳ 3h 12j 40m        [Laporan T-60 ▸]  │
├──────────────────────────────────────┤
│ ● LIVE  (kartu glow warna tim)        │
│  [badge] MCI   2 : 0   HUL [badge]    │
│          67' · Poin live Anda: 41     │
│  ◯Haaland 13  ◯Gvardiol 6   ──────▸   │
├──────────────────────────────────────┤
│ Rekomendasi Minggu Ini                │
│ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │◯ (kepala)│ │◯ (kepala)│ │◯       │ │
│ │ KAPTEN   │ │ BELI     │ │ JUAL   │ │
│ │ xPts 8.4 │ │ xPts 6.1 │ │ xPts 2 │ │
│ └──────────┘ └──────────┘ └────────┘ │
├──────────────────────────────────────┤
│ ⚠ Alert: 1 pemain Anda 'doubt'        │
│ ⚠ Jadwal berubah: ARS–CHE → Min 23:30 │
├──────────────────────────────────────┤
│   ( ⌂ )  ( ◎ )  ( ((•)) )  ( ▦ )  (◉) │
└──────────────────────────────────────┘
```

**B. Player Deep Dive**

```text
┌──────────────────────────────────────┐
│ ‹                         ☆  ⤴        │
│        ◯◯◯ (headshot besar)           │
│   BRUNO FERNANDES   MUN · MID · £x.xm │
│   Arketipe: Attacking Mid / No.10     │
│   [Ringkasan][Statistik][Matchup]     │
│   [Tim & Taktik][Berita][Riwayat]     │
├──────────────────────────────────────┤
│ GW9 vs HUL (A) · Sab 21:00 WIB        │
│ xPts  5.8   ▕██████▏ P10 1 – P90 13   │
│ xMins 84 · P(start) 96% · Pen #1      │
├──────────────────────────────────────┤
│ Kenapa dipilih                        │
│ [TACTIC] ...   [MATCHUP·A] ...        │
│ [FORM] ...     [MARKET] ...           │
├──────────────────────────────────────┤
│ Skenario                              │
│ Haul 18% │ Solid 49% │ Blank 33%      │
├──────────────────────────────────────┤
│ Radar arketipe vs persentil MID       │
│ Tabel statistik: PL | UCL | FAC | EFL │
│ Duel kunci: Bruno ↔ DM lawan (Tier A) │
└──────────────────────────────────────┘
```

**C. Dashboard desktop (tema Pitch, layout ref-02)**

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ ⚽ TaktikFPL  (Rekomendasi)(Analisis)(Statistik)(Jadwal)  ● Live  🔍🔔⚙ ◉Dilan │
├───────────────┬───────────────────────────────────────┬───────────────────┤
│ GW9 Overview  │  Hero: Kapten Pilihan (headshot besar) │ Live Matches       │
│ ┌───┐ ┌───┐  │  xPts, P(haul), alasan singkat          │ [MCI 2-0 HUL] 67'  │
│ │Pts│ │Rank│ │                                         │ [Timeline|Lineup|  │
│ └───┘ └───┘  ├───────────────────┬───────────────────┤  Stats|Insights]   │
│ ┌───┐ ┌───┐  │ Transfer Planner   │ Fixture Ticker    │ [ Buka Live Pitch ]│
│ │FT │ │Bank│ │ OUT ▸ IN  +Δ xPts  │ GW9..GW14 FDR     ├───────────────────┤
│ └───┘ └───┘  │                    │                   │ Mini-league live   │
├───────────────┤                    │                   │ 1. ...             │
│ AI Prediction │                    │                   │ 2. ...             │
│ P(CS) per tim │                    │                   │                    │
│ ▬▬▬▬● 62%    │                    │                   │                    │
└───────────────┴───────────────────┴───────────────────┴───────────────────┘
```

**D. Jadwal (tema Ember, ref-01)**

```text
┌──────────────────────────────────────┐
│  ‹      Oktober 2026      ›           │
│  S   M   T   W   T   F   S            │
│  18 (19) 20  21  22  23  24  ← pill   │
│  JADWAL GW9                           │
│  [Semua][PL][UCL][FA Cup][Carabao]    │
├──────────────────────────────────────┤
│ Sab 25 Okt                            │
│  MCI vs HUL   21:00 WIB   FDR 2 | 5   │
│  ARS vs CHE   23:30 WIB  ⚠ dipindah   │
│     dari Sab 18:30 → Min 23:30 (TV)   │
│ Rab 22 Okt (UCL)                      │
│  MCI vs PSG   02:00 WIB  ⚠ rotasi GW9 │
├──────────────────────────────────────┤
│ Fixture Ticker 6 GW  [heatmap FDR]    │
└──────────────────────────────────────┘
```

**E. Live Match Center ("sepakbola secara live")**

```text
┌──────────────────────────────────────┐
│ ‹   ● LIVE 67'            👁  ⤴       │
│  [badge] MCI   2 : 0   HUL [badge]    │
│  ⚽ Haaland 23' 51'   🟨 HUL #5 40'   │
│  [Laga][Lineup][Statistik][FPL][Insight]
├──────────────────────────────────────┤
│        PitchView (SVG)                │
│     ◯     ◯     ◯                     │
│        ◯     ◯                        │
│  ◯   ◯    ◯    ◯   ◯   ← headshot     │
│           ◯ GK                        │
│  Pemain skuad Anda diberi cincin ungu │
├──────────────────────────────────────┤
│ Momentum xG  ╱╲__╱╲___ (MCI vs HUL)   │
│ Timeline  ●──⚽──🟨──⚽──🔁──▶         │
├──────────────────────────────────────┤
│ Poin FPL live: Haaland 13 (bonus ~3)  │
│ BPS live: Haaland 41 · Rodri 29 ...   │
└──────────────────────────────────────┘
```

Catatan: aplikasi **tidak** menayangkan video pertandingan (hak siar). "Live" berarti visual lapangan, event, statistik, dan poin yang terus diperbarui.

### 11.6 Bahasa & format

- Tanggal: `Sab, 25 Okt 2026 · 21:00 WIB`.
- Harga: `£10.5m`. Persentase: `62%`. xPts: satu desimal.
- Istilah UI: "Beli/Jual", "Kapten", "Cadangan", "Ragu-ragu (doubt)", "Diragukan tampil".

---

## 12. Fitur Tambahan

Diurutkan dari yang paling berdampak.

| # | Fitur | Deskripsi | Fase |
|---|---|---|---|
| 1 | **Import tim via FPL ID** | Tarik skuad, bank, FT, chip dari API | 1 |
| 2 | **Fixture Ticker + FDR internal** | Heatmap 6 GW, FDR dari model (beda serangan vs bertahan) | 1 |
| 3 | **Alert cedera & jadwal** | Push + Telegram saat status/jadwal pemain Anda berubah | 2 |
| 4 | **Captain Picker** | EV, ceiling, EO, mode aman/agresif | 2 |
| 5 | **Transfer Planner multi-GW** | Solver ILP, simulasi hit −4, roll transfer | 2 |
| 6 | **Laporan Deadline T-60** | Audit final grounded | 2 |
| 7 | **Bandingkan pemain** | 2–4 pemain berdampingan: radar, jadwal, xPts | 2 |
| 8 | **Differential Finder** | xPts tinggi, kepemilikan < 10% | 2 |
| 9 | **Live Match Center** | PitchView, timeline, momentum, poin live | 3 |
| 10 | **Mini-league rival tracker** | EO rival, pemain yang membedakan Anda | 3 |
| 11 | **Lineup confirmed alert** | 60 menit sebelum kick-off, beri tahu jika pemain Anda benched | 3 |
| 12 | **Chip Planner** | Deteksi BGW/DGW, nilai simulasi tiap chip | 3 |
| 13 | **Price watch** | Gabungkan Price Change Predictor resmi + tren transfer | 3 |
| 14 | **"Tanya Analis" (chat)** | Tanya bebas ke Gemini dengan konteks data terkini, jawaban dengan evidence | 3 |
| 15 | **What-if Simulator** | "Bagaimana jika Rodri absen?" → model dijalankan ulang | 4 |
| 16 | **Penalty & set-piece tracker** | Hierarki eksekutor dari `team/set-piece-notes/` + alert saat berubah | 2 |
| 17 | **Akurasi Model** | MAE & kalibrasi tiap GW, transparansi | 2 |
| 18 | **GW Review** | Setelah GW: apa yang benar/salah, pelajaran, dibandingkan dengan Dream Team resmi (`dream-team/{gw}`) | 3 |
| 19 | **Rotation Risk Meter** | Gauge per pemain dari Rotation Index + jadwal | 2 |
| 20 | **Press Conference Digest** | Ringkasan presser semua pelatih, Jumat | 3 |
| 21 | **Template Tracker** | Pemain yang dimiliki >30% top 10k | 3 |
| 22 | **Kalender ke Google Calendar** | Export deadline & laga (WIB) sebagai .ics | 4 |
| 23 | **Mode Draft/Head-to-Head** | Dukungan FPL Draft | 5 |
| 24 | **Shareable card** | Gambar ringkasan GW untuk dibagikan | 4 |
| 25 | **Liga H2H & FPL Cup** | Lawan H2H minggu ini, perbandingan skuad, status cup (`leagues-h2h-matches`, `cup-status`) | 3 |
| 26 | **Status update GW** | Banner "Bonus sudah dikonfirmasi / Liga sedang diperbarui" dari `event-status/` | 3 |

---

## 13. API Internal (Kontrak Backend ↔ Frontend)

Web membaca sebagian besar data langsung dari Supabase (RLS aktif). Endpoint FastAPI untuk komputasi berat:

| Method | Path | Fungsi |
|---|---|---|
| GET | `/v1/gameweeks/current` | GW sekarang & berikut, deadline (UTC + WIB) |
| GET | `/v1/fixtures?gw=9&competition=PL,UCL` | Fixture + perubahan jadwal |
| GET | `/v1/players/{id}/deep-dive?gw=9` | Profil lengkap: arketipe, statistik lintas kompetisi, matchup, proyeksi, alasan |
| GET | `/v1/teams/{id}/tactics` | Profil gaya, pelatih, rotasi, kelemahan |
| GET | `/v1/recommendations?gw=9&entry_id=...` | Rekomendasi terbaru + alasan + skenario |
| POST | `/v1/optimizer/transfers` | Body: horizon, max_hits, locked/banned players, risk_profile → rencana transfer |
| POST | `/v1/optimizer/captain` | EV kapten untuk skuad |
| POST | `/v1/simulate/what-if` | Body: perubahan asumsi (pemain absen, formasi) → proyeksi baru |
| GET | `/v1/reports/deadline?gw=9` | Laporan T-60 |
| GET | `/v1/live/stream?gw=9` | SSE: event & poin live |
| POST | `/v1/ask` | Chat "Tanya Analis" |
| POST | `/v1/admin/jobs/{name}/run` | Jalankan job manual (admin) |
| GET | `/v1/health` | Status sumber data & job terakhir |

Autentikasi: JWT Supabase diteruskan dari web ke worker; worker memverifikasi dengan JWKS Supabase.

---

## 14. Struktur Repo, Environment & DevOps

### 14.1 Struktur repo

```text
taktikfpl/
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
├── .env.example
├── docker-compose.yml            # postgres + redis lokal untuk dev
├── docs/
│   ├── BLUEPRINT.md              # dokumen ini
│   ├── design/
│   │   ├── ref-01-ember-mobile.png
│   │   ├── ref-02-pitch-dashboard.png
│   │   └── ref-03-violet-mobile.png
│   └── adr/                      # catatan keputusan arsitektur
├── apps/
│   └── web/
│       ├── src/app/              # (home)/, analisis/, live/, jadwal/, tim/, pemain/[id]/, tim-klub/[id]/
│       ├── src/components/       # PlayerHeadshot, PitchView, LiveMatchCard, ...
│       ├── src/lib/              # supabase client, api client, format WIB
│       ├── src/styles/tokens.css
│       └── public/manifest.webmanifest
├── services/
│   └── worker/
│       ├── app/
│       │   ├── main.py           # FastAPI + start scheduler
│       │   ├── scheduler/        # definisi job, deadline checkpoints
│       │   ├── sources/          # fpl.py, api_football.py, understat.py, sportmonks.py, odds.py, news_rss.py, gnews.py, weather.py, clubelo.py
│       │   ├── resolve/          # entity_resolver.py
│       │   ├── features/         # archetypes.py, form.py, team_style.py, manager.py, teammate.py, matchup.py, context.py
│       │   ├── models/           # xmins.py, team_goals.py, shares.py, defcon.py, bonus.py, simulate.py, evaluate.py
│       │   ├── optimize/         # transfers.py, captain.py, chips.py
│       │   ├── ai/
│       │   │   ├── client.py     # google-genai wrapper, budget, cache, validasi
│       │   │   ├── schemas.py
│       │   │   └── prompts/      # *.v1.md
│       │   ├── live/             # poller.py, sse.py
│       │   ├── notify/           # webpush.py, telegram.py
│       │   └── db/               # models SQLAlchemy, session
│       ├── tests/
│       │   └── fixtures/         # sampel JSON tiap sumber
│       └── pyproject.toml
└── .github/workflows/
    ├── ci.yml                    # lint, typecheck, test web & worker
    └── deploy.yml
```

### 14.2 `.env.example`

```env
# === Umum ===
APP_ENV=development
APP_TIMEZONE=Asia/Jakarta
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   # lokal (supabase start)
REDIS_URL=redis://127.0.0.1:6379/0
WORKER_API_URL=http://127.0.0.1:8000
SENTRY_DSN=

# === Supabase ===
SUPABASE_PROJECT_REF=
SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=           # sb_publishable_... (boleh di front end)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=                # sb_secret_... (HANYA worker, jangan commit)
SUPABASE_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
# Produksi: pakai Session pooler (IPv4). Direct connection hanya IPv6.
# DATABASE_URL=postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres

# === FPL ===
FPL_BASE_URL=https://fantasy.premierleague.com/api/
FPL_TEAM_ID=
FPL_MINI_LEAGUE_IDS=
FPL_H2H_LEAGUE_IDS=
# opsional, kosongkan = mode publik. Cookie sesi browser FPL; JANGAN commit, JANGAN kirim ke front end
FPL_SESSION_COOKIE=
FPL_REQUESTS_PER_SECOND=1
PLAYER_PHOTO_URL_TEMPLATE=
PLAYER_PHOTO_FALLBACK_TEMPLATE=
TEAM_BADGE_URL_TEMPLATE=

# === Data provider ===
API_FOOTBALL_KEY=
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
SPORTMONKS_API_TOKEN=
ODDS_API_KEY=
GNEWS_API_KEY=
NEWSAPI_KEY=
EXPERIMENTAL_SOURCES=false

# === AI ===
GEMINI_API_KEY=
AI_TIER=free                        # free | paid | hybrid (Bagian 10.0)
GEMINI_MODEL=gemini-3.8-flash       # ganti ke gemini-4-argon jika billing aktif
GEMINI_FAST_MODEL=gemini-3.8-flash
GEMINI_PREMIUM_MODEL=gemini-4-argon
AI_DAILY_BUDGET_USD=3

# === Notifikasi ===
VAPID_PUBLIC_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# === Deadline protocol (menit sebelum deadline) ===
DEADLINE_CHECKPOINTS_MIN=2880,1440,360,120,60,15
```

### 14.3 Deploy

```mermaid
flowchart LR
    DEV["Laptop Dilan<br/>docker-compose"] -->|git push| GH["GitHub"]
    GH -->|CI: lint + test| CI["GitHub Actions"]
    CI -->|deploy web| VER["Vercel"]
    CI -->|deploy worker| RW["Railway / Fly.io<br/>1 instance always-on"]
    CI -->|supabase db push (approval)| SB[("Supabase Postgres")]
    RW --> SB
    VER --> SB
    RW --> UP[("Upstash Redis")]
```

- Worker harus **satu instance** (atau pakai lock Redis) agar job terjadwal tidak dobel.
- Monitoring: Sentry di web & worker; halaman `/admin/health` menampilkan `job_runs` terakhir & umur data tiap sumber.
- Backup: Supabase daily backup; ekspor `projections` & `recommendations` mingguan ke Storage.

---

## 15. Roadmap Pengerjaan Bertahap

| Fase | Fokus | Kriteria selesai (bisa diuji) |
|---|---|---|
| **1. Fondasi data** | Repo, docker-compose, migrasi DB, adapter FPL + API-Football + Understat, entity resolver, sync fixtures & deteksi perubahan jadwal, UI Beranda/Jadwal/daftar pemain dengan headshot | Data GW berjalan tampil di UI dalam WIB; mengubah `kickoff_utc` di DB uji memunculkan baris `fixture_changes` + badge di UI; foto pemain tampil dengan fallback |
| **2. Engine & AI** | Feature builder (form, arketipe, gaya tim, profil pelatih), model xPts + Monte Carlo, optimizer, berita + Gemini, rekomendasi mingguan, Player Deep Dive, protokol deadline T-60, push notification | Backtest 2025/26 menghasilkan MAE xPts terdokumentasi; laporan T-60 terkirim tepat waktu di GW uji; setiap alasan punya evidence yang bisa dibuka |
| **3. Live & sosial** | Live poller, Live Match Center (PitchView, timeline, momentum), mini-league, lineup alert, chip planner, Tanya Analis | Selama laga nyata, poin live di app selisih ≤1 dari situs FPL; latensi event < 60 detik |
| **4. Kedalaman** | Sportmonks xG lintas kompetisi, matchup Tier B, teammate effects, what-if simulator, GW review, export kalender | Teammate effect & matchup tampil dengan CI; what-if mengubah proyeksi dalam < 10 detik |
| **5. Polesan** | Tema Ember & Pitch, shareable card, performa, aksesibilitas, mode Draft | Lighthouse PWA ≥ 90; semua tema lolos kontras WCAG AA |

Untuk tiap fase, Claude Code membuat branch `phase-N`, PR, dan checklist di deskripsi PR.

---

## 16. Risiko, Legal & Batasan Data

| Risiko | Mitigasi |
|---|---|
| FPL API tidak resmi dan bisa berubah | Adapter + contract test; simpan raw payload; alert jika parsing gagal |
| Cookie sesi FPL bocor / kedaluwarsa | Mode publik sebagai default; cookie hanya secret worker, read-only, tidak pernah ke browser; fallback otomatis |
| Data lanjutan berbayar (xG lintas kompetisi, duel 1v1) | Mulai dari PL (Understat) + API-Football; Sportmonks/Opta sebagai upgrade; tampilkan confidence & tier data |
| Scraping melanggar ToS | Default `EXPERIMENTAL_SOURCES=false`; hanya sumber dengan API/RSS resmi di produksi |
| Hak cipta foto pemain & badge | Muat dari CDN untuk pemakaian pribadi; jangan redistribusi publik/komersial tanpa lisensi |
| Halusinasi LLM | Angka hanya dari engine; validasi evidence & angka; grounding untuk berita; tampilkan sumber |
| Biaya AI membengkak | Budget harian, cache input_hash, model cepat untuk tugas massal |
| Model terlalu percaya diri | Kalibrasi, shrinkage, tampilkan rentang P10–P90, halaman Akurasi Model |
| Deadline berubah mendadak | Checkpoint dijadwalkan ulang tiap `sync_bootstrap` mendeteksi perubahan |
| Zona waktu & DST Inggris | Simpan UTC; konversi di UI; test untuk minggu pergantian jam (akhir Maret & akhir Oktober) |
| Sampel kecil (klub promosi, pelatih baru) | Prior dari liga/klub sebelumnya + bobot recency lebih cepat |

---

## 17. Glosarium

| Istilah | Arti |
|---|---|
| **xG / npxG** | Expected goals / tanpa penalti — kualitas peluang tembakan |
| **xA** | Expected assists — peluang yang dibuat jadi assist |
| **xPts** | Expected FPL points dari model |
| **xMins** | Menit main yang diharapkan |
| **PPDA** | Passes per defensive action — makin kecil, makin intens pressing |
| **CBIT / CBIRT** | Clearances, blocks, interceptions, tackles (+ recoveries) untuk DefCon |
| **DefCon** | Defensive contribution points di FPL |
| **BPS** | Bonus Points System |
| **EO** | Effective ownership — kepemilikan × multiplier kapten |
| **FDR** | Fixture difficulty rating |
| **BGW / DGW** | Blank / Double Gameweek |
| **Low block / Mid block / High press** | Posisi blok bertahan tim tanpa bola |
| **Gegenpress** | Pressing langsung setelah kehilangan bola |
| **Inverted winger** | Pemain sayap yang bermain di sisi berlawanan kaki dominannya, cenderung masuk ke dalam untuk menembak |
| **Shrinkage** | Menarik statistik sampel kecil ke rata-rata agar tidak berlebihan |
| **Monte Carlo** | Simulasi ribuan kali untuk mendapatkan distribusi hasil |
| **SHAP** | Metode menjelaskan kontribusi tiap fitur ke prediksi model |
| **Grounding** | Gemini mencari di Google Search dan mengutip sumber |

---

*Akhir dokumen. Kembangkan dengan menambah bagian baru di bawah, dan catat perubahan di bagian riwayat versi berikut.*

### Riwayat versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| v0.1 | 2026-10-20 | Draft awal: analisis 7 lapisan, DB, arsitektur, prompt Gemini, desain UI, roadmap |
| v0.4 | 2026-10-20 | Migrasi pindah dari Alembic ke Supabase CLI; SQL final & infrastruktur dipisah ke `docs/INFRA_BLUEPRINT.md` |
| v0.3 | 2026-10-20 | Bagian 10.0: mode AI gratis (Flash) / berbayar (Argon) / hibrida karena Argon tidak ada di free tier; env Supabase format kunci baru + Session pooler; peringatan repo publik |
| v0.2 | 2026-10-20 | Bagian 6.2 diperluas dari dokumentasi komunitas FPL API: 16 endpoint publik (termasuk `event-status`, `dream-team`, `team/set-piece-notes`, H2H, cup), endpoint ber-login sebagai mode opsional, catatan CORS, perhitungan harga jual tanpa login, job baru, kolom `h2h_league_ids`/`auth_mode`/`note_text` |

