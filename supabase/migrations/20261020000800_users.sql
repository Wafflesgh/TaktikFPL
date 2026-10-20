create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  timezone      text not null default 'Asia/Jakarta',
  locale        text not null default 'id-ID',
  theme         text not null default 'violet' check (theme in ('violet','ember','pitch')),
  risk_profile  text not null default 'balanced' check (risk_profile in ('safe','balanced','aggressive')),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Profil otomatis saat akun Auth dibuat. Pengguna pertama otomatis admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    not exists (select 1 from public.users)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper untuk policy admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_admin from public.users u where u.id = (select auth.uid())),
    false
  );
$$;

create table public.user_fpl_entries (
  id               bigserial primary key,
  user_id          uuid not null references public.users(id) on delete cascade,
  fpl_entry_id     int  not null,
  team_name        text,
  is_primary       boolean not null default true,
  mini_league_ids  int[] not null default '{}',
  h2h_league_ids   int[] not null default '{}',
  auth_mode        text not null default 'public' check (auth_mode in ('public','cookie')),
  created_at       timestamptz not null default now(),
  unique (user_id, fpl_entry_id)
);

create table public.user_squad_picks (
  entry_id               bigint not null references public.user_fpl_entries(id) on delete cascade,
  gameweek_id            int    not null references public.gameweeks(id),
  slot                   int    not null check (slot between 1 and 15),
  player_id              bigint not null references public.players(id),
  is_captain             boolean not null default false,
  is_vice                boolean not null default false,
  multiplier             int    not null default 1,
  purchase_price_tenths  int,
  selling_price_tenths   int,
  primary key (entry_id, gameweek_id, slot)
);

create table public.user_transfer_plans (
  id          bigserial primary key,
  user_id     uuid   not null references public.users(id) on delete cascade,
  entry_id    bigint not null references public.user_fpl_entries(id) on delete cascade,
  gameweek_id int    not null references public.gameweeks(id),
  horizon_gw  int    not null default 3 check (horizon_gw between 1 and 8),
  plan        jsonb  not null,          -- daftar transfer, hit, chip, asumsi
  xpts_gain   numeric(6,2),
  status      text   not null default 'draft' check (status in ('draft','applied','discarded')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger user_transfer_plans_set_updated_at before update on public.user_transfer_plans
  for each row execute function public.set_updated_at();

create table public.user_watchlist (
  user_id    uuid   not null references public.users(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  note       text,
  added_at   timestamptz not null default now(),
  primary key (user_id, player_id)
);

create table public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in
              ('injury_alert','fixture_change','deadline_report','price_change','lineup_confirmed',
               'goal','set_piece_change','system')),
  title       text not null,
  body        text,
  payload     jsonb,
  channel     text[] not null default '{push}',
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
