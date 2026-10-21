-- Berita baru (sync_news, tiap tick) langsung dikirim ke Home lewat Supabase Realtime.
-- news_items sudah bisa dibaca anon (public_read); status pemain FPL sudah ada di publikasi.
alter publication supabase_realtime add table public.news_items;
