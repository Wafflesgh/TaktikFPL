-- Form pemain terbaru (hasil job build_form) untuk daftar pemain & kartu di UI.
-- Tidak membuat tabel baru, jadi pengaman RLS di 20261020001200_rls.sql tetap berlaku.
create index if not exists player_form_features_latest_idx
  on public.player_form_features (player_id, window_label, as_of desc);

create view public.v_player_form
with (security_invoker = true) as
select
  l4.player_id,
  l4.as_of,
  l4.metrics ->> 'form_label'                       as form_label,
  (l4.metrics ->> 'form_score')::numeric            as form_score,
  (l4.metrics ->> 'form_trend')::numeric            as form_trend,
  l4.metrics -> 'form_reasons'                      as form_reasons,
  (l4.metrics ->> 'points_per_match')::numeric      as last4_points_per_match,
  (l4.metrics ->> 'xgi90_shrunk')::numeric          as last4_xgi90,
  (l4.metrics ->> 'minutes_share')::numeric         as last4_minutes_share,
  (l4.metrics ->> 'goals_minus_xg')::numeric        as last4_goals_minus_xg,
  (se.metrics ->> 'points_per_match')::numeric      as season_points_per_match,
  (se.metrics ->> 'xgi90_shrunk')::numeric          as season_xgi90,
  l4.sample_minutes                                 as last4_minutes
from (
  select distinct on (player_id) player_id, as_of, metrics, sample_minutes
  from public.player_form_features
  where window_label = 'last4'
  order by player_id, as_of desc
) l4
left join public.player_form_features se
  on se.player_id = l4.player_id and se.as_of = l4.as_of and se.window_label = 'season';
