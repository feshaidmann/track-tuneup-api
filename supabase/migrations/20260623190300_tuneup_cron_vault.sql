-- Reaponta o cron de cleanup para ler config do Supabase Vault em vez de GUCs.
-- Motivo: `ALTER DATABASE postgres SET app.*` é negado no Postgres gerenciado do
-- Supabase (permission denied), então current_setting('app.railway_url') nunca
-- resolveria. O Vault é o padrão recomendado para secrets usados por pg_cron/pg_net.
--
-- Os secrets NÃO entram no repo (vazaria). Crie-os uma vez, fora do versionamento,
-- via SQL editor ou MCP (valores reais):
--   select vault.create_secret('https://<seu-backend>.up.railway.app', 'tuneup_railway_url');
--   select vault.create_secret('<INTERNAL_API_KEY>',                    'tuneup_internal_api_key');
-- O INTERNAL_API_KEY do Vault deve ser igual ao setado no Railway.
--
-- cron.schedule com jobname existente atualiza o job (idempotente).

select cron.schedule(
  'tuneup-daily-cleanup',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tuneup_railway_url') || '/api/internal/cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (select decrypted_secret from vault.decrypted_secrets where name = 'tuneup_internal_api_key')
    ),
    body := '{}'::jsonb
  )
  $$
);
