-- Job diário: remove objetos de storage expirados chamando o endpoint interno.
-- Roda às 03:00 UTC todo dia.
-- Substitua <RAILWAY_URL> e <INTERNAL_API_KEY> pelas vars reais antes de aplicar.
select cron.schedule(
  'tuneup-daily-cleanup',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.railway_url') || '/api/internal/cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', current_setting('app.internal_api_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
