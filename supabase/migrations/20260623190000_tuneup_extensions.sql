-- Habilita pg_cron (jobs internos) e pg_net (HTTP de dentro do banco).
-- Forma canônica do Supabase: sem "with schema" — pg_cron cria o schema `cron`
-- e pg_net o schema `net` (referenciados em 20260623190200_tuneup_cron_cleanup).
create extension if not exists pg_cron;
create extension if not exists pg_net;
