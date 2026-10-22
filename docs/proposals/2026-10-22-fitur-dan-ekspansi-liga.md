# Usulan 2026-10-22 — referensi fitur & ekspansi UCL / La Liga

Status: **usulan, menunggu keputusan Dilan.** Belum ada kode untuk bagian ini.

## 1. Referensi fitur (dibandingkan dengan backlog `docs/TaktikFPL.md` §9)

Daftar dari tool FPL populer (FPL Review, Fantasy Football Hub, LiveFPL, FPLForm, Fantasy Football Fix).
Tambahkan referensi Dilan sendiri di bawah tabel; nanti kita urutkan bersama.

| # | Fitur | Contoh di tool lain | Sudah ada? | Usaha | Catatan |
|---|-------|---------------------|-----------|-------|---------|
| F1 | Fixture ticker / rotation planner (FDR 5–8 GW per tim, pasangan rotasi GK/DEF) | FPL Review, Hub | sebagian (FDR per laga, outlook pemain) | S | data sudah ada; murni UI + fungsi TS |
| F2 | Captaincy matrix (xPts kapten vs EO, risiko) | Hub, FPLForm | belum | S–M | butuh EO → F4 |
| F3 | Solver transfer multi-GW (hit, bank, FT) | FPL Review | backlog #5 | L | PuLP sudah di stack |
| F4 | Effective ownership & live rank | LiveFPL | backlog #7 (Fase 3) | M | top-10k sampling via API FPL |
| F5 | Prediksi kenaikan/penurunan harga | LiveFPL, FPLStatistics | belum | M | butuh snapshot transfer per jam |
| F6 | Mini-league rival view (beda pemain, chip lawan) | LiveFPL | backlog #7 | M | `mini_league_ids` sudah di skema |
| F7 | Set-piece & penalty taker per klub | Hub | belum | S | Understat shots (situasi) sudah diambil |
| F8 | xMins / prediksi lineup | Hub, Fix | backlog #4 | M | gabung berita + menit terkini |
| F9 | Chip planner (WC/FH/BB/TC per GW) | FPL Review | sebagian (sim musim) | M | lanjutan Model Lab |
| F10 | GW review otomatis (siapa untung/rugi vs prediksi) | — | backlog #8 | S–M | data prediksi per deadline tersimpan |

Usulan urutan cepat-berdampak: **F1 → F7 → F10 → F2/F4**.

Referensi dari Dilan:
- _(isi di sini)_

## 2. Ekspansi UCL & La Liga

### Kondisi skema saat ini (sudah siap multi-kompetisi)
- `competitions(code, name, weight, is_cup)` — kode `UCL`, `UEL`, dst. sudah direncanakan.
- `fixtures.competition_id`, `fixtures.gameweek_id` boleh null (laga non-PL).
- `team_seasons.league_code` (default `PL`), `team_external_ids(source, external_id)` untuk pemetaan lintas sumber.
- `UnderstatClient` sudah ada untuk PL; Understat juga mencakup La Liga (`La_liga`), tetapi **tidak** UCL.

### Sumber data (semua gratis)

| Sumber | Isi | Cakupan | Catatan |
|--------|-----|---------|---------|
| football-data.org (API key gratis) | jadwal, hasil, klasemen, skuad | PL, **UCL (CL)**, **La Liga (PD)** | 10 req/menit; paling rapi untuk jadwal UCL |
| Understat (adapter sudah ada) | xG/xA per laga & pemain, tembakan, PPDA | PL, **La Liga**, Bundesliga, Serie A, Ligue 1 | tanpa UCL |
| ClubElo (`api.clubelo.com`, CSV) | rating kekuatan klub lintas liga, harian | semua liga Eropa | cocok untuk FDR lintas kompetisi |
| openfootball/football.json (GitHub, domain publik) | jadwal & hasil JSON | La Liga, UCL, dll. | cadangan bila football-data down |
| Wikidata (adapter sudah ada) | pelatih, stadion | semua klub | dipakai ulang apa adanya |
| Repo acuan: `probberechts/soccerdata` (Python) | scraper FBref/Understat/ClubElo/ESPN/SofaScore | banyak liga | **acuan pola parsing saja**, adapter tetap ditulis di `app/sources/` (aturan 3) |
| Fantasy UCL / LaLiga Fantasy | harga & poin game fantasy | — | API tidak resmi, perlu diverifikasi; paling akhir |

Setiap sumber baru wajib punya kebijakan arsip (aturan 9): payload mentah → bucket `archive` + `data_archives`.

### Tahapan (pilih yang mana dulu)

**Tahap A — UCL sebagai sinyal rotasi FPL (rekomendasi, paling kecil & langsung berguna)**
- Worker: `sources/footballdata.py` + job `sync_cup_fixtures` (harian; tiap tick saat ada laga UCL ≤48 jam).
- Tulis ke `fixtures` dengan `competition_id = UCL`, `gameweek_id = null`; peta tim via `team_external_ids(source='football_data')`.
- Analisis (TS deterministik): "laga UCL 3 hari sebelum/sesudah GW" → flag rotasi di Best XI, outlook pemain, halaman klub.
- UI: chip **UCL** kecil di fixture ticker & kartu pemain ("UCL Tue → PL Sat, risiko rotasi").

**Tahap B — La Liga sebagai liga analisis (tanpa game fantasy)**
- Seed `competitions('LL')`, tim La Liga via football-data + Understat (`team_seasons.league_code='LL'`).
- Pakai ulang job Understat untuk liga `La_liga`; halaman `/klub/[id]` & form pemain jadi generik per liga.
- UI: pemilih liga di TopBar (`PL · La Liga · UCL`), rute `/liga/[code]` (klasemen, jadwal, Top Form per liga).
- Risiko: kuota DB free tier (±+40% baris); perlu cek ukuran sebelum backfill multi-musim.

**Tahap C — Game fantasy UCL / LaLiga** (paling akhir; API tidak resmi, aturan poin berbeda → `fpl_scoring_rules` per game).

### Usulan desain UI
- TopBar: segmented control liga di kiri menu; pilihan disimpan per perangkat (seperti auto-update).
- Home per liga memakai layout tiga kolom yang sama; panel khusus FPL (Best XI, xPts) hanya muncul di PL.
- Warna aksen per kompetisi lewat design token (tanpa logo resmi sebagai aset statis — aturan 8).

### Keputusan yang dibutuhkan dari Dilan
1. Mulai dari Tahap A, B, atau keduanya?
2. Boleh daftar API key gratis football-data.org (disimpan sebagai secret worker, bukan di repo)?
