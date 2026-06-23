-- ============================================================
-- TuneUp — schema principal
-- ============================================================

-- Clientes anônimos identificados por UUID gerado no browser
create table if not exists tuneup_clients (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  metadata    jsonb
);

-- Cada análise realizada
create table if not exists tuneup_analyses (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references tuneup_clients(id) on delete cascade,
  preset          text not null,
  filename        text,
  storage_path    text,           -- caminho no Supabase Storage
  before_metrics  jsonb,
  after_metrics   jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','processing','done','error')),
  error_msg       text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists idx_analyses_client_created on tuneup_analyses(client_id, created_at desc);

-- Eventos de uso (page view, download, share, etc.)
create table if not exists tuneup_events (
  id           bigserial primary key,
  client_id    uuid not null references tuneup_clients(id) on delete cascade,
  analysis_id  uuid references tuneup_analyses(id) on delete set null,
  event_type   text not null,
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_events_client_created  on tuneup_events(client_id, created_at desc);
create index if not exists idx_events_analysis        on tuneup_events(analysis_id);

-- Arquivos no Storage (metadados — o arquivo em si fica no bucket)
create table if not exists tuneup_storage_objects (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references tuneup_clients(id) on delete cascade,
  analysis_id  uuid references tuneup_analyses(id) on delete set null,
  bucket       text not null,
  path         text not null unique,
  size_bytes   bigint,
  content_type text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_storage_client on tuneup_storage_objects(client_id);
create index if not exists idx_storage_expires on tuneup_storage_objects(expires_at) where expires_at is not null;

-- Conversas de chat (Fase 1 — tabela criada agora, usada depois)
create table if not exists tuneup_chat_conversations (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references tuneup_clients(id) on delete cascade,
  analysis_id  uuid references tuneup_analyses(id) on delete set null,
  messages     jsonb not null default '[]',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_chat_client on tuneup_chat_conversations(client_id);

-- Pedidos de mix / revisão humana (Fase 4)
create table if not exists tuneup_mix_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references tuneup_clients(id) on delete cascade,
  analysis_id  uuid references tuneup_analyses(id) on delete set null,
  contact      text,
  notes        text,
  status       text not null default 'open'
                 check (status in ('open','in_progress','done','cancelled')),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table tuneup_clients               enable row level security;
alter table tuneup_analyses              enable row level security;
alter table tuneup_events                enable row level security;
alter table tuneup_storage_objects       enable row level security;
alter table tuneup_chat_conversations    enable row level security;
alter table tuneup_mix_requests          enable row level security;

-- service_role ignora RLS por padrão no Supabase.
-- Políticas permissivas para anon/authenticated serão adicionadas
-- à medida que o produto evoluir (por ora bloqueado para acesso direto).
