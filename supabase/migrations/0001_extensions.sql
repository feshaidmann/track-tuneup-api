-- Habilita pg_cron (jobs internos) e pg_net (HTTP de dentro do banco).
-- Ambas as extensões precisam do schema "extensions" no Supabase.
create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;
