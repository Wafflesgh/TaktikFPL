-- Musim berjalan. end_date diisi worker dari data FPL.
insert into public.seasons (label, start_date, is_current)
values ('2026/27', '2026-08-21', true)
on conflict (label) do nothing;

-- Kompetisi & bobot analisis (lihat BLUEPRINT 4.2.2)
insert into public.competitions (code, name, weight, is_cup) values
  ('PL',    'Premier League',          1.00, false),
  ('UCL',   'UEFA Champions League',   0.95, false),
  ('UEL',   'UEFA Europa League',      0.85, false),
  ('UECL',  'UEFA Conference League',  0.75, false),
  ('FAC',   'FA Cup',                  0.70, true),
  ('EFLC',  'EFL Cup (Carabao Cup)',   0.65, true),
  ('CHAMP', 'EFL Championship',        0.60, false)   -- untuk profil awal klub promosi
on conflict (code) do nothing;

-- Aturan FPL yang sudah terverifikasi untuk 2026/27.
-- Aturan poin lainnya diisi worker dari bootstrap-static (game_config/scoring jika tersedia)
-- atau dimasukkan manual dari halaman aturan resmi FPL. Jangan menebak nilainya.
insert into public.fpl_scoring_rules (season_id, rule_key, value, notes)
select s.id, r.rule_key, r.value, r.notes
from public.seasons s
cross join (values
  ('defcon_threshold_DEF', 10, 'CBIT: clearances, blocks, interceptions, tackles'),
  ('defcon_threshold_MID', 12, 'CBIRT: + ball recoveries'),
  ('defcon_threshold_FWD', 12, 'CBIRT: + ball recoveries'),
  ('defcon_points',         2, 'maksimal 2 poin per laga'),
  ('bps_cbi_per_point',     3, '1 BPS per 3 clearances/blocks/interceptions (2026/27)')
) as r(rule_key, value, notes)
where s.label = '2026/27'
on conflict (season_id, rule_key) do nothing;

-- Konfigurasi analisis default (bisa diubah tanpa deploy)
insert into public.app_config (key, value) values
  ('recency_tau_days',            '120'),
  ('promoted_tau_days',           '60'),
  ('manager_change_weight',       '0.5'),
  ('min_minutes_teammate_effect', '450'),
  ('monte_carlo_runs',            '10000'),
  ('deadline_checkpoints_min',    '[2880, 1440, 360, 120, 60, 15]'),
  ('material_change_xpts',        '0.5'),
  ('ai_tier',                     '"free"'),
  ('ai_daily_budget_usd',         '3'),
  ('retention_days',              '{"raw_payloads": 14, "odds_snapshots": 90, "ai_cache": 30, "job_runs": 60}')
on conflict (key) do nothing;
