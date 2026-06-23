-- Backfill da migration já aplicada na produção (gerenciada antes via Lovable).
-- analysis_events foi um experimento de telemetria, substituído pelas tabelas
-- tuneup_* da Fase 0 (tuneup_events / tuneup_analyses).
drop table if exists public.analysis_events;
