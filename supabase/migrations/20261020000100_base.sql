-- Extensions (di Supabase, schema "extensions" sudah tersedia)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Schema khusus jobstore APScheduler. Hanya worker (role postgres) yang memakai.
create schema if not exists scheduler;
revoke all on schema scheduler from public;

-- Trigger umum untuk kolom updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
