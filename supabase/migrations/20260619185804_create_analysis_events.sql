-- Backfill da migration já aplicada na produção (gerenciada antes via Lovable).
-- Reproduzida no repo para reconciliar o histórico do Supabase CLI/Branching.
-- A tabela é dropada logo em seguida por 20260623010912_drop_orphan_analysis_events.

create table public.analysis_events (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  preset           text not null,
  file_size_bytes  bigint not null,
  processing_time_ms int,
  success          boolean not null default true,
  error_message    text,
  downloaded       boolean not null default false,
  metrics_delta    jsonb
);

alter table public.analysis_events enable row level security;

-- Leitura somente para usuários autenticados (admin)
create policy "admin_read" on public.analysis_events
  for select to authenticated using (true);

-- Inserção pública anônima (o frontend loga sem login)
create policy "anon_insert" on public.analysis_events
  for insert to anon with check (true);

-- Update público para marcar downloaded = true
create policy "anon_update_downloaded" on public.analysis_events
  for update to anon
  using (true)
  with check (
    downloaded = true
    and success = true
    and error_message is null
  );
