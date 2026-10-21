-- Pemicu worker-tick yang andal: jadwal GitHub Actions (cron */15) sering terlewat, jadi Supabase
-- (pg_cron + pg_net, gratis) memanggil workflow_dispatch GitHub tiap 15 menit. Tick-nya idempoten
-- (job hanya jalan bila jatuh tempo) dan workflow memakai concurrency group, jadi run ganda dari jadwal
-- GitHub tidak merugikan.
--
-- Token TIDAK ada di repo: fine-grained PAT (hanya repo TaktikFPL, izin Actions: read & write) disimpan
-- pengguna di Supabase Vault dengan nama 'github_dispatch_token'. Tanpa secret itu fungsi tidak berbuat apa-apa.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Skema privat: tidak diekspos PostgREST, jadi anon tidak bisa memicu run lewat RPC.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.trigger_worker_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token'
  limit 1;
  if token is null or token = '' then
    return null;
  end if;
  return net.http_post(
    url := 'https://api.github.com/repos/Wafflesgh/TaktikFPL/actions/workflows/worker-tick.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'TaktikFPL-pg_cron'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('jobs', ''))
  );
end;
$$;

revoke all on function private.trigger_worker_tick() from public, anon, authenticated;

-- Idempoten: jadwal lama dengan nama sama diganti.
select cron.unschedule(jobid) from cron.job where jobname = 'worker-tick';
select cron.schedule('worker-tick', '*/15 * * * *', 'select private.trigger_worker_tick()');
