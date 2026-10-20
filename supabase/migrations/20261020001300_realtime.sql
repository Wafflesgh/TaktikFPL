-- Perubahan yang dikirim ke browser lewat Supabase Realtime (postgres_changes).
-- Poin live per pemain TIDAK lewat sini (terlalu sering); worker memakai Realtime Broadcast.
alter publication supabase_realtime add table
  public.fixtures,
  public.fixture_changes,
  public.match_events,
  public.notifications,
  public.analysis_reports,
  public.player_status_snapshots,
  public.gameweeks;
